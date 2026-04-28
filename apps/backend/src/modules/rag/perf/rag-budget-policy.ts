import { Injectable } from "@nestjs/common";

export interface RagBudgetSignal {
  tokenPressure?: number;
  latencyPressure?: number;
  costPressure?: number;
}

export interface RagRetrievalBudgetDecision {
  perLaneLimit: number;
  finalCandidateLimit: number;
  enabledLanes: Array<"lexical" | "dense" | "graph">;
  decisionReasons: string[];
  degraded: boolean;
}

export interface RagRerankBudgetDecision {
  secondaryEnabled: boolean;
  secondaryTopK: number;
  decisionReasons: string[];
  degraded: boolean;
}

export interface RagPruningDecisionInput {
  budgetSource: "retrieval_budget" | "rerank_budget" | "context_pack";
  decisionReasons: string[];
  removedEvidenceIds: string[];
  keptEvidenceIds: string[];
}

export interface RagPruningDecision {
  budget_source: "retrieval_budget" | "rerank_budget" | "context_pack";
  removed_evidence_ids: string[];
  kept_evidence_ids: string[];
  reason_codes: string[];
  summary: string;
  budgetSource: "retrieval_budget" | "rerank_budget" | "context_pack";
  removedEvidenceIds: string[];
  keptEvidenceIds: string[];
  reasonCodes: string[];
}

const DEFAULT_PRESSURE_DEGRADE_THRESHOLD = 0.8;
const DEFAULT_PRESSURE_EXTREME_THRESHOLD = 0.95;
const ALL_RETRIEVAL_LANES: Array<"lexical" | "dense" | "graph"> = [
  "lexical",
  "dense",
  "graph"
];

@Injectable()
export class RagBudgetPolicy {
  planRetrieval(input: {
    requestedPerLaneLimit: number;
    requestedFinalCandidateLimit: number;
    signal?: RagBudgetSignal;
  }): RagRetrievalBudgetDecision {
    const signal = this.normalizeSignal(input.signal);
    const reasons: string[] = [];
    let perLaneLimit = Math.max(1, Math.floor(input.requestedPerLaneLimit));
    let finalCandidateLimit = Math.max(1, Math.floor(input.requestedFinalCandidateLimit));
    let enabledLanes: Array<"lexical" | "dense" | "graph"> = [...ALL_RETRIEVAL_LANES];

    if (signal.costPressure >= DEFAULT_PRESSURE_EXTREME_THRESHOLD) {
      perLaneLimit = Math.max(4, Math.floor(perLaneLimit * 0.4));
      finalCandidateLimit = Math.max(4, Math.floor(finalCandidateLimit * 0.4));
      reasons.push("budget_degrade_cost_extreme");
    } else if (signal.costPressure >= DEFAULT_PRESSURE_DEGRADE_THRESHOLD) {
      perLaneLimit = Math.max(6, Math.floor(perLaneLimit * 0.6));
      finalCandidateLimit = Math.max(6, Math.floor(finalCandidateLimit * 0.6));
      reasons.push("budget_degrade_cost");
    }

    if (signal.latencyPressure >= DEFAULT_PRESSURE_EXTREME_THRESHOLD) {
      perLaneLimit = Math.max(3, Math.floor(perLaneLimit * 0.5));
      finalCandidateLimit = Math.max(3, Math.floor(finalCandidateLimit * 0.5));
      reasons.push("budget_degrade_latency_extreme");
    } else if (signal.latencyPressure >= DEFAULT_PRESSURE_DEGRADE_THRESHOLD) {
      perLaneLimit = Math.max(5, Math.floor(perLaneLimit * 0.7));
      finalCandidateLimit = Math.max(5, Math.floor(finalCandidateLimit * 0.7));
      reasons.push("budget_degrade_latency");
    }

    if (signal.tokenPressure >= DEFAULT_PRESSURE_EXTREME_THRESHOLD) {
      finalCandidateLimit = Math.max(3, Math.floor(finalCandidateLimit * 0.5));
      reasons.push("budget_degrade_token_extreme");
    } else if (signal.tokenPressure >= DEFAULT_PRESSURE_DEGRADE_THRESHOLD) {
      finalCandidateLimit = Math.max(4, Math.floor(finalCandidateLimit * 0.7));
      reasons.push("budget_degrade_token");
    }

    const hasExtremePressure =
      signal.costPressure >= DEFAULT_PRESSURE_EXTREME_THRESHOLD ||
      signal.latencyPressure >= DEFAULT_PRESSURE_EXTREME_THRESHOLD ||
      signal.tokenPressure >= DEFAULT_PRESSURE_EXTREME_THRESHOLD;
    if (hasExtremePressure) {
      const denseOnlyMode =
        signal.latencyPressure >= DEFAULT_PRESSURE_EXTREME_THRESHOLD &&
        signal.costPressure < DEFAULT_PRESSURE_EXTREME_THRESHOLD &&
        signal.tokenPressure < DEFAULT_PRESSURE_EXTREME_THRESHOLD;
      enabledLanes = denseOnlyMode ? ["dense"] : ["lexical"];
      reasons.push(
        denseOnlyMode ? "budget_lane_single_dense" : "budget_lane_single_lexical",
        "degrade_level=maximum"
      );
    }

    return {
      perLaneLimit,
      finalCandidateLimit,
      enabledLanes,
      decisionReasons: this.unique(reasons),
      degraded: reasons.length > 0
    };
  }

  planRerank(input: {
    requestedSecondaryTopK: number;
    signal?: RagBudgetSignal;
  }): RagRerankBudgetDecision {
    const signal = this.normalizeSignal(input.signal);
    const reasons: string[] = [];
    let secondaryEnabled = true;
    let secondaryTopK = Math.max(1, Math.floor(input.requestedSecondaryTopK));

    if (signal.costPressure >= DEFAULT_PRESSURE_EXTREME_THRESHOLD) {
      secondaryEnabled = false;
      reasons.push("budget_secondary_rerank_disabled_cost_extreme");
    } else if (signal.latencyPressure >= DEFAULT_PRESSURE_EXTREME_THRESHOLD) {
      secondaryEnabled = false;
      reasons.push("budget_secondary_rerank_disabled_latency_extreme");
    } else if (signal.tokenPressure >= DEFAULT_PRESSURE_EXTREME_THRESHOLD) {
      secondaryEnabled = false;
      reasons.push("budget_secondary_rerank_disabled_token_extreme");
    } else {
      if (signal.costPressure >= DEFAULT_PRESSURE_DEGRADE_THRESHOLD) {
        secondaryTopK = Math.max(2, Math.floor(secondaryTopK * 0.6));
        reasons.push("budget_secondary_topk_cost");
      }
      if (signal.latencyPressure >= DEFAULT_PRESSURE_DEGRADE_THRESHOLD) {
        secondaryTopK = Math.max(2, Math.floor(secondaryTopK * 0.6));
        reasons.push("budget_secondary_topk_latency");
      }
      if (signal.tokenPressure >= DEFAULT_PRESSURE_DEGRADE_THRESHOLD) {
        secondaryTopK = Math.max(2, Math.floor(secondaryTopK * 0.7));
        reasons.push("budget_secondary_topk_token");
      }
    }

    if (!secondaryEnabled) {
      reasons.push("degrade_level=maximum");
    }

    return {
      secondaryEnabled,
      secondaryTopK,
      decisionReasons: this.unique(reasons),
      degraded: reasons.length > 0
    };
  }

  describePruningDecision(input: RagPruningDecisionInput): RagPruningDecision | undefined {
    const reasonCodes = this.unique(input.decisionReasons);
    if (reasonCodes.length === 0 && input.removedEvidenceIds.length === 0) {
      return undefined;
    }
    const summary = `${input.budgetSource}:removed=${input.removedEvidenceIds.length},kept=${input.keptEvidenceIds.length},reasons=${
      reasonCodes.join("|") || "none"
    }`;
    return {
      budget_source: input.budgetSource,
      removed_evidence_ids: this.unique(input.removedEvidenceIds),
      kept_evidence_ids: this.unique(input.keptEvidenceIds),
      reason_codes: reasonCodes,
      summary,
      budgetSource: input.budgetSource,
      removedEvidenceIds: this.unique(input.removedEvidenceIds),
      keptEvidenceIds: this.unique(input.keptEvidenceIds),
      reasonCodes: reasonCodes
    };
  }

  private normalizeSignal(signal: RagBudgetSignal | undefined): Required<RagBudgetSignal> {
    const normalize = (value: number | undefined): number => {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return 0;
      }
      return Math.max(0, Math.min(1, Number(value.toFixed(6))));
    };
    return {
      tokenPressure: normalize(signal?.tokenPressure),
      latencyPressure: normalize(signal?.latencyPressure),
      costPressure: normalize(signal?.costPressure)
    };
  }

  private unique(values: string[]): string[] {
    return Array.from(new Set(values.filter((item) => item.trim().length > 0)));
  }
}
