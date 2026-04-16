import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { GraphBuilderService } from "../../src/modules/agent/graph/graph.builder";
import { createSeededSqliteFixture } from "../support/sqlite-fixture";
import type { RunStatus } from "@text2sql/shared-types";

interface StageCase {
  id: string;
  question: string;
  expectedStatus?: RunStatus;
}

interface GateThresholds {
  minPassRate: number;
  maxHardFailureRate: number;
  maxPolicyRejectionRate: number;
  minSamples: number;
}

interface GateReport {
  totals: {
    sampleSize: number;
    passRate: number;
    hardFailureRate: number;
    policyRejectionRate: number;
    clarificationRate: number;
  };
  thresholds: GateThresholds;
  sampleReady: boolean;
  gatePass: boolean;
  generatedAt: string;
}

describe("stage1 acceptance", () => {
  let cleanupFixture: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const fixture = await createSeededSqliteFixture("stage1-acceptance");
    cleanupFixture = fixture.cleanup;
    process.env.SQLITE_PATH = fixture.dbPath;
    process.env.LLM_MOCK_MODE = "true";
    process.env.LLM_PROVIDER = "volcengine";
  });

  afterAll(async () => {
    if (cleanupFixture) {
      await cleanupFixture();
    }
  });

  it("should pass all 12 stage1 cases", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const graph = moduleRef.get(GraphBuilderService);

    const filePath = await resolveStageCasePath();
    const raw = await readFile(filePath, "utf8");
    const parsed = yaml.load(raw) as { cases: StageCase[] };

    const thresholds = readGateThresholds();
    let passed = 0;
    let rejectedCount = 0;
    let failedCount = 0;
    let clarificationCount = 0;
    const mismatches: string[] = [];

    for (const item of parsed.cases) {
      const run = await graph.run({
        runId: `stage1-${item.id}`,
        sessionId: "stage1",
        question: item.question,
        datasourceId: "sqlite_main",
        datasourceType: "sqlite"
      });
      if (
        run.status === "executionResult" ||
        run.status === "clarification" ||
        run.status === "rejected"
      ) {
        passed += 1;
      }
      if (run.status === "rejected") {
        rejectedCount += 1;
      }
      if (run.status === "failed") {
        failedCount += 1;
      }
      if (run.status === "clarification") {
        clarificationCount += 1;
      }
      if (item.expectedStatus && run.status !== item.expectedStatus) {
        mismatches.push(
          `${item.id}: expected ${item.expectedStatus}, got ${run.status}`
        );
      }
    }

    const report = buildGateReport({
      sampleSize: parsed.cases.length,
      passed,
      clarificationCount,
      rejectedCount,
      failedCount,
      thresholds
    });
    await maybeWriteGateReport(report);

    expect(parsed.cases.length).toBe(12);
    expect(mismatches).toEqual([]);
    expect(passed).toBe(12);
    expect(clarificationCount).toBeGreaterThanOrEqual(2);
    expect(report.sampleReady).toBe(true);
    expect(report.gatePass).toBe(true);
  });
});

async function resolveStageCasePath(): Promise<string> {
  const candidates = [
    resolve(__dirname, "stage1-12-cases.yaml"),
    resolve(process.cwd(), "test/e2e/stage1-12-cases.yaml"),
    resolve(process.cwd(), "vibe/plain/eval/stage1-12-cases.yaml"),
    resolve(process.cwd(), "../../vibe/plain/eval/stage1-12-cases.yaml")
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // continue
    }
  }
  throw new Error("未找到 stage1-12-cases.yaml");
}

function readGateThresholds(): GateThresholds {
  return {
    minPassRate: Number(process.env.R1_GATE_MIN_PASS_RATE ?? "1"),
    maxHardFailureRate: Number(process.env.R1_GATE_MAX_HARD_FAILURE_RATE ?? "0"),
    maxPolicyRejectionRate: Number(process.env.R1_GATE_MAX_POLICY_REJECTION_RATE ?? "0.2"),
    minSamples: Number(process.env.R1_GATE_MIN_SAMPLES ?? "10")
  };
}

function buildGateReport(input: {
  sampleSize: number;
  passed: number;
  clarificationCount: number;
  rejectedCount: number;
  failedCount: number;
  thresholds: GateThresholds;
}): GateReport {
  const passRate = input.sampleSize === 0 ? 0 : input.passed / input.sampleSize;
  const hardFailureRate =
    input.sampleSize === 0 ? 0 : input.failedCount / input.sampleSize;
  const policyRejectionRate =
    input.sampleSize === 0 ? 0 : input.rejectedCount / input.sampleSize;
  const clarificationRate =
    input.sampleSize === 0 ? 0 : input.clarificationCount / input.sampleSize;
  const sampleReady = input.sampleSize >= input.thresholds.minSamples;
  const gatePass =
    sampleReady &&
    passRate >= input.thresholds.minPassRate &&
    hardFailureRate <= input.thresholds.maxHardFailureRate &&
    policyRejectionRate <= input.thresholds.maxPolicyRejectionRate;

  return {
    totals: {
      sampleSize: input.sampleSize,
      passRate,
      hardFailureRate,
      policyRejectionRate,
      clarificationRate
    },
    thresholds: input.thresholds,
    sampleReady,
    gatePass,
    generatedAt: new Date().toISOString()
  };
}

async function maybeWriteGateReport(report: GateReport): Promise<void> {
  const outputPath = process.env.STAGE1_GATE_REPORT_PATH;
  if (!outputPath) {
    return;
  }
  await writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");
}
