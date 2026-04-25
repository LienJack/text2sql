import type {
  DeliveryArtifactLayer,
  DeliveryContract,
  DeliveryEvidenceLayer,
  ExecutionTraceStep,
  ReasoningStage,
  RunStatus,
  SqlRun
} from "@text2sql/shared-types";

export type RunVisibilityStatus = "loading" | "success" | "error" | "empty";

export type RunVisibilityThinkingStep = ExecutionTraceStep & {
  stage?: ReasoningStage;
  title?: string;
};

type JsonRecord = Record<string, unknown>;
type SavedPriorSqlLayer = NonNullable<DeliveryEvidenceLayer["savedPriorSql"]>;
type DeliveryDisplayType = "table" | "metric" | "bar" | "line" | "pie";
type ExtendedArtifactField =
  | "summary"
  | "table"
  | "chart"
  | "display"
  | "validation"
  | "fallback"
  | "visualIntent";
type DeliveryArtifactCompat = {
  sql?: string;
  columns?: string[];
  rowCount: number;
  rowsPreview?: Array<Record<string, unknown>>;
  hasError: boolean;
} & JsonRecord;

const DISPLAY_TYPE_ALLOWLIST: ReadonlySet<DeliveryDisplayType> = new Set([
  "table",
  "metric",
  "bar",
  "line",
  "pie"
]);
const CHART_TYPE_ALLOWLIST: ReadonlySet<Exclude<DeliveryDisplayType, "table">> = new Set([
  "metric",
  "bar",
  "line",
  "pie"
]);
const EXTENDED_ARTIFACT_FIELDS: ExtendedArtifactField[] = [
  "summary",
  "table",
  "chart",
  "display",
  "validation",
  "fallback",
  "visualIntent"
] as const;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function readRecordArray(value: unknown): JsonRecord[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const records = value.filter((item): item is JsonRecord => isRecord(item));
  return records.length > 0 ? records : undefined;
}

function normalizeDisplayType(value: unknown): DeliveryDisplayType | undefined {
  const normalized = readString(value)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return DISPLAY_TYPE_ALLOWLIST.has(normalized as DeliveryDisplayType)
    ? (normalized as DeliveryDisplayType)
    : undefined;
}

function sanitizeJsonValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0
): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (depth >= 8) {
    return undefined;
  }
  if (Array.isArray(value)) {
    const next = value
      .map((item) => sanitizeJsonValue(item, seen, depth + 1))
      .filter((item) => item !== undefined);
    return next.length > 0 ? next : undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  if (seen.has(value)) {
    return undefined;
  }
  seen.add(value);
  const next = Object.entries(value).reduce<JsonRecord>((acc, [key, item]) => {
    const sanitized = sanitizeJsonValue(item, seen, depth + 1);
    if (sanitized !== undefined) {
      acc[key] = sanitized;
    }
    return acc;
  }, {});
  return Object.keys(next).length > 0 ? next : undefined;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function normalizeSelectedContext(value: unknown): DeliveryEvidenceLayer["selectedContext"] {
  if (Array.isArray(value)) {
    const snippets = value
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (!isRecord(item)) {
          return undefined;
        }
        return (
          readString(item.snippet) ??
          readString(item.text) ??
          readString(item.content) ??
          readString(item.chunkId) ??
          readString(item.chunk_id)
        );
      })
      .filter((item): item is string => Boolean(item));
    return {
      count: value.length,
      snippets: snippets.length > 0 ? snippets : undefined
    };
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const rawCount = readNumber(value.count) ?? readNumber(value.contextCount);
  const count = rawCount !== undefined ? Math.max(0, Math.floor(rawCount)) : 0;
  const snippets = readStringArray(value.snippets);

  return {
    count,
    snippets: snippets.length > 0 ? snippets : undefined
  };
}

function normalizeSkillContextSummary(
  value: unknown
): DeliveryEvidenceLayer["skillContextSummary"] {
  if (!isRecord(value)) {
    return undefined;
  }

  const skills = Array.isArray(value.skills) ? value.skills.length : undefined;
  const contexts = Array.isArray(value.context) ? value.context.length : undefined;
  const skillCount = readNumber(value.skillCount) ?? readNumber(value.skill_count) ?? skills;
  const contextCount =
    readNumber(value.contextCount) ?? readNumber(value.context_count) ?? contexts;
  const degradeReason = readString(value.degradeReason) ?? readString(value.degrade_reason);

  if (skillCount === undefined && contextCount === undefined && !degradeReason) {
    return undefined;
  }

  return {
    skillCount: Math.max(0, Math.floor(skillCount ?? 0)),
    contextCount: Math.max(0, Math.floor(contextCount ?? 0)),
    degradeReason
  };
}

function normalizeEvidence(value: unknown): DeliveryEvidenceLayer | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const runId = readString(value.runId) ?? readString(value.run_id);
  if (!runId) {
    return undefined;
  }

  const degradeReasons = unique([
    ...readStringArray(value.degradeReasons),
    ...readStringArray(value.degrade_reasons),
    ...(readString(value.degrade_reason) ? [readString(value.degrade_reason)!] : [])
  ]);
  const selectedContext = normalizeSelectedContext(value.selectedContext ?? value.selected_context);
  const riskTags = unique([
    ...readStringArray(value.riskTags),
    ...readStringArray(value.risk_tags)
  ]);
  const retrievalLogsRaw = Array.isArray(value.retrievalLogs)
    ? value.retrievalLogs
    : Array.isArray(value.retrieval_logs)
      ? value.retrieval_logs
      : [];
  const retrievalLogs = retrievalLogsRaw
    .map((item) => {
      if (!isRecord(item)) {
        return undefined;
      }
      const replayKey = readString(item.replayKey) ?? readString(item.replay_key);
      const stage = readString(item.stage);
      const createdAt = readString(item.createdAt) ?? readString(item.created_at);
      if (!replayKey || !stage || !createdAt) {
        return undefined;
      }
      return {
        replayKey,
        stage,
        indexVersionId: readString(item.indexVersionId) ?? readString(item.index_version_id),
        createdAt
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const retrievalStatusRaw =
    readString(value.retrievalStatus) ?? readString(value.retrieval_status);
  const retrievalStatus =
    retrievalStatusRaw === "degraded" || retrievalStatusRaw === "ready"
      ? retrievalStatusRaw
      : undefined;
  const semanticVersionRaw =
    readNumber(value.semanticVersion) ?? readNumber(value.semantic_version);
  const semanticVersion =
    semanticVersionRaw !== undefined ? Math.max(0, Math.floor(semanticVersionRaw)) : undefined;
  const semanticLockStatusRaw =
    readString(value.semanticLockStatus) ?? readString(value.semantic_lock_status);
  const semanticLockStatus =
    semanticLockStatusRaw === "locked" ||
    semanticLockStatusRaw === "fallback" ||
    semanticLockStatusRaw === "degraded"
      ? semanticLockStatusRaw
      : undefined;
  const semanticDegradeReason =
    readString(value.semanticDegradeReason) ??
    readString(value.semantic_degrade_reason);
  const skillContextSummary = normalizeSkillContextSummary(
    value.skillContextSummary ?? value.skill_context_summary ?? value.skill_context
  );
  const evidenceStale = readBoolean(value.evidenceStale) ?? readBoolean(value.evidence_stale);
  const savedPriorSqlRaw = isRecord(value.savedPriorSql)
    ? value.savedPriorSql
    : isRecord(value.saved_prior_sql)
      ? value.saved_prior_sql
      : undefined;
  const savedPriorStatusRaw = readString(savedPriorSqlRaw?.status);
  const savedPriorStatus: SavedPriorSqlLayer["status"] | undefined =
    savedPriorStatusRaw === "hit" ||
    savedPriorStatusRaw === "miss" ||
    savedPriorStatusRaw === "filtered" ||
    savedPriorStatusRaw === "stale" ||
    savedPriorStatusRaw === "ambiguous"
      ? savedPriorStatusRaw
      : undefined;
  const savedPriorSafetyRaw = readString(
    savedPriorSqlRaw?.safetyResult ?? savedPriorSqlRaw?.safety_result
  );
  const savedPriorSafetyResult: SavedPriorSqlLayer["safetyResult"] | undefined =
    savedPriorSafetyRaw === "passed" ||
    savedPriorSafetyRaw === "rejected" ||
    savedPriorSafetyRaw === "fallback_generated"
      ? savedPriorSafetyRaw
      : undefined;
  const savedPriorShortcutUsed = readBoolean(
    savedPriorSqlRaw?.shortcutUsed ?? savedPriorSqlRaw?.shortcut_used
  );
  const savedPriorReasonCodes = unique([
    ...readStringArray(savedPriorSqlRaw?.reasonCodes),
    ...readStringArray(savedPriorSqlRaw?.reason_codes)
  ]);
  const savedPriorSql: SavedPriorSqlLayer | undefined =
    savedPriorStatus && savedPriorShortcutUsed !== undefined
      ? {
          status: savedPriorStatus,
          shortcutUsed: savedPriorShortcutUsed,
          ...(savedPriorReasonCodes.length > 0
            ? { reasonCodes: savedPriorReasonCodes }
            : {}),
          ...(readString(
            savedPriorSqlRaw?.selectedChunkId ?? savedPriorSqlRaw?.selected_chunk_id
          )
            ? {
                selectedChunkId: readString(
                  savedPriorSqlRaw?.selectedChunkId ??
                    savedPriorSqlRaw?.selected_chunk_id
                )
              }
            : {}),
          ...(readString(
            savedPriorSqlRaw?.selectedViewId ?? savedPriorSqlRaw?.selected_view_id
          )
            ? {
                selectedViewId: readString(
                  savedPriorSqlRaw?.selectedViewId ??
                    savedPriorSqlRaw?.selected_view_id
                )
              }
            : {}),
          ...(readString(
            savedPriorSqlRaw?.selectedViewName ?? savedPriorSqlRaw?.selected_view_name
          )
            ? {
                selectedViewName: readString(
                  savedPriorSqlRaw?.selectedViewName ??
                    savedPriorSqlRaw?.selected_view_name
                )
              }
            : {}),
          ...(readString(
            savedPriorSqlRaw?.selectedSourceRunId ??
              savedPriorSqlRaw?.selected_source_run_id
          )
            ? {
                selectedSourceRunId: readString(
                  savedPriorSqlRaw?.selectedSourceRunId ??
                    savedPriorSqlRaw?.selected_source_run_id
                )
              }
            : {}),
          ...(savedPriorSafetyResult ? { safetyResult: savedPriorSafetyResult } : {})
        }
      : undefined;

  const normalized: DeliveryEvidenceLayer = {
    runId,
    ...(retrievalStatus ? { retrievalStatus } : {}),
    ...(degradeReasons.length > 0 ? { degradeReasons } : {}),
    ...(selectedContext ? { selectedContext } : {}),
    ...(retrievalLogs.length > 0 ? { retrievalLogs } : {}),
    ...(riskTags.length > 0 ? { riskTags } : {}),
    ...(semanticVersion !== undefined ? { semanticVersion } : {}),
    ...(semanticLockStatus ? { semanticLockStatus } : {}),
    ...(semanticDegradeReason ? { semanticDegradeReason } : {}),
    ...(skillContextSummary ? { skillContextSummary } : {}),
    ...(savedPriorSql ? { savedPriorSql } : {}),
    ...(evidenceStale !== undefined ? { evidenceStale } : {})
  };

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeSummaryArtifact(value: unknown): unknown {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }
  return sanitizeJsonValue(value);
}

function normalizeTableArtifact(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const columns = readStringArray(value.columns);
  const rowsPreview =
    readRecordArray(value.rowsPreview) ??
    readRecordArray(value.rows_preview) ??
    readRecordArray(value.rows);
  const rowCountRaw =
    readNumber(value.rowCount) ?? readNumber(value.row_count) ?? rowsPreview?.length;
  const previewRowsRaw =
    readNumber(value.previewRows) ?? readNumber(value.preview_rows);
  const totalRowsRaw = readNumber(value.totalRows) ?? readNumber(value.total_rows);
  const truncated = readBoolean(value.truncated);

  const normalized: JsonRecord = {
    ...(columns.length > 0 ? { columns } : {}),
    ...(rowCountRaw !== undefined
      ? { rowCount: Math.max(0, Math.floor(rowCountRaw)) }
      : {}),
    ...(rowsPreview && rowsPreview.length > 0 ? { rowsPreview } : {}),
    ...(previewRowsRaw !== undefined
      ? { previewRows: Math.max(0, Math.floor(previewRowsRaw)) }
      : {}),
    ...(totalRowsRaw !== undefined
      ? { totalRows: Math.max(0, Math.floor(totalRowsRaw)) }
      : {}),
    ...(truncated !== undefined ? { truncated } : {})
  };

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeChartMappings(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const normalized = Object.entries(value).reduce<JsonRecord>((acc, [key, mapping]) => {
    const next = readString(mapping);
    if (next) {
      acc[key] = next;
    }
    return acc;
  }, {});
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeChartArtifact(value: unknown): {
  chart?: JsonRecord;
  invalidReason?: string;
} {
  if (!isRecord(value)) {
    return {};
  }

  const typeRaw = readString(value.type) ?? readString(value.chartType) ?? readString(value.chart_type);
  const type = typeRaw?.toLowerCase() as DeliveryDisplayType | undefined;
  if (!type || !CHART_TYPE_ALLOWLIST.has(type as Exclude<DeliveryDisplayType, "table">)) {
    return { invalidReason: "invalid_chart_type" };
  }

  const mappings = normalizeChartMappings(
    value.mappings ?? value.mapping ?? value.fields
  );
  if (!mappings) {
    return { invalidReason: "missing_chart_mappings" };
  }

  const series = readRecordArray(value.series)
    ?.map((item) => sanitizeJsonValue(item))
    .filter((item): item is JsonRecord => isRecord(item));
  const meta = sanitizeJsonValue(value.meta);

  const chart: JsonRecord = {
    type,
    mappings,
    ...(series && series.length > 0 ? { series } : {}),
    ...(meta && isRecord(meta) ? { meta } : {}),
    ...(readString(value.title) ? { title: readString(value.title) } : {}),
    ...(readString(value.description) ? { description: readString(value.description) } : {})
  };

  return { chart };
}

function normalizeDisplayArtifact(value: unknown): JsonRecord | undefined {
  if (typeof value === "string") {
    const type = normalizeDisplayType(value);
    return type ? { type } : undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const type =
    normalizeDisplayType(value.type) ??
    normalizeDisplayType(value.displayType) ??
    normalizeDisplayType(value.display_type);
  const normalized: JsonRecord = {
    ...(type ? { type } : {}),
    ...(readString(value.title) ? { title: readString(value.title) } : {}),
    ...(readString(value.label) ? { label: readString(value.label) } : {}),
    ...(readString(value.description) ? { description: readString(value.description) } : {})
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeValidationArtifact(value: unknown): JsonRecord | undefined {
  if (typeof value === "string") {
    return value.trim().length > 0 ? { status: value.trim() } : undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const status =
    readString(value.status) ??
    readString(value.validationStatus) ??
    readString(value.validation_status);
  const warnings = readStringArray(value.warnings);
  const errors = readStringArray(value.errors);
  const normalized: JsonRecord = {
    ...(status ? { status } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(errors.length > 0 ? { errors } : {})
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeFallbackArtifact(value: unknown): JsonRecord | undefined {
  if (typeof value === "string") {
    const reason = value.trim();
    return reason.length > 0 ? { reason } : undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const reason = readString(value.reason) ?? readString(value.fallbackReason) ?? readString(value.fallback_reason);
  const code = readString(value.code);
  const target =
    normalizeDisplayType(value.target) ??
    normalizeDisplayType(value.displayType) ??
    normalizeDisplayType(value.display_type) ??
    normalizeDisplayType(value.to);
  const normalized: JsonRecord = {
    ...(reason ? { reason } : {}),
    ...(code ? { code } : {}),
    ...(target ? { target } : {})
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeVisualIntentArtifact(value: unknown): JsonRecord | undefined {
  const normalized = sanitizeJsonValue(value);
  return normalized && isRecord(normalized) ? normalized : undefined;
}

function normalizeArtifact(value: unknown): DeliveryArtifactLayer | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const summary = normalizeSummaryArtifact(value.summary);
  const table = normalizeTableArtifact(value.table);
  const { chart: rawChart, invalidReason: chartInvalidReason } = normalizeChartArtifact(
    value.chart
  );
  const normalizedDisplay = normalizeDisplayArtifact(
    value.display ?? value.displayType ?? value.display_type
  );
  const normalizedValidation = normalizeValidationArtifact(value.validation);
  const normalizedFallback = normalizeFallbackArtifact(value.fallback);
  const normalizedVisualIntent = normalizeVisualIntentArtifact(
    value.visualIntent ?? value.visual_intent
  );

  const legacyColumns = readStringArray(value.columns);
  const tableColumns = readStringArray(table?.columns);
  const columns = legacyColumns.length > 0 ? legacyColumns : tableColumns;

  const legacyRowsPreview =
    readRecordArray(value.rowsPreview) ?? readRecordArray(value.rows_preview);
  const tableRowsPreview = readRecordArray(table?.rowsPreview);
  const rowsPreview = legacyRowsPreview ?? tableRowsPreview;

  const legacyRowCount = readNumber(value.rowCount) ?? readNumber(value.row_count);
  const tableRowCount = readNumber(table?.rowCount);
  const rowCountRaw = legacyRowCount ?? tableRowCount ?? rowsPreview?.length;
  const hasErrorRaw = readBoolean(value.hasError) ?? readBoolean(value.has_error);
  const hasError = hasErrorRaw ?? false;

  const hasAnyArtifactSignal =
    readString(value.sql) !== undefined ||
    columns.length > 0 ||
    (rowsPreview?.length ?? 0) > 0 ||
    rowCountRaw !== undefined ||
    hasErrorRaw !== undefined ||
    summary !== undefined ||
    table !== undefined ||
    rawChart !== undefined ||
    normalizedDisplay !== undefined ||
    normalizedValidation !== undefined ||
    normalizedFallback !== undefined ||
    normalizedVisualIntent !== undefined;
  if (!hasAnyArtifactSignal) {
    return undefined;
  }

  const fallback: JsonRecord | undefined =
    chartInvalidReason || normalizedFallback
      ? {
          ...(normalizedFallback ?? {}),
          ...(chartInvalidReason && !readString(normalizedFallback?.reason)
            ? { reason: chartInvalidReason }
            : {}),
          ...((chartInvalidReason && !normalizeDisplayType(normalizedFallback?.target))
            ? { target: "table" }
            : {})
        }
      : undefined;

  const validation: JsonRecord | undefined =
    chartInvalidReason || normalizedValidation
      ? {
          ...(normalizedValidation ?? {}),
          ...(chartInvalidReason && !readString(normalizedValidation?.status)
            ? { status: "fallback" }
            : {})
        }
      : undefined;

  const displayTypeFromDisplay = normalizeDisplayType(normalizedDisplay?.type);
  const displayType: DeliveryDisplayType =
    chartInvalidReason
      ? "table"
      : displayTypeFromDisplay ?? ((rawChart?.type as DeliveryDisplayType | undefined) ?? "table");
  const shouldAttachDisplay =
    normalizedDisplay !== undefined ||
    rawChart !== undefined ||
    chartInvalidReason !== undefined ||
    table !== undefined ||
    summary !== undefined ||
    normalizedValidation !== undefined ||
    normalizedFallback !== undefined ||
    normalizedVisualIntent !== undefined ||
    value.display !== undefined ||
    value.displayType !== undefined ||
    value.display_type !== undefined;
  const display: JsonRecord | undefined = shouldAttachDisplay
    ? {
        ...(normalizedDisplay ?? {}),
        type: displayType
      }
    : undefined;

  const normalized: DeliveryArtifactLayer & JsonRecord = {
    sql: readString(value.sql),
    columns: columns.length > 0 ? columns : undefined,
    rowCount: Math.max(0, Math.floor(rowCountRaw ?? 0)),
    rowsPreview: rowsPreview && rowsPreview.length > 0 ? rowsPreview : undefined,
    hasError
  };
  const normalizedRecord = normalized as JsonRecord;
  if (summary !== undefined) {
    normalizedRecord.summary = summary;
  }
  if (table) {
    normalizedRecord.table = table;
  }
  if (rawChart && !chartInvalidReason) {
    normalizedRecord.chart = rawChart;
  }
  if (display !== undefined) {
    normalizedRecord.display = display;
  }
  if (validation) {
    normalizedRecord.validation = validation;
  }
  if (fallback) {
    normalizedRecord.fallback = fallback;
  }
  if (normalizedVisualIntent) {
    normalizedRecord.visualIntent = normalizedVisualIntent;
  }

  return normalized;
}

export function normalizeDeliveryContract(value: unknown): DeliveryContract | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const answerRaw = isRecord(value.answer) ? value.answer : undefined;
  if (!answerRaw) {
    return undefined;
  }

  const text = readString(answerRaw.text);
  const provider = readString(answerRaw.provider);
  const statusRaw = readString(answerRaw.status);
  const status: RunStatus =
    statusRaw === "clarification" ||
    statusRaw === "executionResult" ||
    statusRaw === "rejected" ||
    statusRaw === "failed"
      ? statusRaw
      : "executionResult";

  if (!text || !provider) {
    return undefined;
  }

  const evidence = normalizeEvidence(value.evidence);
  const artifact = normalizeArtifact(value.artifact);

  return {
    answer: {
      text,
      status,
      provider,
      model: readString(answerRaw.model)
    },
    ...(evidence ? { evidence } : {}),
    ...(artifact ? { artifact } : {})
  };
}

export function normalizeRunForVisibility(run: SqlRun): SqlRun {
  if (!run.delivery) {
    return run;
  }
  const normalizedDelivery = normalizeDeliveryContract(run.delivery);
  if (!normalizedDelivery) {
    return run;
  }
  return {
    ...run,
    delivery: normalizedDelivery
  };
}

function stepKey(step: RunVisibilityThinkingStep): string {
  return (
    step.stepId ??
    `${step.node}:${step.sequence ?? "na"}:${step.at ?? step.startedAt ?? step.endedAt ?? "na"}`
  );
}

function isTerminalStep(step: RunVisibilityThinkingStep): boolean {
  if (
    step.lifecycle === "completed" ||
    step.lifecycle === "failed" ||
    step.lifecycle === "skipped"
  ) {
    return true;
  }
  if (step.lifecycle === "running") {
    return false;
  }
  return step.status === "success" || step.status === "failed" || step.status === "skipped";
}

function stepEventTimestamp(step: RunVisibilityThinkingStep): number {
  const candidate = step.endedAt ?? step.at ?? step.startedAt;
  if (!candidate) {
    return Number.NEGATIVE_INFINITY;
  }
  const parsed = Date.parse(candidate);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function mergeThinkingStep(
  current: RunVisibilityThinkingStep,
  incoming: RunVisibilityThinkingStep
): RunVisibilityThinkingStep {
  const currentTerminal = isTerminalStep(current);
  const incomingTerminal = isTerminalStep(incoming);

  if (currentTerminal !== incomingTerminal) {
    const terminal = currentTerminal ? current : incoming;
    const nonTerminal = currentTerminal ? incoming : current;
    return {
      ...nonTerminal,
      ...terminal
    };
  }

  const currentTime = stepEventTimestamp(current);
  const incomingTime = stepEventTimestamp(incoming);
  const preferIncoming =
    incomingTime > currentTime ||
    (incomingTime === currentTime &&
      (incoming.sequence ?? Number.NEGATIVE_INFINITY) >=
        (current.sequence ?? Number.NEGATIVE_INFINITY));
  const preferred = preferIncoming ? incoming : current;
  const fallback = preferIncoming ? current : incoming;
  const merged = {
    ...fallback,
    ...preferred
  };

  if (
    currentTerminal &&
    incomingTerminal &&
    (current.status === "failed" ||
      current.lifecycle === "failed" ||
      incoming.status === "failed" ||
      incoming.lifecycle === "failed")
  ) {
    merged.status = "failed";
    merged.lifecycle = "failed";
  }

  return merged;
}

export function mergeRunThinkingSteps(
  syncSteps: ExecutionTraceStep[] | undefined,
  streamSteps: RunVisibilityThinkingStep[] | undefined
): RunVisibilityThinkingStep[] {
  const merged = new Map<string, RunVisibilityThinkingStep>();

  for (const step of syncSteps ?? []) {
    merged.set(stepKey(step), step);
  }
  for (const step of streamSteps ?? []) {
    const key = stepKey(step);
    const current = merged.get(key);
    merged.set(key, current ? mergeThinkingStep(current, step) : step);
  }

  return Array.from(merged.values()).sort((left, right) => {
    const leftSequence = left.sequence ?? Number.MAX_SAFE_INTEGER;
    const rightSequence = right.sequence ?? Number.MAX_SAFE_INTEGER;
    if (leftSequence !== rightSequence) {
      return leftSequence - rightSequence;
    }
    const leftTime = left.at ?? left.startedAt ?? left.endedAt ?? "";
    const rightTime = right.at ?? right.startedAt ?? right.endedAt ?? "";
    return leftTime.localeCompare(rightTime);
  });
}

export function toRunVisibilityStatusFromRunStatus(
  status: RunStatus | undefined
): RunVisibilityStatus | undefined {
  if (!status) {
    return undefined;
  }
  if (status === "failed" || status === "rejected") {
    return "error";
  }
  if (status === "clarification") {
    return "empty";
  }
  return "success";
}

export function transitionRunVisibilityStatus(
  previous: RunVisibilityStatus | undefined,
  next: RunVisibilityStatus | undefined
): RunVisibilityStatus | undefined {
  if (!next) {
    return previous;
  }
  if ((previous === "success" || previous === "error" || previous === "empty") && next === "loading") {
    return previous;
  }
  return next;
}

export function resolveRunVisibilityStatus(input: {
  runStatus?: RunStatus;
  streamStatus?: RunVisibilityStatus;
  activeStream?: boolean;
}): RunVisibilityStatus | undefined {
  let next = input.streamStatus;
  if (input.activeStream) {
    next = transitionRunVisibilityStatus(next, "loading");
  }
  if (input.runStatus) {
    next = transitionRunVisibilityStatus(
      next,
      toRunVisibilityStatusFromRunStatus(input.runStatus)
    );
  }
  return next;
}

export function resolveVisibleDelivery(input: {
  runDelivery?: unknown;
  streamDelivery?: unknown;
  answerText?: string;
  runStatus?: RunStatus;
  runProvider?: string;
  runModel?: string;
}): DeliveryContract | undefined {
  const fromRun = normalizeDeliveryContract(input.runDelivery);
  const fromStream = normalizeDeliveryContract(input.streamDelivery);
  if (fromRun && fromStream) {
    const runArtifact = fromRun.artifact as DeliveryArtifactCompat | undefined;
    const streamArtifact = fromStream.artifact as DeliveryArtifactCompat | undefined;
    if (!runArtifact && !streamArtifact) {
      return fromRun;
    }
    if (!runArtifact && streamArtifact) {
      return {
        ...fromRun,
        artifact: streamArtifact
      };
    }
    if (!runArtifact || !streamArtifact) {
      return fromRun;
    }

    // Preserve historical run-first semantics; only fill newly added artifact fields from stream.
    const mergedArtifact = {
      ...runArtifact
    } as DeliveryArtifactLayer & JsonRecord;
    const mergedArtifactRecord = mergedArtifact as JsonRecord;
    const streamArtifactRecord = streamArtifact as JsonRecord;
    for (const field of EXTENDED_ARTIFACT_FIELDS) {
      if (
        mergedArtifactRecord[field] === undefined &&
        streamArtifactRecord[field] !== undefined
      ) {
        mergedArtifactRecord[field] = streamArtifactRecord[field] ?? undefined;
      }
    }
    return {
      ...fromRun,
      artifact: mergedArtifact
    };
  }
  if (fromRun) {
    return fromRun;
  }
  if (fromStream) {
    return fromStream;
  }
  const text = input.answerText?.trim();
  if (!text) {
    return undefined;
  }
  return {
    answer: {
      text,
      status: input.runStatus ?? "executionResult",
      provider: input.runProvider ?? "unknown",
      ...(input.runModel ? { model: input.runModel } : {})
    }
  };
}
