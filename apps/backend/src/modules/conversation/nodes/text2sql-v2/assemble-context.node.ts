import { Injectable } from "@nestjs/common";
import type { SemanticContextPackV1 } from "@text2sql/shared-types";
import { SemanticContextPackService } from "../../adapters/text2sql-v2/semantic-context-pack.service";

interface SemanticContextChunkPayload {
  chunk_id: string;
  content?: string;
  metadata?: unknown;
}

interface AssembleContextRetrievalBundle {
  status?: "ready" | "degraded";
  selected_context?: SemanticContextChunkPayload[];
  degrade_reasons?: string[];
  degradeReasons?: string[];
  context_pack?: {
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
    semanticBindings?: {
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
      denied_evidence_ids?: string[];
      reason_codes?: string[];
      unavailableReason?: string;
      fallbackReason?: string;
      evidenceIds?: string[];
      deniedEvidenceIds?: string[];
      reasonCodes?: string[];
    }>;
    laneMetadata?: Array<{
      lane?: string;
      state?: string;
      unavailable_reason?: string;
      fallback_reason?: string;
      evidence_ids?: string[];
      denied_evidence_ids?: string[];
      reason_codes?: string[];
      unavailableReason?: string;
      fallbackReason?: string;
      evidenceIds?: string[];
      deniedEvidenceIds?: string[];
      reasonCodes?: string[];
    }>;
    pruning_decisions?: Array<{
      budget_source?: string;
      kept_evidence_ids?: string[];
      removed_evidence_ids?: string[];
      reason_codes?: string[];
      budgetSource?: string;
      keptEvidenceIds?: string[];
      removedEvidenceIds?: string[];
      reasonCodes?: string[];
      summary?: string;
    }>;
    pruningDecisions?: Array<{
      budget_source?: string;
      kept_evidence_ids?: string[];
      removed_evidence_ids?: string[];
      reason_codes?: string[];
      budgetSource?: string;
      keptEvidenceIds?: string[];
      removedEvidenceIds?: string[];
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

export interface AssembleContextNodeInput {
  retrievalBundle?: AssembleContextRetrievalBundle;
  selectedContext?: SemanticContextChunkPayload[];
  additionalWarnings?: string[];
}

export interface AssembleContextNodeSummary {
  status: "ready" | "degraded";
  version?: string;
  capabilityCount: number;
  selectedEvidenceCount: number;
  selectedTableCount: number;
  selectedColumnCount: number;
  degradedLaneCount: number;
  laneStateCounts: {
    ready: number;
    degraded: number;
    unavailable: number;
    skipped: number;
  };
  pruningDecisionCount: number;
  permissionReasonCount: number;
  permissionDeniedEvidenceCount: number;
  warningCount: number;
}

export interface AssembleContextNodeOutput {
  contextPack: SemanticContextPackV1;
  typedSummary: AssembleContextNodeSummary;
  evidenceRefs: string[];
}

@Injectable()
export class AssembleContextNode {
  constructor(private readonly semanticContextPackService: SemanticContextPackService) {}

  run(input: AssembleContextNodeInput): AssembleContextNodeOutput {
    const contextPack = this.semanticContextPackService.build({
      retrievalBundle: input.retrievalBundle,
      selectedContext: input.selectedContext,
      additionalWarnings: input.additionalWarnings
    });
    const laneMetadata =
      input.retrievalBundle?.context_pack?.lane_metadata ??
      input.retrievalBundle?.context_pack?.laneMetadata ??
      [];
    const laneStateCounts = laneMetadata.reduce(
      (acc, lane) => {
        if (lane.state === "ready") {
          acc.ready += 1;
        } else if (lane.state === "unavailable") {
          acc.unavailable += 1;
        } else if (lane.state === "skipped") {
          acc.skipped += 1;
        } else {
          acc.degraded += 1;
        }
        return acc;
      },
      {
        ready: 0,
        degraded: 0,
        unavailable: 0,
        skipped: 0
      }
    );
    const pruningDecisions =
      input.retrievalBundle?.context_pack?.pruning_decisions ??
      input.retrievalBundle?.context_pack?.pruningDecisions ??
      [];
    const permissionReasonCodes =
      input.retrievalBundle?.context_pack?.permission_filtering?.reason_codes ??
      input.retrievalBundle?.context_pack?.permission_filtering?.reasonCodes ??
      input.retrievalBundle?.context_pack?.permissionFiltering?.reason_codes ??
      input.retrievalBundle?.context_pack?.permissionFiltering?.reasonCodes ??
      [];
    const degradedLaneCount =
      (contextPack.laneStates ?? []).filter((lane) => lane.state !== "ready").length;
    const permissionDeniedEvidenceCount =
      contextPack.permissionFiltering?.deniedEvidenceCount ?? 0;

    return {
      contextPack,
      typedSummary: {
        status: contextPack.status,
        version: contextPack.version,
        capabilityCount: contextPack.capabilities?.length ?? 0,
        selectedEvidenceCount: contextPack.selectedEvidenceIds.length,
        selectedTableCount: contextPack.selectedTables.length,
        selectedColumnCount: contextPack.selectedColumns.length,
        degradedLaneCount,
        laneStateCounts,
        pruningDecisionCount: pruningDecisions.length,
        permissionReasonCount: permissionReasonCodes.filter((item) => item.trim().length > 0)
          .length,
        permissionDeniedEvidenceCount,
        warningCount: contextPack.warnings?.length ?? 0
      },
      evidenceRefs: contextPack.selectedEvidenceIds.slice(0, 128)
    };
  }
}
