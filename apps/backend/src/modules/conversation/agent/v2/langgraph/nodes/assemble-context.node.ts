import { Injectable } from "@nestjs/common";
import type { SemanticContextPackV1 } from "@text2sql/shared-types";
import { SemanticContextPackService } from "../../semantic-context-pack.service";

interface SemanticContextChunkPayload {
  chunk_id: string;
  content?: string;
  metadata?: unknown;
}

interface AssembleContextRetrievalBundle {
  status?: "ready" | "degraded";
  selected_context?: SemanticContextChunkPayload[];
  context_pack?: {
    lane_metadata?: Array<{
      lane?: string;
      state?: string;
      reason_codes?: string[];
      reasonCodes?: string[];
    }>;
    laneMetadata?: Array<{
      lane?: string;
      state?: string;
      reason_codes?: string[];
      reasonCodes?: string[];
    }>;
    pruning_decisions?: Array<{
      reason_codes?: string[];
      reasonCodes?: string[];
    }>;
    pruningDecisions?: Array<{
      reason_codes?: string[];
      reasonCodes?: string[];
    }>;
    permission_filtering?: {
      reason_codes?: string[];
      reasonCodes?: string[];
    };
    permissionFiltering?: {
      reason_codes?: string[];
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
  selectedEvidenceCount: number;
  selectedTableCount: number;
  selectedColumnCount: number;
  laneStateCounts: {
    ready: number;
    degraded: number;
    unavailable: number;
    skipped: number;
  };
  pruningDecisionCount: number;
  permissionReasonCount: number;
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

    return {
      contextPack,
      typedSummary: {
        status: contextPack.status,
        selectedEvidenceCount: contextPack.selectedEvidenceIds.length,
        selectedTableCount: contextPack.selectedTables.length,
        selectedColumnCount: contextPack.selectedColumns.length,
        laneStateCounts,
        pruningDecisionCount: pruningDecisions.length,
        permissionReasonCount: permissionReasonCodes.filter((item) => item.trim().length > 0)
          .length,
        warningCount: contextPack.warnings?.length ?? 0
      },
      evidenceRefs: contextPack.selectedEvidenceIds.slice(0, 128)
    };
  }
}
