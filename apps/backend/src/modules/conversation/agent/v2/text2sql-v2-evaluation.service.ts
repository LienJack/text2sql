import { Injectable } from "@nestjs/common";

export interface Text2SqlV2EvalCase {
  id: string;
  question: string;
  retrievalRelevance: number;
  planCoveragePassed: boolean;
  validationPassed: boolean;
  correctionAttempted: boolean;
  correctionSucceeded: boolean;
  clarified: boolean;
  latencyMs: number;
  denseUnavailable: boolean;
  rerankUnavailable: boolean;
}

export interface Text2SqlV2EvalSummary {
  totalCases: number;
  retrievalRelevance: number;
  planCoverageRate: number;
  validationPassRate: number;
  correctionSuccessRate: number;
  clarificationRate: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  denseUnavailableRate: number;
  rerankUnavailableRate: number;
}

@Injectable()
export class Text2SqlV2EvaluationService {
  summarize(cases: Text2SqlV2EvalCase[]): Text2SqlV2EvalSummary {
    const totalCases = cases.length;
    if (totalCases === 0) {
      return {
        totalCases: 0,
        retrievalRelevance: 0,
        planCoverageRate: 0,
        validationPassRate: 0,
        correctionSuccessRate: 0,
        clarificationRate: 0,
        latencyP50Ms: 0,
        latencyP95Ms: 0,
        denseUnavailableRate: 0,
        rerankUnavailableRate: 0
      };
    }

    const retrievalRelevance =
      cases.reduce((sum, item) => sum + this.clamp(item.retrievalRelevance), 0) /
      totalCases;
    const planCoverageRate =
      cases.filter((item) => item.planCoveragePassed).length / totalCases;
    const validationPassRate =
      cases.filter((item) => item.validationPassed).length / totalCases;

    const correctionCases = cases.filter((item) => item.correctionAttempted);
    const correctionSuccessRate =
      correctionCases.length === 0
        ? 0
        : correctionCases.filter((item) => item.correctionSucceeded).length /
          correctionCases.length;

    const clarificationRate =
      cases.filter((item) => item.clarified).length / totalCases;

    const latencies = cases
      .map((item) => item.latencyMs)
      .filter((value) => Number.isFinite(value) && value >= 0)
      .sort((a, b) => a - b);

    const denseUnavailableRate =
      cases.filter((item) => item.denseUnavailable).length / totalCases;
    const rerankUnavailableRate =
      cases.filter((item) => item.rerankUnavailable).length / totalCases;

    return {
      totalCases,
      retrievalRelevance: Number(retrievalRelevance.toFixed(4)),
      planCoverageRate: Number(planCoverageRate.toFixed(4)),
      validationPassRate: Number(validationPassRate.toFixed(4)),
      correctionSuccessRate: Number(correctionSuccessRate.toFixed(4)),
      clarificationRate: Number(clarificationRate.toFixed(4)),
      latencyP50Ms: this.percentile(latencies, 0.5),
      latencyP95Ms: this.percentile(latencies, 0.95),
      denseUnavailableRate: Number(denseUnavailableRate.toFixed(4)),
      rerankUnavailableRate: Number(rerankUnavailableRate.toFixed(4))
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
