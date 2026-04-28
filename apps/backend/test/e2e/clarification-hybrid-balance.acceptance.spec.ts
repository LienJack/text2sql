import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { collectClarificationBalanceGate } from "../../scripts/collect-clarification-balance-gate";

describe("clarification hybrid balance acceptance", () => {
  let tempDir = "";
  let outputPath = "";
  const envBackup = {
    CLARIFICATION_BALANCE_GATE_MIN_SAMPLES: process.env.CLARIFICATION_BALANCE_GATE_MIN_SAMPLES,
    CLARIFICATION_BALANCE_GATE_MIN_TRIGGER_RATE:
      process.env.CLARIFICATION_BALANCE_GATE_MIN_TRIGGER_RATE,
    CLARIFICATION_BALANCE_GATE_MAX_TRIGGER_RATE:
      process.env.CLARIFICATION_BALANCE_GATE_MAX_TRIGGER_RATE,
    CLARIFICATION_BALANCE_GATE_MAX_FALSE_POSITIVE_RATE:
      process.env.CLARIFICATION_BALANCE_GATE_MAX_FALSE_POSITIVE_RATE,
    CLARIFICATION_BALANCE_GATE_MAX_FALSE_NEGATIVE_RATE:
      process.env.CLARIFICATION_BALANCE_GATE_MAX_FALSE_NEGATIVE_RATE,
    CLARIFICATION_BALANCE_GATE_MIN_POST_CLARIFY_SEMANTIC_PASS_RATE:
      process.env.CLARIFICATION_BALANCE_GATE_MIN_POST_CLARIFY_SEMANTIC_PASS_RATE,
    CLARIFICATION_BALANCE_GATE_MAX_AVG_CLARIFICATION_ROUNDS:
      process.env.CLARIFICATION_BALANCE_GATE_MAX_AVG_CLARIFICATION_ROUNDS
  };

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "clarification-hybrid-balance-"));
    outputPath = join(tempDir, "gate-summary.json");
    process.env.CLARIFICATION_BALANCE_GATE_MIN_SAMPLES = "4";
    process.env.CLARIFICATION_BALANCE_GATE_MIN_TRIGGER_RATE = "0.25";
    process.env.CLARIFICATION_BALANCE_GATE_MAX_TRIGGER_RATE = "0.75";
    process.env.CLARIFICATION_BALANCE_GATE_MAX_FALSE_POSITIVE_RATE = "0";
    process.env.CLARIFICATION_BALANCE_GATE_MAX_FALSE_NEGATIVE_RATE = "0";
    process.env.CLARIFICATION_BALANCE_GATE_MIN_POST_CLARIFY_SEMANTIC_PASS_RATE = "1";
    process.env.CLARIFICATION_BALANCE_GATE_MAX_AVG_CLARIFICATION_ROUNDS = "1";
  });

  afterAll(async () => {
    process.env.CLARIFICATION_BALANCE_GATE_MIN_SAMPLES =
      envBackup.CLARIFICATION_BALANCE_GATE_MIN_SAMPLES;
    process.env.CLARIFICATION_BALANCE_GATE_MIN_TRIGGER_RATE =
      envBackup.CLARIFICATION_BALANCE_GATE_MIN_TRIGGER_RATE;
    process.env.CLARIFICATION_BALANCE_GATE_MAX_TRIGGER_RATE =
      envBackup.CLARIFICATION_BALANCE_GATE_MAX_TRIGGER_RATE;
    process.env.CLARIFICATION_BALANCE_GATE_MAX_FALSE_POSITIVE_RATE =
      envBackup.CLARIFICATION_BALANCE_GATE_MAX_FALSE_POSITIVE_RATE;
    process.env.CLARIFICATION_BALANCE_GATE_MAX_FALSE_NEGATIVE_RATE =
      envBackup.CLARIFICATION_BALANCE_GATE_MAX_FALSE_NEGATIVE_RATE;
    process.env.CLARIFICATION_BALANCE_GATE_MIN_POST_CLARIFY_SEMANTIC_PASS_RATE =
      envBackup.CLARIFICATION_BALANCE_GATE_MIN_POST_CLARIFY_SEMANTIC_PASS_RATE;
    process.env.CLARIFICATION_BALANCE_GATE_MAX_AVG_CLARIFICATION_ROUNDS =
      envBackup.CLARIFICATION_BALANCE_GATE_MAX_AVG_CLARIFICATION_ROUNDS;
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("collects machine-readable metrics for hybrid clarification balance and passes strict mode", async () => {
    const report = await collectClarificationBalanceGate({
      fixturePath: resolve(process.cwd(), "test/fixtures/clarification-balance-cases.json"),
      outputPath,
      strictMode: true
    });

    expect(report.fixture.sampleSize).toBe(4);
    expect(report.sampleReady).toBe(true);
    expect(report.gatePass).toBe(true);
    expect(report.metrics.triggerRate).toBeCloseTo(0.5, 6);
    expect(report.metrics.falsePositiveRate).toBe(0);
    expect(report.metrics.falseNegativeRate).toBe(0);
    expect(report.metrics.postClarifySemanticPassRate).toBe(1);
    expect(report.metrics.averageClarificationRounds).toBe(1);
    expect(report.diagnostics.metadataBypassMismatchCaseIds).toEqual([]);
    expect(report.diagnostics.strictSemanticPathMismatchCaseIds).toEqual([]);
    expect(report.diagnostics.caseErrors).toEqual([]);
    expect(report.diagnostics.falseNegativeCaseIds).toEqual([]);
    expect(report.diagnostics.falsePositiveCaseIds).toEqual([]);

    const persisted = JSON.parse(await readFile(outputPath, "utf8")) as {
      gatePass: boolean;
      metrics: {
        triggerRate: number;
      };
    };
    expect(persisted.gatePass).toBe(true);
    expect(persisted.metrics.triggerRate).toBeCloseTo(0.5, 6);
  });
});
