import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  Text2SqlV2EvaluationService,
  type Text2SqlV2EvalCase
} from "../../src/modules/conversation/agent/v2/text2sql-v2-evaluation.service";
import {
  buildCloseoutRollout,
  summarizeCharacterization
} from "../../scripts/collect-text2sql-v2-eval-gate";

describe("text2sql v2 eval gate integration", () => {
  it("aggregates fixture metrics, traceability, and closeout gates", () => {
    const fixturePath = resolve(
      __dirname,
      "../fixtures/text2sql-v2-eval-cases.json"
    );
    const characterizationFixturePath = resolve(
      __dirname,
      "../fixtures/text2sql-v2-characterization-cases.json"
    );
    const fixture = JSON.parse(readFileSync(fixturePath, "utf-8")) as Text2SqlV2EvalCase[];
    const characterizationFixture = JSON.parse(
      readFileSync(characterizationFixturePath, "utf-8")
    ) as Array<{
      id: string;
      scenario: string;
      expectedStageOrder: string[];
      surfaces: Record<
        string,
        {
          version: string;
          stageOrder: string[];
          stageArtifactCount: number;
          hasSemanticPlan: boolean;
        }
      >;
    }>;

    const service = new Text2SqlV2EvaluationService();
    const summary = service.summarize(fixture);
    const characterization = summarizeCharacterization(characterizationFixture);
    const closeout = buildCloseoutRollout({
      summary,
      characterization,
      noLegacy: {
        gatePass: true,
        reasons: [],
        scannedCount: 14
      },
      focusedCoverage: {
        gatePass: true,
        reasons: [],
        coveragePath: "/tmp/coverage-final.json",
        matrixPath: "/tmp/text2sql-v2-closeout-flow-matrix.json"
      }
    });

    expect(summary.totalCases).toBeGreaterThan(0);
    expect(summary.rollout.gatePass).toBe(true);
    expect(summary.traceability.gatePass).toBe(true);
    expect(summary.traceability.missingFamilies).toEqual([]);
    expect(characterization.gatePass).toBe(true);
    expect(closeout.gatePass).toBe(true);
    expect(closeout.recommendedStage).toBe("direct_v2_go");
    expect(closeout.closeoutGates.evalTraceability.gatePass).toBe(true);
  });

  it("blocks closeout when eval traceability is incomplete even if eval metrics pass", () => {
    const fixturePath = resolve(
      __dirname,
      "../fixtures/text2sql-v2-eval-cases.json"
    );
    const fixture = JSON.parse(readFileSync(fixturePath, "utf-8")) as Text2SqlV2EvalCase[];
    const service = new Text2SqlV2EvaluationService();
    const summary = service.summarize(
      fixture.map((item) => {
        if (item.id !== "zh-dense-unavailable-008") {
          return item;
        }
        return {
          ...item,
          traceability: {
            ...item.traceability!,
            behaviorTests: []
          }
        };
      })
    );

    const closeout = buildCloseoutRollout({
      summary,
      characterization: {
        totalCases: 1,
        parityPassCount: 1,
        parityCoverageRate: 1,
        gatePass: true,
        reasons: []
      },
      noLegacy: {
        gatePass: true,
        reasons: [],
        scannedCount: 14
      },
      focusedCoverage: {
        gatePass: true,
        reasons: [],
        coveragePath: "/tmp/coverage-final.json",
        matrixPath: "/tmp/text2sql-v2-closeout-flow-matrix.json"
      }
    });

    expect(summary.rollout.gatePass).toBe(true);
    expect(summary.traceability.gatePass).toBe(false);
    expect(closeout.gatePass).toBe(false);
    expect(closeout.recommendedStage).toBe("hold");
    expect(closeout.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "traceability:family:dense-unavailable:missing_behavior_test_traceability"
        )
      ])
    );
  });

  it("keeps closeout blocked when no-legacy or focused coverage gates fail", () => {
    const fixturePath = resolve(
      __dirname,
      "../fixtures/text2sql-v2-eval-cases.json"
    );
    const fixture = JSON.parse(readFileSync(fixturePath, "utf-8")) as Text2SqlV2EvalCase[];
    const service = new Text2SqlV2EvaluationService();
    const summary = service.summarize(fixture);

    const closeout = buildCloseoutRollout({
      summary,
      characterization: {
        totalCases: 1,
        parityPassCount: 1,
        parityCoverageRate: 1,
        gatePass: true,
        reasons: []
      },
      noLegacy: {
        gatePass: false,
        reasons: [
          "apps/backend/src/modules/conversation/runtime/text2sql-v2/langgraph/text2sql-v2-langgraph-runner.service.ts:1:1:langgraph legacy delegation"
        ],
        scannedCount: 14
      },
      focusedCoverage: {
        gatePass: false,
        reasons: ["critical:apps/backend/src/modules/conversation/adapters/text2sql-v2/sql-correction.service.ts:line_coverage_below_75"],
        coveragePath: "/tmp/coverage-final.json",
        matrixPath: "/tmp/text2sql-v2-closeout-flow-matrix.json"
      }
    });

    expect(closeout.gatePass).toBe(false);
    expect(closeout.recommendedStage).toBe("rollback_or_hold");
    expect(closeout.rollbackSuggested).toBe(true);
    expect(closeout.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "no_legacy:apps/backend/src/modules/conversation/runtime/text2sql-v2/langgraph/text2sql-v2-langgraph-runner.service.ts"
        ),
        expect.stringContaining("focused_coverage:critical:apps/backend/src/modules/conversation/adapters/text2sql-v2/sql-correction.service.ts")
      ])
    );
  });
});
