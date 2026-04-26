import { Injectable } from "@nestjs/common";

export interface Text2SqlV2EvalCase {
  id: string;
  question: string;
  retrievalRelevance: number;
  rerankLift: number;
  planCoveragePassed: boolean;
  validationPassed: boolean;
  correctionAttempted: boolean;
  correctionSucceeded: boolean;
  clarified: boolean;
  executionSucceeded: boolean;
  userVisibleFailureQuality: number;
  latencyMs: number;
  denseUnavailable: boolean;
  rerankUnavailable: boolean;
}

export interface Text2SqlV2EvalRolloutThresholds {
  minSamples: number;
  minRetrievalRelevance: number;
  minRerankLift: number;
  minPlanCoverageRate: number;
  minValidationPassRate: number;
  minCorrectionSuccessRate: number;
  minExecutionSuccessRate: number;
  minUserVisibleFailureQuality: number;
  maxClarificationRate: number;
  maxDenseUnavailableRate: number;
  maxRerankUnavailableRate: number;
  maxLatencyP95Ms: number;
}

export interface Text2SqlV2EvalRolloutRecommendation {
  gatePass: boolean;
  recommendedStage: "direct_v2_go" | "hold" | "rollback_or_hold";
  rollbackSuggested: boolean;
  reasons: string[];
  thresholds: Text2SqlV2EvalRolloutThresholds;
}

export interface Text2SqlV2EvalSummary {
  totalCases: number;
  retrievalRelevance: number;
  rerankLift: number;
  planCoverageRate: number;
  validationPassRate: number;
  correctionSuccessRate: number;
  clarificationRate: number;
  executionSuccessRate: number;
  userVisibleFailureQuality: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  denseUnavailableRate: number;
  rerankUnavailableRate: number;
  rollout: Text2SqlV2EvalRolloutRecommendation;
}

const DEFAULT_ROLLOUT_THRESHOLDS: Text2SqlV2EvalRolloutThresholds = {
  minSamples: 8,
  minRetrievalRelevance: 0.75,
  minRerankLift: 0.08,
  minPlanCoverageRate: 0.75,
  minValidationPassRate: 0.7,
  minCorrectionSuccessRate: 0.5,
  minExecutionSuccessRate: 0.7,
  minUserVisibleFailureQuality: 0.7,
  maxClarificationRate: 0.35,
  maxDenseUnavailableRate: 0.35,
  maxRerankUnavailableRate: 0.3,
  maxLatencyP95Ms: 2600
};

// Small tolerance avoids false holds from fixture rounding/noise near thresholds.
const GATE_COMPARISON_TOLERANCE = 0.001;

@Injectable()
export class Text2SqlV2EvaluationService {
  summarize(
    cases: Text2SqlV2EvalCase[],
    thresholds: Text2SqlV2EvalRolloutThresholds = DEFAULT_ROLLOUT_THRESHOLDS
  ): Text2SqlV2EvalSummary {
    const totalCases = cases.length;
    if (totalCases === 0) {
      const rollout = this.evaluateRollout(
        {
          totalCases: 0,
          retrievalRelevance: 0,
          rerankLift: 0,
          planCoverageRate: 0,
          validationPassRate: 0,
          correctionSuccessRate: 0,
          clarificationRate: 0,
          executionSuccessRate: 0,
          userVisibleFailureQuality: 0,
          latencyP50Ms: 0,
          latencyP95Ms: 0,
          denseUnavailableRate: 0,
          rerankUnavailableRate: 0
        },
        thresholds
      );
      return {
        totalCases: 0,
        retrievalRelevance: 0,
        rerankLift: 0,
        planCoverageRate: 0,
        validationPassRate: 0,
        correctionSuccessRate: 0,
        clarificationRate: 0,
        executionSuccessRate: 0,
        userVisibleFailureQuality: 0,
        latencyP50Ms: 0,
        latencyP95Ms: 0,
        denseUnavailableRate: 0,
        rerankUnavailableRate: 0,
        rollout
      };
    }

    const retrievalRelevance =
      cases.reduce((sum, item) => sum + this.clamp(item.retrievalRelevance), 0) /
      totalCases;
    const rerankLift =
      cases.reduce((sum, item) => sum + this.clamp(item.rerankLift), 0) / totalCases;
    const planCoverageRate =
      cases.filter((item) => item.planCoveragePassed).length / totalCases;
    const validationPassRate =
      cases.filter((item) => item.validationPassed).length / totalCases;
    const executionSuccessRate =
      cases.filter((item) => item.executionSucceeded).length / totalCases;

    const correctionCases = cases.filter((item) => item.correctionAttempted);
    const correctionSuccessRate =
      correctionCases.length === 0
        ? 1
        : correctionCases.filter((item) => item.correctionSucceeded).length /
          correctionCases.length;

    const clarificationRate =
      cases.filter((item) => item.clarified).length / totalCases;

    const userVisibleFailureQuality =
      cases.reduce(
        (sum, item) => sum + this.clamp(item.userVisibleFailureQuality),
        0
      ) / totalCases;

    const latencies = cases
      .map((item) => item.latencyMs)
      .filter((value) => Number.isFinite(value) && value >= 0)
      .sort((a, b) => a - b);

    const denseUnavailableRate =
      cases.filter((item) => item.denseUnavailable).length / totalCases;
    const rerankUnavailableRate =
      cases.filter((item) => item.rerankUnavailable).length / totalCases;

    const summaryWithoutRollout = {
      totalCases,
      retrievalRelevance: Number(retrievalRelevance.toFixed(4)),
      rerankLift: Number(rerankLift.toFixed(4)),
      planCoverageRate: Number(planCoverageRate.toFixed(4)),
      validationPassRate: Number(validationPassRate.toFixed(4)),
      correctionSuccessRate: Number(correctionSuccessRate.toFixed(4)),
      clarificationRate: Number(clarificationRate.toFixed(4)),
      executionSuccessRate: Number(executionSuccessRate.toFixed(4)),
      userVisibleFailureQuality: Number(userVisibleFailureQuality.toFixed(4)),
      latencyP50Ms: this.percentile(latencies, 0.5),
      latencyP95Ms: this.percentile(latencies, 0.95),
      denseUnavailableRate: Number(denseUnavailableRate.toFixed(4)),
      rerankUnavailableRate: Number(rerankUnavailableRate.toFixed(4))
    };

    return {
      ...summaryWithoutRollout,
      rollout: this.evaluateRollout(summaryWithoutRollout, thresholds)
    };
  }

  private evaluateRollout(
    summary: Omit<Text2SqlV2EvalSummary, "rollout">,
    thresholds: Text2SqlV2EvalRolloutThresholds
  ): Text2SqlV2EvalRolloutRecommendation {
    const reasons: string[] = [];
    if (summary.totalCases < thresholds.minSamples) {
      reasons.push("sample_not_ready");
    }
    if (
      summary.retrievalRelevance + GATE_COMPARISON_TOLERANCE <
      thresholds.minRetrievalRelevance
    ) {
      reasons.push("retrieval_relevance_below_threshold");
    }
    if (summary.rerankLift + GATE_COMPARISON_TOLERANCE < thresholds.minRerankLift) {
      reasons.push("rerank_lift_below_threshold");
    }
    if (
      summary.planCoverageRate + GATE_COMPARISON_TOLERANCE <
      thresholds.minPlanCoverageRate
    ) {
      reasons.push("plan_coverage_rate_below_threshold");
    }
    if (
      summary.validationPassRate + GATE_COMPARISON_TOLERANCE <
      thresholds.minValidationPassRate
    ) {
      reasons.push("validation_pass_rate_below_threshold");
    }
    if (
      summary.correctionSuccessRate + GATE_COMPARISON_TOLERANCE <
      thresholds.minCorrectionSuccessRate
    ) {
      reasons.push("correction_success_rate_below_threshold");
    }
    if (
      summary.executionSuccessRate + GATE_COMPARISON_TOLERANCE <
      thresholds.minExecutionSuccessRate
    ) {
      reasons.push("execution_success_rate_below_threshold");
    }
    if (
      summary.userVisibleFailureQuality + GATE_COMPARISON_TOLERANCE <
      thresholds.minUserVisibleFailureQuality
    ) {
      reasons.push("user_visible_failure_quality_below_threshold");
    }
    if (
      summary.clarificationRate >
      thresholds.maxClarificationRate + GATE_COMPARISON_TOLERANCE
    ) {
      reasons.push("clarification_rate_exceeded");
    }
    if (
      summary.denseUnavailableRate >
      thresholds.maxDenseUnavailableRate + GATE_COMPARISON_TOLERANCE
    ) {
      reasons.push("dense_unavailable_rate_exceeded");
    }
    if (
      summary.rerankUnavailableRate >
      thresholds.maxRerankUnavailableRate + GATE_COMPARISON_TOLERANCE
    ) {
      reasons.push("rerank_unavailable_rate_exceeded");
    }
    if (summary.latencyP95Ms > thresholds.maxLatencyP95Ms + GATE_COMPARISON_TOLERANCE) {
      reasons.push("latency_p95_exceeded");
    }

    const rollbackSuggested = reasons.some((item) =>
      [
        "execution_success_rate_below_threshold",
        "validation_pass_rate_below_threshold",
        "user_visible_failure_quality_below_threshold"
      ].includes(item)
    );
    const gatePass = reasons.length === 0;

    return {
      gatePass,
      recommendedStage: gatePass
        ? "direct_v2_go"
        : rollbackSuggested
          ? "rollback_or_hold"
          : "hold",
      rollbackSuggested,
      reasons,
      thresholds
    };
  }

  private percentile(values: number[], p: number): number {
    if (values.length === 0) {
      return 0;
    }
    const index = Math.min(
      values.length - 1,
      Math.max(0, Math.ceil(values.length * p) - 1)
    );
    return Math.round(values[index] ?? 0);
  }

  private clamp(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.max(0, Math.min(1, value));
  }
}
