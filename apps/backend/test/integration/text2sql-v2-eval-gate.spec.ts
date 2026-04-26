import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  Text2SqlV2EvaluationService,
  type Text2SqlV2EvalCase
} from "../../src/modules/conversation/agent/v2/text2sql-v2-evaluation.service";

describe("text2sql v2 eval gate integration", () => {
  it("aggregates fixture metrics and direct-v2 rollout recommendation", () => {
    const fixturePath = resolve(
      __dirname,
      "../fixtures/text2sql-v2-eval-cases.json"
    );
    const fixture = JSON.parse(readFileSync(fixturePath, "utf-8")) as Text2SqlV2EvalCase[];

    const service = new Text2SqlV2EvaluationService();
    const summary = service.summarize(fixture);

    expect(summary.totalCases).toBeGreaterThan(0);
    expect(summary.retrievalRelevance).toBeGreaterThanOrEqual(0);
    expect(summary.retrievalRelevance).toBeLessThanOrEqual(1);
    expect(summary.rerankLift).toBeGreaterThanOrEqual(0);
    expect(summary.rerankLift).toBeLessThanOrEqual(1);
    expect(summary.planCoverageRate).toBeGreaterThanOrEqual(0);
    expect(summary.validationPassRate).toBeGreaterThanOrEqual(0);
    expect(summary.correctionSuccessRate).toBeGreaterThanOrEqual(0);
    expect(summary.clarificationRate).toBeGreaterThanOrEqual(0);
    expect(summary.executionSuccessRate).toBeGreaterThanOrEqual(0);
    expect(summary.userVisibleFailureQuality).toBeGreaterThanOrEqual(0);
    expect(summary.latencyP50Ms).toBeGreaterThan(0);
    expect(summary.latencyP95Ms).toBeGreaterThanOrEqual(summary.latencyP50Ms);
    expect(summary.denseUnavailableRate).toBeGreaterThanOrEqual(0);
    expect(summary.rerankUnavailableRate).toBeGreaterThanOrEqual(0);
    expect(summary.rollout.thresholds.minSamples).toBeGreaterThan(0);
    expect(
      ["direct_v2_go", "hold", "rollback_or_hold"].includes(
        summary.rollout.recommendedStage
      )
    ).toBe(true);
    expect(Array.isArray(summary.rollout.reasons)).toBe(true);
  });
});
