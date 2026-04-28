import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  Text2SqlV2EvaluationService,
  type Text2SqlV2EvalCase
} from "../../src/modules/conversation/runtime/evaluation/text2sql-v2-evaluation.service";

interface CharacterizationSurface {
  version: string;
  stageOrder: string[];
  stageArtifactCount: number;
  hasSemanticPlan: boolean;
}

interface CharacterizationCase {
  id: string;
  expectedStageOrder: string[];
  surfaces: Record<string, CharacterizationSurface>;
}

function summarizeCharacterization(cases: CharacterizationCase[]): {
  gatePass: boolean;
  reasons: string[];
} {
  const surfaceNames = ["sync", "stream", "replay", "runView", "saveView"];
  if (cases.length === 0) {
    return {
      gatePass: false,
      reasons: ["characterization_fixture_empty"]
    };
  }

  const failedIds: string[] = [];
  for (const item of cases) {
    const surfaceRecords = surfaceNames.map((name) => item.surfaces[name]);
    const hasMissingSurface = surfaceRecords.some((surface) => !surface);
    if (hasMissingSurface || item.expectedStageOrder.length === 0) {
      failedIds.push(item.id);
      continue;
    }

    const stageOrderMatch = surfaceRecords.every(
      (surface) =>
        JSON.stringify(surface.stageOrder) === JSON.stringify(item.expectedStageOrder)
    );
    const versionMatch = surfaceRecords.every((surface) => surface.version === "v2");
    const artifactCountMatch = surfaceRecords.every(
      (surface) => surface.stageArtifactCount >= item.expectedStageOrder.length
    );
    const semanticPlanParity =
      new Set(surfaceRecords.map((surface) => surface.hasSemanticPlan)).size === 1;

    if (!stageOrderMatch || !versionMatch || !artifactCountMatch || !semanticPlanParity) {
      failedIds.push(item.id);
    }
  }

  return {
    gatePass: failedIds.length === 0,
    reasons:
      failedIds.length > 0
        ? [`characterization_parity_failed:${failedIds.join(",")}`]
        : []
  };
}

describe("text2sql unified rag eval gate integration", () => {
  it("keeps eval + characterization rollout gate pass for current fixtures", () => {
    const evalFixturePath = resolve(
      __dirname,
      "../fixtures/text2sql-v2-eval-cases.json"
    );
    const characterizationFixturePath = resolve(
      __dirname,
      "../fixtures/text2sql-v2-characterization-cases.json"
    );
    const evalCases = JSON.parse(
      readFileSync(evalFixturePath, "utf-8")
    ) as Text2SqlV2EvalCase[];
    const characterizationCases = JSON.parse(
      readFileSync(characterizationFixturePath, "utf-8")
    ) as CharacterizationCase[];

    const evalService = new Text2SqlV2EvaluationService();
    const summary = evalService.summarize(evalCases);
    const characterization = summarizeCharacterization(characterizationCases);

    expect(summary.rollout.gatePass).toBe(true);
    expect(summary.rollout.recommendedStage).toBe("direct_v2_go");
    expect(summary.rollout.rollbackSuggested).toBe(false);
    expect(summary.rollout.reasons).toEqual([]);
    // Guard threshold edge-case: retrievalRelevance should stay around the 0.75 gate after runtime intelligence fixtures.
    expect(summary.retrievalRelevance).toBeCloseTo(0.7638, 4);
    expect(summary.rollout.thresholds.minRetrievalRelevance).toBe(0.75);

    expect(characterization.gatePass).toBe(true);
    expect(characterization.reasons).toEqual([]);

    const rollout = {
      gatePass: summary.rollout.gatePass && characterization.gatePass,
      recommendedStage:
        summary.rollout.gatePass && characterization.gatePass
          ? "direct_v2_go"
          : summary.rollout.rollbackSuggested
            ? "rollback_or_hold"
            : "hold",
      rollbackSuggested: summary.rollout.rollbackSuggested,
      reasons: [
        ...summary.rollout.reasons.map((item) => `eval:${item}`),
        ...characterization.reasons.map((item) => `characterization:${item}`)
      ]
    };
    expect(rollout.gatePass).toBe(true);
    expect(rollout.recommendedStage).toBe("direct_v2_go");
    expect(rollout.rollbackSuggested).toBe(false);
    expect(rollout.reasons).toEqual([]);
  });
});
