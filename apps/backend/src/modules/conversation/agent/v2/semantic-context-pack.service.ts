import { Injectable } from "@nestjs/common";
import type { SemanticContextPackV1 } from "@text2sql/shared-types";

interface SemanticContextChunkPayload {
  chunk_id: string;
  content?: string;
  metadata?: unknown;
}

interface SemanticContextRetrievalBundle {
  status?: "ready" | "degraded";
  selected_context?: SemanticContextChunkPayload[];
  degrade_reasons?: string[];
  degradeReasons?: string[];
  permission_filtering?: {
    status?: "applied" | "skipped";
    denied_evidence_ids?: string[];
    denied_table_names?: string[];
    denied_column_names?: string[];
    reason_codes?: string[];
    deniedEvidenceIds?: string[];
    deniedTableNames?: string[];
    deniedColumnNames?: string[];
    reasonCodes?: string[];
  };
  permissionFiltering?: {
    status?: "applied" | "skipped";
    denied_evidence_ids?: string[];
    denied_table_names?: string[];
    denied_column_names?: string[];
    reason_codes?: string[];
    deniedEvidenceIds?: string[];
    deniedTableNames?: string[];
    deniedColumnNames?: string[];
    reasonCodes?: string[];
  };
  lane_results?: Record<
    string,
    {
      status?: "ok" | "degraded";
      degrade_reason?: string;
    }
  >;
  rerank_metadata?: {
    secondary?: {
      status?: "ok" | "degraded" | "skipped";
      unavailable_reason?: string;
      fallback_reason?: string;
    };
  };
  context_pack?: {
    semantic_version?: number;
    semanticVersion?: number;
    semantic_bindings?: {
      model_keys?: string[];
      relationship_keys?: string[];
      metric_keys?: string[];
      calculated_field_keys?: string[];
      modelKeys?: string[];
      relationshipKeys?: string[];
      metricKeys?: string[];
      calculatedFieldKeys?: string[];
    };
    lane_metadata?: Array<{
      lane?: string;
      state?: string;
      unavailable_reason?: string;
      fallback_reason?: string;
      evidence_ids?: string[];
      reason_codes?: string[];
      unavailableReason?: string;
      fallbackReason?: string;
      evidenceIds?: string[];
      reasonCodes?: string[];
    }>;
    laneMetadata?: Array<{
      lane?: string;
      state?: string;
      unavailable_reason?: string;
      fallback_reason?: string;
      evidence_ids?: string[];
      reason_codes?: string[];
      unavailableReason?: string;
      fallbackReason?: string;
      evidenceIds?: string[];
      reasonCodes?: string[];
    }>;
    pruning_decisions?: Array<{
      budget_source?: string;
      budgetSource?: string;
      kept_evidence_ids?: string[];
      keptEvidenceIds?: string[];
      reason_codes?: string[];
      reasonCodes?: string[];
      summary?: string;
    }>;
    pruningDecisions?: Array<{
      budget_source?: string;
      budgetSource?: string;
      kept_evidence_ids?: string[];
      keptEvidenceIds?: string[];
      reason_codes?: string[];
      reasonCodes?: string[];
      summary?: string;
    }>;
    permission_filtering?: {
      status?: "applied" | "skipped";
      denied_evidence_ids?: string[];
      denied_table_names?: string[];
      denied_column_names?: string[];
      reason_codes?: string[];
      deniedEvidenceIds?: string[];
      deniedTableNames?: string[];
      deniedColumnNames?: string[];
      reasonCodes?: string[];
    };
    permissionFiltering?: {
      status?: "applied" | "skipped";
      denied_evidence_ids?: string[];
      denied_table_names?: string[];
      denied_column_names?: string[];
      reason_codes?: string[];
      deniedEvidenceIds?: string[];
      deniedTableNames?: string[];
      deniedColumnNames?: string[];
      reasonCodes?: string[];
    };
  };
}

interface BuildSemanticContextPackInput {
  retrievalBundle?: SemanticContextRetrievalBundle;
  selectedContext?: SemanticContextChunkPayload[];
  additionalWarnings?: string[];
}

@Injectable()
export class SemanticContextPackService {
  build(input: BuildSemanticContextPackInput): SemanticContextPackV1 {
    const selectedContext =
      input.selectedContext ?? input.retrievalBundle?.selected_context ?? [];
    const laneMetadata = this.readLaneMetadata(input.retrievalBundle);
    const pruningDecisions = this.readPruningDecisions(input.retrievalBundle);
    const permissionFiltering = this.readPermissionFiltering(input.retrievalBundle);
    const selectedEvidenceIds = this.unique([
      ...selectedContext.map((chunk) => chunk.chunk_id),
      ...laneMetadata.flatMap((lane) => this.readEvidenceIds(lane)),
      ...pruningDecisions.flatMap((decision) => this.readKeptEvidenceIds(decision))
    ]).slice(0, 64);

    const semanticBindings = input.retrievalBundle?.context_pack?.semantic_bindings;

    const selectedTables = this.unique(
      [
        ...selectedContext.flatMap((chunk) => this.readMetadataStringArray(chunk.metadata, "tableNames")),
        ...(semanticBindings?.model_keys ?? semanticBindings?.modelKeys ?? [])
      ]
        .map((value) => this.normalizeIdentifier(value))
        .filter((value): value is string => Boolean(value))
    );

    const selectedColumns = this.unique(
      [
        ...selectedContext.flatMap((chunk) =>
          this.readMetadataStringArray(chunk.metadata, "columnNames")
        )
      ]
        .map((value) => this.normalizeIdentifier(value))
        .filter((value): value is string => Boolean(value))
    );

    const denseUnavailableWarning = this.resolveDenseUnavailableWarning(input.retrievalBundle);
    const rerankUnavailableWarning = this.resolveRerankUnavailableWarning(input.retrievalBundle);
    const laneWarnings = laneMetadata.flatMap((lane) => this.toLaneWarnings(lane));
    const pruningWarnings = pruningDecisions.flatMap((decision) =>
      this.toPruningWarnings(decision)
    );
    const permissionWarnings = this.toPermissionWarnings(permissionFiltering);
    const semanticVersion = this.readSemanticVersion(input.retrievalBundle?.context_pack);

    const warnings = this.unique([
      ...(input.retrievalBundle?.degrade_reasons ?? []),
      ...(input.retrievalBundle?.degradeReasons ?? []),
      ...(semanticVersion !== undefined ? [`context_pack_semantic_version:${semanticVersion}`] : []),
      ...(denseUnavailableWarning ? [denseUnavailableWarning] : []),
      ...(rerankUnavailableWarning ? [rerankUnavailableWarning] : []),
      ...laneWarnings,
      ...pruningWarnings,
      ...permissionWarnings,
      ...(input.additionalWarnings ?? [])
    ]);

    return {
      status: input.retrievalBundle?.status ?? (selectedContext.length > 0 ? "ready" : "degraded"),
      selectedEvidenceIds,
      selectedTables,
      selectedColumns,
      ...(warnings.length > 0 ? { warnings } : {})
    };
  }

  private normalizeIdentifier(value: string | undefined): string | undefined {
    if (!value) {
      return undefined;
    }
    const normalized = value
      .trim()
      .replace(/^[`"'\[\]]+|[`"'\[\]]+$/g, "")
      .replace(/\s+/g, "");
    if (!normalized) {
      return undefined;
    }
    return normalized.toLowerCase();
  }

  private unique(values: string[]): string[] {
    return Array.from(new Set(values.filter((item) => item.trim().length > 0)));
  }

  private readMetadataStringArray(metadata: unknown, key: string): string[] {
    if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
      return [];
    }
    const value = (metadata as Record<string, unknown>)[key];
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((item): item is string => typeof item === "string");
  }

  private resolveDenseUnavailableWarning(
    bundle: SemanticContextRetrievalBundle | undefined
  ): string | undefined {
    const denseDegradeReason = bundle?.lane_results?.dense?.degrade_reason;
    if (!denseDegradeReason) {
      return undefined;
    }
    if (denseDegradeReason.includes("dense_unavailable")) {
      return `dense_unavailable:${denseDegradeReason}`;
    }
    return undefined;
  }

  private resolveRerankUnavailableWarning(
    bundle: SemanticContextRetrievalBundle | undefined
  ): string | undefined {
    const secondary = bundle?.rerank_metadata?.secondary;
    if (!secondary) {
      return undefined;
    }
    if (secondary.unavailable_reason) {
      return `rerank_unavailable:${secondary.unavailable_reason}`;
    }
    if (secondary.status === "degraded" && secondary.fallback_reason) {
      return `rerank_degraded:${secondary.fallback_reason}`;
    }
    return undefined;
  }

  private toLaneWarnings(lane: {
    lane?: string;
    state?: string;
    unavailable_reason?: string;
    fallback_reason?: string;
    reason_codes?: string[];
    unavailableReason?: string;
    fallbackReason?: string;
    reasonCodes?: string[];
  }): string[] {
    const laneName = lane.lane?.trim();
    if (!laneName) {
      return [];
    }
    const warnings: string[] = [];
    if (lane.state && lane.state !== "ready") {
      warnings.push(`${laneName}_state:${lane.state}`);
    }
    const unavailableReason = lane.unavailable_reason ?? lane.unavailableReason;
    if (lane.state === "unavailable" && unavailableReason) {
      warnings.push(`${laneName}_unavailable:${unavailableReason}`);
    }
    const fallbackReason = lane.fallback_reason ?? lane.fallbackReason;
    if (lane.state === "degraded" && fallbackReason) {
      warnings.push(`${laneName}_degraded:${fallbackReason}`);
    }
    const reasonCodes = lane.reason_codes ?? lane.reasonCodes ?? [];
    for (const code of reasonCodes) {
      if (code.trim().length > 0) {
        warnings.push(`${laneName}_reason:${code}`);
      }
    }
    return warnings;
  }

  private toPruningWarnings(decision: {
    budget_source?: string;
    budgetSource?: string;
    reason_codes?: string[];
    reasonCodes?: string[];
    summary?: string;
  }): string[] {
    const budgetSource = (decision.budget_source ?? decision.budgetSource)?.trim();
    const reasonCodes = (decision.reason_codes ?? decision.reasonCodes ?? []).filter(
      (reason) => reason.trim().length > 0
    );
    if (!budgetSource && reasonCodes.length === 0 && !decision.summary) {
      return [];
    }
    const warnings: string[] = [];
    if (decision.summary && decision.summary.trim().length > 0) {
      warnings.push(`pruning_summary:${decision.summary}`);
    }
    for (const reasonCode of reasonCodes) {
      warnings.push(`pruning_${budgetSource ?? "context"}:${reasonCode}`);
    }
    return warnings;
  }

  private toPermissionWarnings(permissionFiltering: {
    status?: "applied" | "skipped";
    denied_evidence_ids?: string[];
    denied_table_names?: string[];
    denied_column_names?: string[];
    reason_codes?: string[];
    deniedEvidenceIds?: string[];
    deniedTableNames?: string[];
    deniedColumnNames?: string[];
    reasonCodes?: string[];
  } | undefined): string[] {
    if (!permissionFiltering) {
      return [];
    }
    const deniedTables =
      permissionFiltering.denied_table_names ?? permissionFiltering.deniedTableNames ?? [];
    const deniedColumns =
      permissionFiltering.denied_column_names ?? permissionFiltering.deniedColumnNames ?? [];
    const reasonCodes = permissionFiltering.reason_codes ?? permissionFiltering.reasonCodes ?? [];
    const deniedEvidenceIds =
      permissionFiltering.denied_evidence_ids ?? permissionFiltering.deniedEvidenceIds ?? [];
    return this.unique([
      ...(permissionFiltering.status
        ? [`permission_filter_status:${permissionFiltering.status}`]
        : []),
      ...reasonCodes.map((code) => `permission_filter_reason:${code}`),
      ...deniedTables.map((table) => `permission_denied_table:${table}`),
      ...deniedColumns.map((column) => `permission_denied_column:${column}`),
      ...(deniedEvidenceIds.length > 0
        ? [`permission_denied_evidence_count:${deniedEvidenceIds.length}`]
        : [])
    ]);
  }

  private readLaneMetadata(
    bundle: SemanticContextRetrievalBundle | undefined
  ): Array<{
    lane?: string;
    state?: string;
    unavailable_reason?: string;
    fallback_reason?: string;
    evidence_ids?: string[];
    reason_codes?: string[];
    unavailableReason?: string;
    fallbackReason?: string;
    evidenceIds?: string[];
    reasonCodes?: string[];
  }> {
    return bundle?.context_pack?.lane_metadata ?? bundle?.context_pack?.laneMetadata ?? [];
  }

  private readPruningDecisions(
    bundle: SemanticContextRetrievalBundle | undefined
  ): Array<{
    budget_source?: string;
    budgetSource?: string;
    kept_evidence_ids?: string[];
    keptEvidenceIds?: string[];
    reason_codes?: string[];
    reasonCodes?: string[];
    summary?: string;
  }> {
    return bundle?.context_pack?.pruning_decisions ?? bundle?.context_pack?.pruningDecisions ?? [];
  }

  private readPermissionFiltering(bundle: SemanticContextRetrievalBundle | undefined):
    | {
        status?: "applied" | "skipped";
        denied_evidence_ids?: string[];
        denied_table_names?: string[];
        denied_column_names?: string[];
        reason_codes?: string[];
        deniedEvidenceIds?: string[];
        deniedTableNames?: string[];
        deniedColumnNames?: string[];
        reasonCodes?: string[];
      }
    | undefined {
    if (!bundle) {
      return undefined;
    }
    const rootBundle = bundle as SemanticContextRetrievalBundle & {
      permission_filtering?: {
        status?: "applied" | "skipped";
        denied_evidence_ids?: string[];
        denied_table_names?: string[];
        denied_column_names?: string[];
        reason_codes?: string[];
        deniedEvidenceIds?: string[];
        deniedTableNames?: string[];
        deniedColumnNames?: string[];
        reasonCodes?: string[];
      };
      permissionFiltering?: {
        status?: "applied" | "skipped";
        denied_evidence_ids?: string[];
        denied_table_names?: string[];
        denied_column_names?: string[];
        reason_codes?: string[];
        deniedEvidenceIds?: string[];
        deniedTableNames?: string[];
        deniedColumnNames?: string[];
        reasonCodes?: string[];
      };
    };
    return (
      bundle.context_pack?.permission_filtering ??
      bundle.context_pack?.permissionFiltering ??
      rootBundle.permission_filtering ??
      rootBundle.permissionFiltering
    );
  }

  private readEvidenceIds(lane: {
    evidence_ids?: string[];
    evidenceIds?: string[];
  }): string[] {
    return lane.evidence_ids ?? lane.evidenceIds ?? [];
  }

  private readKeptEvidenceIds(decision: {
    kept_evidence_ids?: string[];
    keptEvidenceIds?: string[];
  }): string[] {
    return decision.kept_evidence_ids ?? decision.keptEvidenceIds ?? [];
  }

  private readSemanticVersion(
    contextPack:
      | {
          semantic_version?: number;
          semanticVersion?: number;
        }
      | undefined
  ): number | undefined {
    return contextPack?.semantic_version ?? contextPack?.semanticVersion;
  }
}
