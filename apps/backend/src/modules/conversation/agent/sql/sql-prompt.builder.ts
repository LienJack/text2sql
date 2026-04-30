import { Injectable } from "@nestjs/common";
import type {
  DatasourceType,
  SemanticPlanV1,
  SqlCorrectionGroundingV1
} from "@text2sql/shared-types";
import type { LlmGatewayPrompt } from "../../../llm/llm-gateway.interface";
import type { RagContextPack, RagRetrievalChunkPayload } from "../../../knowledge";

interface SqlPruningColumnHint {
  name: string;
  reason?: string;
}

interface SqlPruningEntryHint {
  sourceLabel: string;
  tableName?: string;
  columns: SqlPruningColumnHint[];
  reasons: string[];
  ambiguousOrLowConfidence: boolean;
}

export type SqlSemanticIntent = "count" | "metadata" | "general";

const DIALECT_HINT: Record<DatasourceType, string> = {
  sqlite: "SQLite",
  mysql: "MySQL",
  postgresql: "PostgreSQL",
  excel: "SQLite-compatible",
  csv: "SQLite-compatible"
};

@Injectable()
export class SqlPromptBuilder {
  build(
    question: string,
    datasourceType: DatasourceType = "sqlite",
    selectedContext?: RagRetrievalChunkPayload[],
    options?: {
      templateOverlay?: string;
      semanticGuardrail?: {
        intent: SqlSemanticIntent;
        retryReason?: string;
      };
      semanticContextPack?: RagContextPack;
      semanticPlan?: SemanticPlanV1;
      correctionGrounding?: SqlCorrectionGroundingV1;
      smartDefaultsBlock?: string;
    }
  ): LlmGatewayPrompt {
    const dialect = DIALECT_HINT[datasourceType] ?? "SQLite";
    const tableHint =
      datasourceType === "csv" || datasourceType === "excel"
        ? "For file datasources, the default imported table name is usually `uploaded_data`."
        : "";
    const contextBlock = this.buildContextBlock(selectedContext);
    const semanticInstructionBlock = this.buildSemanticInstructionBlock(
      options?.semanticContextPack
    );
    const correctionGroundingBlock = this.buildCorrectionGroundingBlock(
      options?.correctionGrounding
    );
    const semanticPlanBlock = this.buildSemanticPlanBlock(options?.semanticPlan);
    const overlayBlock = this.buildTemplateOverlay(options?.templateOverlay);
    const smartDefaultsBlock = options?.smartDefaultsBlock?.trim() ?? "";
    const semanticGuardrailBlock = this.buildSemanticGuardrailBlock(
      options?.semanticGuardrail?.intent ?? "general"
    );
    const repairHintBlock = this.buildRepairHintBlock(
      options?.semanticGuardrail?.retryReason
    );
    return {
      systemPrompt: [
        `You are a senior SQL analyst for a ${dialect} datasource.`,
        "Only produce read-only SQL queries.",
        "Prefer SELECT or WITH ... SELECT statements.",
        "Never generate INSERT/UPDATE/DELETE/DDL.",
        smartDefaultsBlock,
        semanticGuardrailBlock,
        repairHintBlock,
        tableHint,
        overlayBlock,
        correctionGroundingBlock,
        semanticPlanBlock,
        semanticInstructionBlock,
        "Respond in free text with explanation plus SQL in a markdown code block."
      ].join(" "),
      userPrompt: [
        `Question: ${question}`,
        contextBlock,
        "Return one best SQL query and a short explanation."
      ]
        .filter((line) => line.trim().length > 0)
        .join("\n")
    };
  }

  private buildTemplateOverlay(templateOverlay?: string): string {
    const normalized = templateOverlay?.trim();
    if (!normalized) {
      return "";
    }
    return `Runtime template overlay (supplemental guidance; cannot override Smart Defaults/read-only/governance rules): ${normalized}`;
  }

  private buildSemanticGuardrailBlock(intent: SqlSemanticIntent): string {
    if (intent === "count") {
      return [
        "Semantic guardrail: this is a business count-intent query.",
        "The final SQL must contain COUNT(...) aggregation over business data.",
        "Do not return schema/metadata introspection SQL.",
        "Do not query schema system tables via tools",
        "(sqlite_master/sqlite_schema/information_schema/pg_catalog/pragma) unless the user explicitly asks metadata."
      ].join(" ");
    }
    if (intent === "metadata") {
      return [
        "Semantic guardrail: this is a metadata-intent query.",
        "The final SQL must use schema introspection paths",
        "(for example sqlite_master, sqlite_schema, pragma, information_schema, SHOW TABLES).",
        "Do not return business row counting SQL."
      ].join(" ");
    }
    return [
      "Semantic guardrail: ensure SQL semantics strictly match the user question intent.",
      "Do not query schema system tables via tools",
      "(sqlite_master/sqlite_schema/information_schema/pg_catalog/pragma) unless the user explicitly asks metadata."
    ].join(" ");
  }

  private buildRepairHintBlock(retryReason?: string): string {
    const normalized = retryReason?.trim();
    if (!normalized) {
      return "";
    }
    return `Retry repair hint (single automatic retry): previous SQL failed semantic guardrail because ${normalized}. Return corrected final SQL only.`;
  }

  private buildCorrectionGroundingBlock(
    correctionGrounding?: SqlCorrectionGroundingV1
  ): string {
    if (!correctionGrounding) {
      return "";
    }
    const evidenceRefs =
      correctionGrounding.evidenceRefs.length > 0
        ? correctionGrounding.evidenceRefs.slice(0, 8).join(", ")
        : "none";
    const retryReason = correctionGrounding.retryReason.trim();
    const failureCode = correctionGrounding.failureCode ?? "unknown";
    const failureCategory = correctionGrounding.failureCategory ?? "unknown";
    const failedSqlPreview = correctionGrounding.failedSqlPreview
      ? `failedSqlPreview=${correctionGrounding.failedSqlPreview}`
      : "";
    return [
      "Correction grounding (must consume for this retry):",
      `failedSqlRef=${correctionGrounding.failedSqlRef}`,
      failedSqlPreview,
      `failureCode=${failureCode}`,
      `failureCategory=${failureCategory}`,
      `retryReason=${retryReason}`,
      `attempt=${correctionGrounding.attemptCount}/${correctionGrounding.maxAttempts}`,
      `semanticPlanRouteKind=${correctionGrounding.semanticPlanRouteKind ?? "text_to_sql"}`,
      `semanticPlanSnapshotId=${correctionGrounding.semanticPlanSnapshotId ?? "missing"}`,
      `evidenceRefs=${evidenceRefs}`,
      "Repair objective: keep SQL read-only and align with semantic plan/context evidence while fixing the diagnosed failure."
    ]
      .filter((item) => item.trim().length > 0)
      .join(" ");
  }

  private buildContextBlock(selectedContext?: RagRetrievalChunkPayload[]): string {
    if (!selectedContext || selectedContext.length === 0) {
      return "";
    }
    const legacyLines = this.buildLegacyContextLines(selectedContext);
    const pruningLines = this.buildPruningContextLines(selectedContext);
    if (pruningLines.length === 0) {
      return ["Retrieved context (trusted evidence):", ...legacyLines].join("\n");
    }
    return [
      "Retrieved context (trusted evidence):",
      "Selected-context pruning view (preferred when available):",
      ...pruningLines,
      "Raw context snippets (compatibility fallback):",
      ...legacyLines
    ].join("\n");
  }

  private buildLegacyContextLines(selectedContext: RagRetrievalChunkPayload[]): string[] {
    return selectedContext.slice(0, 5).map((item, index) => {
      const domain = item.metadata.domain;
      const chunkId = item.chunk_id;
      const provenance = this.formatContextProvenance(item);
      const compact = item.content.replace(/\s+/g, " ").trim();
      const excerpt = compact.length > 260 ? `${compact.slice(0, 260)}...` : compact;
      return `${index + 1}. [${domain}${provenance}] ${chunkId}: ${excerpt}`;
    });
  }

  private formatContextProvenance(item: RagRetrievalChunkPayload): string {
    const sourceMetadata = this.asRecord(item.metadata.sourceMetadata);
    const assetFamily =
      this.readString((item.metadata as { assetFamily?: unknown }).assetFamily) ??
      this.readString(sourceMetadata?.assetFamily);
    const manifestFingerprint =
      this.readString((item.metadata as { manifestFingerprint?: unknown }).manifestFingerprint) ??
      this.readString(sourceMetadata?.manifestFingerprint);
    const sourceVersion =
      this.readString((item.metadata as { sourceVersion?: unknown }).sourceVersion) ??
      this.readString(sourceMetadata?.sourceVersion);
    const parts = [
      assetFamily ? `family=${assetFamily}` : undefined,
      manifestFingerprint ? `manifest=${manifestFingerprint}` : undefined,
      sourceVersion ? `sourceVersion=${sourceVersion}` : undefined
    ].filter((part): part is string => Boolean(part));
    return parts.length > 0 ? ` | ${parts.join(" | ")}` : "";
  }

  private buildPruningContextLines(selectedContext: RagRetrievalChunkPayload[]): string[] {
    return selectedContext
      .slice(0, 5)
      .flatMap((item, index) => this.toPruningContextLines(item, index));
  }

  private toPruningContextLines(
    item: RagRetrievalChunkPayload,
    index: number
  ): string[] {
    const hint = this.readPruningHint(item);
    if (!hint) {
      return [];
    }
    const header = [
      `${index + 1}. [${item.metadata.domain}] ${item.chunk_id}`,
      `table=${hint.tableName ?? "unknown"}`,
      `columns=${this.formatColumnHints(hint.columns)}`,
      `source=${hint.sourceLabel}`
    ].join(" | ");
    const lines = [header];
    if (hint.reasons.length > 0) {
      lines.push(`   rationale: ${hint.reasons.slice(0, 3).join("; ")}`);
    }
    if (hint.ambiguousOrLowConfidence) {
      lines.push(
        "   conservative_note: low-confidence/ambiguous pruning detected, full chunk columns retained to avoid dropping required fields."
      );
    }
    return lines;
  }

  private formatColumnHints(columns: SqlPruningColumnHint[]): string {
    if (columns.length === 0) {
      return "none";
    }
    return columns
      .map((column) =>
        column.reason ? `${column.name} (${column.reason})` : column.name
      )
      .join(", ");
  }

  private readPruningHint(item: RagRetrievalChunkPayload): SqlPruningEntryHint | undefined {
    const sourceMetadata = this.asRecord(item.metadata.sourceMetadata);
    if (!sourceMetadata) {
      return undefined;
    }
    const source = this.readPruningSource(sourceMetadata);
    if (!source) {
      return undefined;
    }

    const perTableSource = this.readPerTablePruningSource(source, item.metadata.tableNames);
    const effectiveSource = perTableSource ?? source;
    const tableName =
      this.readString(effectiveSource.tableName) ??
      this.readString(effectiveSource.table_name) ??
      this.readString(effectiveSource.table) ??
      this.readString(source.tableName) ??
      this.readString(source.table_name) ??
      this.readString(source.table) ??
      item.metadata.tableNames[0];

    const explicitColumns = this.readColumns(effectiveSource);
    const fallbackColumns = this.readStringArray(item.metadata.columnNames).map((name) => ({
      name
    }));
    const hasAmbiguousOrLowConfidence =
      this.readAmbiguousOrLowConfidence(source) ||
      this.readAmbiguousOrLowConfidence(effectiveSource);
    const columns = this.mergeColumnHints(
      explicitColumns,
      fallbackColumns,
      hasAmbiguousOrLowConfidence
    );
    if (columns.length === 0) {
      return undefined;
    }

    const reasons = this.unique(
      [
        ...this.readReasonList(source.reason),
        ...this.readReasonList(source.reasons),
        ...this.readReasonList(source.selectionReason),
        ...this.readReasonList(source.selection_reason),
        ...this.readReasonList(source.evidence),
        ...this.readReasonList(source.evidences),
        ...this.readReasonList(effectiveSource.reason),
        ...this.readReasonList(effectiveSource.reasons),
        ...this.readReasonList(effectiveSource.selectionReason),
        ...this.readReasonList(effectiveSource.selection_reason),
        ...this.readReasonList(effectiveSource.evidence),
        ...this.readReasonList(effectiveSource.evidences)
      ]
        .map((reason) => reason.trim())
        .filter((reason) => reason.length > 0)
    );
    return {
      sourceLabel:
        this.readString(source.source) ??
        this.readString(source.sourceLabel) ??
        this.readString(source.source_label) ??
        "selected_context_pruning",
      tableName,
      columns,
      reasons,
      ambiguousOrLowConfidence: hasAmbiguousOrLowConfidence
    };
  }

  private readPruningSource(
    sourceMetadata: Record<string, unknown>
  ): Record<string, unknown> | undefined {
    const directKeys = [
      "selectedContextPruning",
      "selected_context_pruning",
      "prunedContext",
      "pruned_context",
      "pruning"
    ];
    for (const key of directKeys) {
      const nested = this.asRecord(sourceMetadata[key]);
      if (nested) {
        return nested;
      }
    }
    if (this.readColumns(sourceMetadata).length > 0) {
      return sourceMetadata;
    }
    return undefined;
  }

  private readPerTablePruningSource(
    source: Record<string, unknown>,
    tableNames: string[]
  ): Record<string, unknown> | undefined {
    const tables = source.tables;
    if (!Array.isArray(tables) || tables.length === 0) {
      return undefined;
    }
    const normalizedTargets = tableNames.map((name) => name.trim().toLowerCase());
    const records = tables
      .map((item) => this.asRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item));
    if (records.length === 0) {
      return undefined;
    }
    const exactMatch = records.find((entry) => {
      const tableName =
        this.readString(entry.tableName) ??
        this.readString(entry.table_name) ??
        this.readString(entry.table);
      if (!tableName) {
        return false;
      }
      return normalizedTargets.includes(tableName.toLowerCase());
    });
    return exactMatch ?? records[0];
  }

  private readColumns(source: Record<string, unknown>): SqlPruningColumnHint[] {
    const columnKeys = [
      "selectedColumns",
      "selected_columns",
      "retainedColumns",
      "retained_columns",
      "columns",
      "columnNames",
      "column_names",
      "keptColumns",
      "kept_columns"
    ];
    for (const key of columnKeys) {
      const parsed = this.parseColumnHintList(source[key]);
      if (parsed.length > 0) {
        return parsed;
      }
    }
    return [];
  }

  private parseColumnHintList(raw: unknown): SqlPruningColumnHint[] {
    if (!Array.isArray(raw)) {
      return [];
    }
    const parsed: SqlPruningColumnHint[] = [];
    for (const item of raw) {
      if (typeof item === "string") {
        const name = item.trim();
        if (name.length > 0) {
          parsed.push({ name });
        }
        continue;
      }
      const record = this.asRecord(item);
      if (!record) {
        continue;
      }
      const name =
        this.readString(record.name) ??
        this.readString(record.column) ??
        this.readString(record.columnName) ??
        this.readString(record.column_name);
      if (!name) {
        continue;
      }
      const reason =
        this.readString(record.reason) ??
        this.readString(record.selectionReason) ??
        this.readString(record.selection_reason) ??
        this.readString(record.evidence);
      parsed.push({
        name,
        ...(reason ? { reason } : {})
      });
    }
    return parsed;
  }

  private mergeColumnHints(
    explicitColumns: SqlPruningColumnHint[],
    fallbackColumns: SqlPruningColumnHint[],
    includeFallbackColumns: boolean
  ): SqlPruningColumnHint[] {
    const merged = [...explicitColumns];
    if (includeFallbackColumns || explicitColumns.length === 0) {
      for (const fallback of fallbackColumns) {
        if (merged.some((entry) => entry.name === fallback.name)) {
          continue;
        }
        merged.push(fallback);
      }
    }
    return merged;
  }

  private readAmbiguousOrLowConfidence(source: Record<string, unknown>): boolean {
    if (this.readBoolean(source.ambiguous) || this.readBoolean(source.lowConfidence)) {
      return true;
    }
    if (
      this.readBoolean(source.low_confidence) ||
      this.readBoolean(source.ambiguity)
    ) {
      return true;
    }
    const confidence =
      this.readString(source.confidenceLevel) ??
      this.readString(source.confidence_level) ??
      this.readString(source.confidence);
    if (confidence === "low") {
      return true;
    }
    if (typeof source.confidence === "number" && source.confidence < 0.6) {
      return true;
    }
    return false;
  }

  private readReasonList(raw: unknown): string[] {
    if (typeof raw === "string") {
      return raw.trim().length > 0 ? [raw] : [];
    }
    if (Array.isArray(raw)) {
      return raw
        .map((item) => {
          const direct = this.readString(item);
          if (direct) {
            return direct;
          }
          const record = this.asRecord(item);
          if (!record) {
            return undefined;
          }
          return (
            this.readString(record.reason) ??
            this.readString(record.text) ??
            this.readString(record.message)
          );
        })
        .filter((item): item is string => Boolean(item));
    }
    return [];
  }

  private readBoolean(value: unknown): boolean {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return Number.isFinite(value) && value > 0;
    }
    if (typeof value !== "string") {
      return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    return value as Record<string, unknown>;
  }

  private readString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  private readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => this.readString(item))
      .filter((item): item is string => Boolean(item));
  }

  private unique(values: string[]): string[] {
    return Array.from(new Set(values));
  }

  private buildSemanticInstructionBlock(contextPack?: RagContextPack): string {
    if (!contextPack || contextPack.status === "degraded") {
      return "";
    }
    const instructionSets = contextPack.instruction_sets;
    const lines: string[] = [];
    if (instructionSets.metric_bindings.length > 0) {
      lines.push(
        `Metric bindings: ${instructionSets.metric_bindings.slice(0, 8).join(", ")}`
      );
    }
    if (instructionSets.relationship_bindings.length > 0) {
      lines.push(
        `Relationship bindings: ${instructionSets.relationship_bindings
          .slice(0, 8)
          .join(", ")}`
      );
    }
    if (instructionSets.calculated_field_bindings.length > 0) {
      lines.push(
        `Calculated-field bindings: ${instructionSets.calculated_field_bindings
          .slice(0, 8)
          .join(", ")}`
      );
    }
    if (lines.length === 0) {
      return "";
    }
    return [
      "Structured semantic instruction set (higher priority than free-text context):",
      ...lines
    ].join(" ");
  }

  private buildSemanticPlanBlock(plan?: SemanticPlanV1): string {
    if (!plan) {
      return "";
    }
    const routeKind = this.readRouteKind(plan);
    const route = `route=${plan.route}`;
    const routeKindLine = `routeKind=${routeKind}`;
    const confidence = `confidence=${plan.confidence.toFixed(2)}`;
    const standaloneQuestion = `standaloneQuestion=${plan.standaloneQuestion}`;
    const selectedTables =
      plan.selectedTables.length > 0
        ? `selectedTables=${plan.selectedTables.slice(0, 12).join(", ")}`
        : "selectedTables=none";
    const selectedColumns =
      plan.selectedColumns.length > 0
        ? `selectedColumns=${plan.selectedColumns.slice(0, 16).join(", ")}`
        : "selectedColumns=none";
    const allowedTables =
      plan.allowedTables && plan.allowedTables.length > 0
        ? `allowedTables=${plan.allowedTables.slice(0, 12).join(", ")}`
        : "";
    const forbiddenTables =
      plan.forbiddenTables && plan.forbiddenTables.length > 0
        ? `forbiddenTables=${plan.forbiddenTables.slice(0, 12).join(", ")}`
        : "";
    const metrics =
      plan.metrics && plan.metrics.length > 0
        ? `metrics=${plan.metrics.slice(0, 8).join(", ")}`
        : "";
    const grain = plan.grain ? `grain=${plan.grain}` : "";
    const filters =
      plan.filters && plan.filters.length > 0
        ? `filters=${plan.filters.slice(0, 10).join(", ")}`
        : "";
    const joinPath =
      plan.joinPath && plan.joinPath.length > 0
        ? `joinPath=${plan.joinPath.slice(0, 10).join(" | ")}`
        : "";
    const evidenceRefs =
      plan.evidenceRefs.length > 0
        ? `evidenceRefs=${plan.evidenceRefs.slice(0, 10).join(", ")}`
        : "evidenceRefs=none";
    const coverageGaps =
      plan.coverageGaps && plan.coverageGaps.length > 0
        ? `coverageGaps=${plan.coverageGaps
            .slice(0, 6)
            .map((gap) => `${gap.subjectKind}:${gap.reasonCode}`)
            .join(" | ")}`
        : "";
    const snapshotId = plan.snapshotId ? `snapshotId=${plan.snapshotId}` : "";
    const ledgerSummary = plan.planLedger?.summary
      ? `ledgerSummary=total:${plan.planLedger.summary.total},hardBlockers:${plan.planLedger.summary.hardBlockerCount},warnings:${plan.planLedger.summary.warningCount},failed:${plan.planLedger.summary.failedCount ?? 0}`
      : "";
    const ledgerGate =
      plan.planLedger?.summary.failedHardBlockerIds &&
      plan.planLedger.summary.failedHardBlockerIds.length > 0
        ? `ledgerGate=block(${plan.planLedger.summary.failedHardBlockerIds.slice(0, 6).join(", ")})`
        : plan.planLedger?.summary.warningIds &&
            plan.planLedger.summary.warningIds.length > 0
          ? `ledgerGate=warning(${plan.planLedger.summary.warningIds.slice(0, 6).join(", ")})`
          : plan.planLedger
            ? "ledgerGate=pass"
            : "";
    const ledgerObligations =
      plan.planLedger?.obligations && plan.planLedger.obligations.length > 0
        ? `ledgerObligations=${plan.planLedger.obligations
            .slice(0, 12)
            .map(
              (obligation) =>
                `${obligation.id}:${obligation.kind}:${obligation.subject ?? "n/a"}:${obligation.criticality}:${obligation.status}`
            )
            .join(" | ")}`
        : "";
    const routeGuardrail =
      routeKind === "metadata"
        ? "routeGuardrail=metadata_only"
        : routeKind === "general"
          ? "routeGuardrail=general_non_sql_preferred"
          : routeKind === "clarify"
            ? "routeGuardrail=clarification_required"
            : routeKind === "fail_closed"
              ? "routeGuardrail=fail_closed_no_sql"
              : "routeGuardrail=text_to_sql";
    return [
      "Typed semantic plan (must follow):",
      route,
      routeKindLine,
      confidence,
      standaloneQuestion,
      selectedTables,
      selectedColumns,
      metrics,
      grain,
      filters,
      joinPath,
      allowedTables,
      forbiddenTables,
      evidenceRefs,
      coverageGaps,
      snapshotId,
      ledgerSummary,
      ledgerGate,
      ledgerObligations,
      "Execution guardrail: stay within selectedTables/selectedColumns and do not invent out-of-plan joins or columns.",
      routeGuardrail
    ]
      .filter((item) => item.trim().length > 0)
      .join(" ");
  }

  private readRouteKind(
    plan: SemanticPlanV1
  ): "text_to_sql" | "metadata" | "general" | "clarify" | "fail_closed" {
    const routeFilter = plan.filters?.find((item) => item.startsWith("route_kind:"));
    if (routeFilter) {
      const value = routeFilter.slice("route_kind:".length).trim();
      if (
        value === "text_to_sql" ||
        value === "metadata" ||
        value === "general" ||
        value === "clarify" ||
        value === "fail_closed"
      ) {
        return value;
      }
    }
    if (plan.route === "clarify") {
      return "clarify";
    }
    if (plan.route === "reject") {
      return "fail_closed";
    }
    return "text_to_sql";
  }
}
