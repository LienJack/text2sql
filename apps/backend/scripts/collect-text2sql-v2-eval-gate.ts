import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  Text2SqlV2EvaluationService,
  type Text2SqlV2EvalCase
} from "../src/modules/conversation/agent/v2/text2sql-v2-evaluation.service";

interface CharacterizationSurface {
  version: string;
  stageOrder: string[];
  stageArtifactCount: number;
  hasSemanticPlan: boolean;
}

interface CharacterizationCase {
  id: string;
  scenario: string;
  expectedStageOrder: string[];
  surfaces: Record<string, CharacterizationSurface>;
}

interface CharacterizationSummary {
  totalCases: number;
  parityPassCount: number;
  parityCoverageRate: number;
  gatePass: boolean;
  reasons: string[];
}

function summarizeCharacterization(cases: CharacterizationCase[]): CharacterizationSummary {
  const surfaceNames = ["sync", "stream", "replay", "runView", "saveView"];
  if (cases.length === 0) {
    return {
      totalCases: 0,
      parityPassCount: 0,
      parityCoverageRate: 0,
      gatePass: false,
      reasons: ["characterization_fixture_empty"]
    };
  }

  let parityPassCount = 0;
  const failedIds: string[] = [];

  for (const item of cases) {
    const surfaceRecords = surfaceNames.map((name) => item.surfaces[name]);
    const hasMissingSurface = surfaceRecords.some((surface) => !surface);
    if (hasMissingSurface || item.expectedStageOrder.length === 0) {
      failedIds.push(item.id);
      continue;
    }

    const stageOrderMatch = surfaceRecords.every((surface) =>
      JSON.stringify(surface.stageOrder) === JSON.stringify(item.expectedStageOrder)
    );
    const versionMatch = surfaceRecords.every((surface) => surface.version === "v2");
    const artifactCountMatch = surfaceRecords.every(
      (surface) => surface.stageArtifactCount >= item.expectedStageOrder.length
    );
    const semanticPlanParity =
      new Set(surfaceRecords.map((surface) => surface.hasSemanticPlan)).size === 1;

    if (stageOrderMatch && versionMatch && artifactCountMatch && semanticPlanParity) {
      parityPassCount += 1;
    } else {
      failedIds.push(item.id);
    }
  }

  const parityCoverageRate = Number((parityPassCount / cases.length).toFixed(4));
  const reasons =
    failedIds.length > 0
      ? [`characterization_parity_failed:${failedIds.join(",")}`]
      : [];

  return {
    totalCases: cases.length,
    parityPassCount,
    parityCoverageRate,
    gatePass: failedIds.length === 0,
    reasons
  };
}

function main(): void {
  const fixturePath = resolve(
    __dirname,
    "../test/fixtures/text2sql-v2-eval-cases.json"
  );
  const characterizationFixturePath = resolve(
    __dirname,
    "../test/fixtures/text2sql-v2-characterization-cases.json"
  );
  const raw = readFileSync(fixturePath, "utf-8");
  const cases = JSON.parse(raw) as Text2SqlV2EvalCase[];
  const characterizationRaw = readFileSync(characterizationFixturePath, "utf-8");
  const characterizationCases = JSON.parse(
    characterizationRaw
  ) as CharacterizationCase[];

  const service = new Text2SqlV2EvaluationService();
  const summary = service.summarize(cases);
  const characterization = summarizeCharacterization(characterizationCases);
  const reasons = [
    ...summary.rollout.reasons.map((item) => `eval:${item}`),
    ...characterization.reasons.map((item) => `characterization:${item}`)
  ];
  const rollbackSuggested = summary.rollout.rollbackSuggested;
  const gatePass = summary.rollout.gatePass && characterization.gatePass;
  const recommendedStage = gatePass
    ? "direct_v2_go"
    : rollbackSuggested
      ? "rollback_or_hold"
      : "hold";

  process.stdout.write(
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        fixturePath,
        characterizationFixturePath,
        summary,
        characterization,
        rollout: {
          gatePass,
          recommendedStage,
          rollbackSuggested,
          reasons
        }
      },
      null,
      2
    )}\n`
  );
}

main();
