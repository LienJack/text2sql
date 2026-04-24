import { Injectable } from "@nestjs/common";
import type { RelationshipGraphEdgeDefinition } from "./relationship-bridge.types";

export type RelationshipImpactRiskLevel = "low" | "medium" | "high";

export interface RelationshipImpactSimulationResult {
  riskLevel: RelationshipImpactRiskLevel;
  affectedTableCount: number;
  duplicateEdgeCount: number;
  lowConfidenceEdgeCount: number;
  blockingReasons: string[];
  suggestedActions: string[];
}

@Injectable()
export class RelationshipImpactSimulatorService {
  simulate(input: {
    edges: RelationshipGraphEdgeDefinition[];
  }): RelationshipImpactSimulationResult {
    const tableSet = new Set<string>();
    const edgeDedup = new Set<string>();
    let duplicateEdgeCount = 0;
    let lowConfidenceEdgeCount = 0;

    for (const edge of input.edges) {
      const leftKey = `${edge.bridge.left.dataset}.${edge.bridge.left.table}`;
      const rightKey = `${edge.bridge.right.dataset}.${edge.bridge.right.table}`;
      tableSet.add(leftKey);
      tableSet.add(rightKey);

      const signature = `${leftKey}.${edge.bridge.left.column}:${rightKey}.${edge.bridge.right.column}:${edge.bridge.operator}`;
      if (edgeDedup.has(signature)) {
        duplicateEdgeCount += 1;
      } else {
        edgeDedup.add(signature);
      }

      if (edge.bridge.confidence < 0.4) {
        lowConfidenceEdgeCount += 1;
      }
    }

    const blockingReasons: string[] = [];
    if (duplicateEdgeCount > 0) {
      blockingReasons.push("duplicate_relationship_edges_detected");
    }
    if (lowConfidenceEdgeCount > 0) {
      blockingReasons.push("low_confidence_relationship_edges_detected");
    }

    const suggestedActions: string[] = [];
    if (duplicateEdgeCount > 0) {
      suggestedActions.push("remove_or_merge_duplicate_edges");
    }
    if (lowConfidenceEdgeCount > 0) {
      suggestedActions.push("review_bridge_keys_or_reduce_confidence");
    }
    if (blockingReasons.length === 0) {
      suggestedActions.push("safe_to_continue_dry_run_validation");
    }

    const riskLevel: RelationshipImpactRiskLevel =
      blockingReasons.length > 0
        ? "high"
        : input.edges.length >= 12
          ? "medium"
          : "low";

    return {
      riskLevel,
      affectedTableCount: tableSet.size,
      duplicateEdgeCount,
      lowConfidenceEdgeCount,
      blockingReasons,
      suggestedActions
    };
  }
}
