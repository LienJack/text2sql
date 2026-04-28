import { Injectable } from "@nestjs/common";

export const TEXT2SQL_V2_REQUIRED_FIXTURE_FAMILIES = [
  "chinese-question",
  "alias",
  "ambiguous-business-term",
  "multi-table-join",
  "metrics",
  "filters",
  "follow-up",
  "metadata-general",
  "unsafe-write",
  "dense-unavailable",
  "rerank-unavailable",
  "correction-success",
  "terminal-governance-failure",
  "plain-general-no-sql",
  "runtime-plan-consistency",
  "artifact-ref-compaction",
  "smart-defaults-evidence",
  "large-context-compaction",
  "validation-diagnostics",
  "correction-grounding",
  "execution-preview",
  "all-stage-stream-lifecycle"
] as const;

export type Text2SqlV2RequiredFixtureFamily =
  (typeof TEXT2SQL_V2_REQUIRED_FIXTURE_FAMILIES)[number];

export interface Text2SqlV2EvalCaseTraceability {
  fixtureFamilies: string[];
  behaviorTests: string[];
  flowNodes: string[];
}

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
  traceability?: Text2SqlV2EvalCaseTraceability;
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

export interface Text2SqlV2EvalTraceabilityFamilySummary {
  family: string;
  caseIds: string[];
  behaviorTests: string[];
  flowNodes: string[];
  gatePass: boolean;
  reasons: string[];
}

export interface Text2SqlV2EvalTraceabilitySummary {
  requiredFamilies: string[];
  coveredFamilies: string[];
  missingFamilies: string[];
  familyCoverage: Text2SqlV2EvalTraceabilityFamilySummary[];
  gatePass: boolean;
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
  traceability: Text2SqlV2EvalTraceabilitySummary;
  rollout: Text2SqlV2EvalRolloutRecommendation;
}

type Text2SqlV2EvalMetricSummary = Omit<Text2SqlV2EvalSummary, "traceability" | "rollout">;

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
    const traceability = this.summarizeTraceability(cases);
    if (totalCases === 0) {
      const metricSummary: Text2SqlV2EvalMetricSummary = {
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
      };
      const rollout = this.evaluateRollout(metricSummary, thresholds);
      return {
        ...metricSummary,
        traceability,
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

    const metricSummary: Text2SqlV2EvalMetricSummary = {
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
      ...metricSummary,
      traceability,
      rollout: this.evaluateRollout(metricSummary, thresholds)
    };
  }

  private summarizeTraceability(
    cases: Text2SqlV2EvalCase[]
  ): Text2SqlV2EvalTraceabilitySummary {
    const familyIndex = new Map<
      string,
      {
        caseIds: Set<string>;
        behaviorTests: Set<string>;
        flowNodes: Set<string>;
      }
    >();

    for (const item of cases) {
      const traceability = item.traceability;
      if (!traceability) {
        continue;
      }
      const families = this.normalizeStringArray(traceability.fixtureFamilies);
      const behaviorTests = this.normalizeStringArray(traceability.behaviorTests);
      const flowNodes = this.normalizeStringArray(traceability.flowNodes);
      for (const family of families) {
        const current = familyIndex.get(family) ?? {
          caseIds: new Set<string>(),
          behaviorTests: new Set<string>(),
          flowNodes: new Set<string>()
        };
        current.caseIds.add(item.id);
        for (const behaviorTest of behaviorTests) {
          current.behaviorTests.add(behaviorTest);
        }
        for (const flowNode of flowNodes) {
          current.flowNodes.add(flowNode);
        }
        familyIndex.set(family, current);
      }
    }

    const familyCoverage = TEXT2SQL_V2_REQUIRED_FIXTURE_FAMILIES.map((family) => {
      const coverage = familyIndex.get(family);
      const reasons: string[] = [];
      if (!coverage || coverage.caseIds.size === 0) {
        reasons.push("missing_eval_cases");
      }
      if (!coverage || coverage.behaviorTests.size === 0) {
        reasons.push("missing_behavior_test_traceability");
      }
      if (!coverage || coverage.flowNodes.size === 0) {
        reasons.push("missing_flow_node_traceability");
      }
      return {
        family,
        caseIds: [...(coverage?.caseIds ?? [])].sort(),
        behaviorTests: [...(coverage?.behaviorTests ?? [])].sort(),
        flowNodes: [...(coverage?.flowNodes ?? [])].sort(),
        gatePass: reasons.length === 0,
        reasons
      };
    });

    const missingFamilies = familyCoverage
      .filter((item) => item.reasons.length > 0)
      .map((item) => item.family);
    const coveredFamilies = familyCoverage
      .filter((item) => item.reasons.length === 0)
      .map((item) => item.family);

    return {
      requiredFamilies: [...TEXT2SQL_V2_REQUIRED_FIXTURE_FAMILIES],
      coveredFamilies,
      missingFamilies,
      familyCoverage,
      gatePass: missingFamilies.length === 0
    };
  }

  private evaluateRollout(
    summary: Text2SqlV2EvalMetricSummary,
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

  private normalizeStringArray(values: string[] | undefined): string[] {
    if (!Array.isArray(values)) {
      return [];
    }
    const normalized = values
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0);
    return [...new Set(normalized)].sort();
  }
}
