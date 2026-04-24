import { Injectable } from "@nestjs/common";
import type { SqlTableAccessContext } from "../../../data/query/sql-table-access-guard.service";
import { RelationshipDryRunService, type RelationshipDryRunResult } from "./relationship-dry-run.service";

type RelationshipGraphEdgeDefinition = {
  bridge: {
    left: {
      dataset: string;
      table: string;
      column: string;
    };
    right: {
      dataset: string;
      table: string;
      column: string;
    };
    operator: string;
    confidence: number;
  };
};

export interface RelationshipPublishGateResult {
  pass: boolean;
  riskLevel: "low" | "medium" | "high";
  blockingReasons: string[];
  dryRun: RelationshipDryRunResult;
}

@Injectable()
export class RelationshipPublishGateFacade {
  constructor(private readonly relationshipDryRunService: RelationshipDryRunService) {}

  async evaluate(input: {
    datasourceId: string;
    edges: RelationshipGraphEdgeDefinition[];
    representativeSqlSamples: string[];
    allowedTables: string[];
    accessContext: SqlTableAccessContext;
  }): Promise<RelationshipPublishGateResult> {
    const risk = this.estimateRisk(input.edges);
    const dryRun = await this.relationshipDryRunService.execute({
      datasourceId: input.datasourceId,
      sqlSamples: input.representativeSqlSamples,
      allowedTables: input.allowedTables,
      accessContext: input.accessContext
    });

    const blockingReasons = [...risk.blockingReasons];
    if (!dryRun.pass) {
      blockingReasons.push("dry_run_failed");
    }

    return {
      pass: blockingReasons.length === 0,
      riskLevel: risk.riskLevel,
      blockingReasons,
      dryRun
    };
  }

  private estimateRisk(edges: RelationshipGraphEdgeDefinition[]): {
    riskLevel: "low" | "medium" | "high";
    blockingReasons: string[];
  } {
    let duplicateCount = 0;
    let lowConfidenceCount = 0;
    const dedup = new Set<string>();
    for (const edge of edges) {
      const key = `${edge.bridge.left.dataset}.${edge.bridge.left.table}.${edge.bridge.left.column}:${edge.bridge.right.dataset}.${edge.bridge.right.table}.${edge.bridge.right.column}:${edge.bridge.operator}`;
      if (dedup.has(key)) {
        duplicateCount += 1;
      } else {
        dedup.add(key);
      }
      if (edge.bridge.confidence < 0.4) {
        lowConfidenceCount += 1;
      }
    }
    const blockingReasons: string[] = [];
    if (duplicateCount > 0) {
      blockingReasons.push("duplicate_relationship_edges_detected");
    }
    if (lowConfidenceCount > 0) {
      blockingReasons.push("low_confidence_relationship_edges_detected");
    }

    const riskLevel: "low" | "medium" | "high" =
      blockingReasons.length > 0
        ? "high"
        : edges.length >= 12
          ? "medium"
          : "low";
    return {
      riskLevel,
      blockingReasons
    };
  }
}
