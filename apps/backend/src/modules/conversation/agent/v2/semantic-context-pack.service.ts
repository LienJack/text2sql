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
    semantic_bindings?: {
      model_keys?: string[];
      relationship_keys?: string[];
      metric_keys?: string[];
      calculated_field_keys?: string[];
    };
    lane_metadata?: Array<{
      lane?: string;
      state?: string;
      unavailable_reason?: string;
      fallback_reason?: string;
      evidence_ids?: string[];
      reason_codes?: string[];
    }>;
    pruning_decisions?: Array<{
      budget_source?: string;
      reason_codes?: string[];
      summary?: string;
    }>;
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
    const laneMetadata = input.retrievalBundle?.context_pack?.lane_metadata ?? [];
    const selectedEvidenceIds = this.unique([
      ...selectedContext.map((chunk) => chunk.chunk_id),
      ...laneMetadata.flatMap((lane) => lane.evidence_ids ?? [])
    ]).slice(0, 64);

    const semanticBindings = input.retrievalBundle?.context_pack?.semantic_bindings;

    const selectedTables = this.unique(
      [
        ...selectedContext.flatMap((chunk) => this.readMetadataStringArray(chunk.metadata, "tableNames")),
        ...(semanticBindings?.model_keys ?? [])
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
    const pruningWarnings =
      input.retrievalBundle?.context_pack?.pruning_decisions?.flatMap((decision) =>
        this.toPruningWarnings(decision)
      ) ?? [];

    const warnings = this.unique([
      ...(input.retrievalBundle?.degrade_reasons ?? []),
      ...(denseUnavailableWarning ? [denseUnavailableWarning] : []),
      ...(rerankUnavailableWarning ? [rerankUnavailableWarning] : []),
      ...laneWarnings,
      ...pruningWarnings,
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
  }): string[] {
    const laneName = lane.lane?.trim();
    if (!laneName) {
      return [];
    }
    const warnings: string[] = [];
    if (lane.state === "unavailable" && lane.unavailable_reason) {
      warnings.push(`${laneName}_unavailable:${lane.unavailable_reason}`);
    }
    if (lane.state === "degraded" && lane.fallback_reason) {
      warnings.push(`${laneName}_degraded:${lane.fallback_reason}`);
    }
    for (const code of lane.reason_codes ?? []) {
      if (code.trim().length > 0) {
        warnings.push(`${laneName}_reason:${code}`);
      }
    }
    return warnings;
  }

  private toPruningWarnings(decision: {
    budget_source?: string;
    reason_codes?: string[];
    summary?: string;
  }): string[] {
    const budgetSource = decision.budget_source?.trim();
    const reasonCodes = (decision.reason_codes ?? []).filter((reason) => reason.trim().length > 0);
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
}
