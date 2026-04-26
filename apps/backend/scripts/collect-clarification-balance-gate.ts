import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Test, type TestingModule } from "@nestjs/testing";
import { AppModule } from "../src/app.module";
import { ChatService } from "../src/modules/conversation/chat/chat.service";
import { createSeededSqliteFixture } from "../test/support/sqlite-fixture";

type RunStatus =
  | "clarification"
  | "executionResult"
  | "rejected"
  | "failed";

type ScenarioLabel =
  | "clarify_to_aggregate"
  | "clarify_to_compare"
  | "skip_but_strict"
  | "metadata_bypass";

interface ClarificationBalanceCase {
  id: string;
  scenario: ScenarioLabel;
  initialQuestion: string;
  followUpQuestion?: string;
  expected: {
    shouldClarify: boolean;
    metadataBypass: boolean;
    strictSemanticPath: boolean;
    maxClarificationRounds: number;
  };
}

interface ClarificationBalanceFixture {
  version: string;
  generatedAt: string;
  cases: ClarificationBalanceCase[];
}

interface GateThresholds {
  minSamples: number;
  minTriggerRate: number;
  maxTriggerRate: number;
  maxFalsePositiveRate: number;
  maxFalseNegativeRate: number;
  minPostClarifySemanticPassRate: number;
  maxAverageClarificationRounds: number;
}

interface CaseDiagnostics {
  caseId: string;
  scenario: ScenarioLabel;
  expectedShouldClarify: boolean;
  triggeredClarification: boolean;
  clarificationRounds: number;
  firstRunStatus: RunStatus;
  followUpRunStatus?: RunStatus;
  metadataBypassDetected: boolean;
  strictSemanticPathDetected: boolean;
  postClarifySemanticPass: boolean;
  semanticPlanStatus?: string;
  errors: string[];
}

interface ClarificationBalanceGateReport {
  generatedAt: string;
  strictMode: boolean;
  fixture: {
    path: string;
    version: string;
    generatedAt: string;
    sampleSize: number;
  };
  sampleReady: boolean;
  gatePass: boolean;
  reasons: string[];
  thresholds: GateThresholds;
  metrics: {
    sampleSize: number;
    clarificationTriggered: number;
    triggerRate: number;
    falsePositiveRate: number;
    falseNegativeRate: number;
    postClarifySemanticPassRate: number;
    averageClarificationRounds: number;
  };
  diagnostics: {
    falsePositiveCaseIds: string[];
    falseNegativeCaseIds: string[];
    metadataBypassMismatchCaseIds: string[];
    strictSemanticPathMismatchCaseIds: string[];
    clarificationRoundExceededCaseIds: string[];
    caseErrors: Array<{ caseId: string; message: string }>;
    cases: CaseDiagnostics[];
  };
}

interface CollectOptions {
  fixturePath?: string;
  outputPath?: string;
  strictMode?: boolean;
}

interface ParsedArgs {
  fixturePath: string;
  outputPath: string;
  strictMode: boolean;
}

const DEFAULT_FIXTURE_PATH = resolve(
  process.cwd(),
  "test/fixtures/clarification-balance-cases.json"
);
const DEFAULT_OUTPUT_PATH = resolve(
  process.cwd(),
  "../../data/reports/clarification-hybrid-balance/gate-summary.json"
);

function parseBoolean(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function toNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toRate(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(value.toFixed(6));
}

function readThresholds(): GateThresholds {
  return {
    minSamples: Math.max(
      1,
      Math.floor(toNumber(process.env.CLARIFICATION_BALANCE_GATE_MIN_SAMPLES, 4))
    ),
    minTriggerRate: toNumber(process.env.CLARIFICATION_BALANCE_GATE_MIN_TRIGGER_RATE, 0.2),
    maxTriggerRate: toNumber(process.env.CLARIFICATION_BALANCE_GATE_MAX_TRIGGER_RATE, 0.8),
    maxFalsePositiveRate: toNumber(
      process.env.CLARIFICATION_BALANCE_GATE_MAX_FALSE_POSITIVE_RATE,
      0.2
    ),
    maxFalseNegativeRate: toNumber(
      process.env.CLARIFICATION_BALANCE_GATE_MAX_FALSE_NEGATIVE_RATE,
      0.2
    ),
    minPostClarifySemanticPassRate: toNumber(
      process.env.CLARIFICATION_BALANCE_GATE_MIN_POST_CLARIFY_SEMANTIC_PASS_RATE,
      0.7
    ),
    maxAverageClarificationRounds: toNumber(
      process.env.CLARIFICATION_BALANCE_GATE_MAX_AVG_CLARIFICATION_ROUNDS,
      1.5
    )
  };
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const strictByArg = args.includes("--strict") || args.includes("--fail-on-gate");
  const positional = args.filter(
    (item) => item !== "--strict" && item !== "--fail-on-gate"
  );
  return {
    fixturePath: resolve(positional[0] ?? DEFAULT_FIXTURE_PATH),
    outputPath: resolve(
      positional[1] ??
        process.env.CLARIFICATION_BALANCE_GATE_REPORT_PATH ??
        DEFAULT_OUTPUT_PATH
    ),
    strictMode:
      strictByArg || parseBoolean(process.env.CLARIFICATION_BALANCE_GATE_STRICT)
  };
}

function ensureFixture(input: unknown, fixturePath: string): ClarificationBalanceFixture {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`Invalid fixture format: ${fixturePath}`);
  }
  const payload = input as Record<string, unknown>;
  if (typeof payload.version !== "string" || payload.version.trim().length === 0) {
    throw new Error(`Invalid fixture version in ${fixturePath}`);
  }
  if (
    typeof payload.generatedAt !== "string" ||
    payload.generatedAt.trim().length === 0
  ) {
    throw new Error(`Invalid fixture generatedAt in ${fixturePath}`);
  }
  if (!Array.isArray(payload.cases)) {
    throw new Error(`Invalid fixture cases array in ${fixturePath}`);
  }
  if (payload.cases.length === 0) {
    throw new Error(`Empty fixture cases in ${fixturePath}`);
  }

  const knownScenarios = new Set<ScenarioLabel>([
    "clarify_to_aggregate",
    "clarify_to_compare",
    "skip_but_strict",
    "metadata_bypass"
  ]);
  const cases = payload.cases.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error(`Invalid case at index ${index} in ${fixturePath}`);
    }
    const raw = item as Record<string, unknown>;
    const caseId = typeof raw.id === "string" ? raw.id : `index-${index}`;
    if (!knownScenarios.has(raw.scenario as ScenarioLabel)) {
      throw new Error(
        `Unknown scenario label for case ${caseId}: ${String(raw.scenario)}`
      );
    }
    if (typeof raw.initialQuestion !== "string" || raw.initialQuestion.trim().length === 0) {
      throw new Error(`Case ${caseId} has empty initialQuestion`);
    }
    if (typeof raw.expected !== "object" || raw.expected === null || Array.isArray(raw.expected)) {
      throw new Error(`Case ${caseId} has invalid expected block`);
    }
    const expected = raw.expected as Record<string, unknown>;
    if (typeof expected.shouldClarify !== "boolean") {
      throw new Error(`Case ${caseId} expected.shouldClarify must be boolean`);
    }
    if (typeof expected.metadataBypass !== "boolean") {
      throw new Error(`Case ${caseId} expected.metadataBypass must be boolean`);
    }
    if (typeof expected.strictSemanticPath !== "boolean") {
      throw new Error(`Case ${caseId} expected.strictSemanticPath must be boolean`);
    }
    if (
      typeof expected.maxClarificationRounds !== "number" ||
      !Number.isFinite(expected.maxClarificationRounds)
    ) {
      throw new Error(
        `Case ${caseId} expected.maxClarificationRounds must be a number`
      );
    }
    return {
      id: caseId,
      scenario: raw.scenario as ScenarioLabel,
      initialQuestion: raw.initialQuestion,
      followUpQuestion:
        typeof raw.followUpQuestion === "string" ? raw.followUpQuestion : undefined,
      expected: {
        shouldClarify: expected.shouldClarify,
        metadataBypass: expected.metadataBypass,
        strictSemanticPath: expected.strictSemanticPath,
        maxClarificationRounds: expected.maxClarificationRounds
      }
    } satisfies ClarificationBalanceCase;
  });

  return {
    version: payload.version,
    generatedAt: payload.generatedAt,
    cases
  };
}

function parseOutputSummary(
  value: string | undefined
): Record<string, unknown> | undefined {
  if (!value || value.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function findTraceStep(run: { trace?: { steps?: unknown[] } }, node: string) {
  const steps = run.trace?.steps;
  if (!Array.isArray(steps)) {
    return undefined;
  }
  return steps.find((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return false;
    }
    return (item as Record<string, unknown>).node === node;
  }) as Record<string, unknown> | undefined;
}

function readRunStatus(value: unknown): RunStatus {
  if (
    value === "clarification" ||
    value === "executionResult" ||
    value === "rejected" ||
    value === "failed"
  ) {
    return value;
  }
  return "failed";
}

function detectMetadataBypass(run: {
  status: RunStatus;
  trace?: {
    steps?: unknown[];
    clarificationDecision?: {
      decisionSource?: unknown;
      bypassed?: unknown;
      bypassReasonCode?: unknown;
    };
  };
}): boolean {
  if (run.status === "clarification") {
    return false;
  }
  const decisionSource = run.trace?.clarificationDecision?.decisionSource;
  const bypassed = run.trace?.clarificationDecision?.bypassed;
  const bypassReasonCode = run.trace?.clarificationDecision?.bypassReasonCode;
  if (
    decisionSource === "metadata-intent" ||
    bypassed === true ||
    bypassReasonCode === "bypass_metadata_intent"
  ) {
    return true;
  }
  const generateSqlStep = findTraceStep(run, "generate-sql");
  const outputSummary = parseOutputSummary(
    typeof generateSqlStep?.outputSummary === "string"
      ? generateSqlStep.outputSummary
      : undefined
  );
  return outputSummary?.semanticIntent === "metadata";
}

function detectStrictSemanticPath(run: { trace?: { steps?: unknown[] } }): boolean {
  const semanticStep = findTraceStep(run, "build-semantic-query");
  if (!semanticStep) {
    return false;
  }
  return semanticStep.status !== "skipped";
}

function extractSemanticPlanStatus(run: { trace?: { steps?: unknown[] } }): string | undefined {
  const semanticStep = findTraceStep(run, "build-semantic-query");
  const outputSummary = parseOutputSummary(
    typeof semanticStep?.outputSummary === "string"
      ? semanticStep.outputSummary
      : undefined
  );
  if (typeof outputSummary?.status === "string") {
    return outputSummary.status;
  }
  return undefined;
}

function evaluatePostClarifySemanticPass(run: {
  status: RunStatus;
  trace?: { steps?: unknown[] };
}): boolean {
  if (run.status === "clarification" || run.status === "failed") {
    return false;
  }
  const semanticStep = findTraceStep(run, "build-semantic-query");
  if (!semanticStep) {
    return false;
  }
  return semanticStep.status === "success";
}

async function readFixture(filePath: string): Promise<ClarificationBalanceFixture> {
  const raw = await readFile(filePath, "utf8");
  return ensureFixture(JSON.parse(raw), filePath);
}

function applyCollectorDefaults(): void {
  process.env.LLM_MOCK_MODE = process.env.LLM_MOCK_MODE ?? "true";
  process.env.LLM_PROVIDER = process.env.LLM_PROVIDER ?? "volcengine";
  process.env.AGENT_PLANNING_SCAFFOLD_ENABLED =
    process.env.AGENT_PLANNING_SCAFFOLD_ENABLED ?? "true";
  process.env.CLARIFICATION_HYBRID_ENABLED =
    process.env.CLARIFICATION_HYBRID_ENABLED ?? "true";
  process.env.CLARIFICATION_HYBRID_KILL_SWITCH_RULES_ONLY =
    process.env.CLARIFICATION_HYBRID_KILL_SWITCH_RULES_ONLY ?? "false";
  process.env.CLARIFICATION_HYBRID_TIMEOUT_MS =
    process.env.CLARIFICATION_HYBRID_TIMEOUT_MS ?? "1200";
  process.env.LANGSMITH_TRACING = process.env.LANGSMITH_TRACING ?? "false";
}

export async function collectClarificationBalanceGate(
  options: CollectOptions = {}
): Promise<ClarificationBalanceGateReport> {
  applyCollectorDefaults();
  const fixturePath = resolve(options.fixturePath ?? DEFAULT_FIXTURE_PATH);
  const outputPath = resolve(
    options.outputPath ??
      process.env.CLARIFICATION_BALANCE_GATE_REPORT_PATH ??
      DEFAULT_OUTPUT_PATH
  );
  const strictMode =
    options.strictMode ?? parseBoolean(process.env.CLARIFICATION_BALANCE_GATE_STRICT);

  const fixture = await readFixture(fixturePath);
  const thresholds = readThresholds();
  const caseDiagnostics: CaseDiagnostics[] = [];
  const falsePositiveCaseIds: string[] = [];
  const falseNegativeCaseIds: string[] = [];
  const metadataBypassMismatchCaseIds: string[] = [];
  const strictSemanticPathMismatchCaseIds: string[] = [];
  const clarificationRoundExceededCaseIds: string[] = [];
  const caseErrors: Array<{ caseId: string; message: string }> = [];

  let clarificationTriggered = 0;
  let falsePositiveCount = 0;
  let falseNegativeCount = 0;
  let postClarifySemanticTotal = 0;
  let postClarifySemanticPassed = 0;
  let clarificationRoundTotal = 0;

  const sqliteFixture = await createSeededSqliteFixture("clarification-balance-gate");
  process.env.SQLITE_PATH = sqliteFixture.dbPath;
  let moduleRef: TestingModule | undefined;

  try {
    const builtModule = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    moduleRef = builtModule;
    const chatService = builtModule.get(ChatService);

    for (const testCase of fixture.cases) {
      const diagnostics: CaseDiagnostics = {
        caseId: testCase.id,
        scenario: testCase.scenario,
        expectedShouldClarify: testCase.expected.shouldClarify,
        triggeredClarification: false,
        clarificationRounds: 0,
        firstRunStatus: "failed",
        metadataBypassDetected: false,
        strictSemanticPathDetected: false,
        postClarifySemanticPass: false,
        errors: []
      };

      try {
        const session = await chatService.createSession("sqlite_main");
        const firstRun = await chatService.sendMessage(
          session.id,
          testCase.initialQuestion,
          randomUUID()
        );
        const firstRunStatus = readRunStatus(firstRun.status);
        diagnostics.firstRunStatus = firstRunStatus;

        const triggeredClarification = firstRunStatus === "clarification";
        diagnostics.triggeredClarification = triggeredClarification;
        if (triggeredClarification) {
          clarificationTriggered += 1;
          diagnostics.clarificationRounds = 1;
        }

        if (triggeredClarification && !testCase.expected.shouldClarify) {
          falsePositiveCount += 1;
          falsePositiveCaseIds.push(testCase.id);
        }
        if (!triggeredClarification && testCase.expected.shouldClarify) {
          falseNegativeCount += 1;
          falseNegativeCaseIds.push(testCase.id);
        }

        diagnostics.metadataBypassDetected = detectMetadataBypass({
          status: firstRunStatus,
          trace: firstRun.trace
        });
        if (diagnostics.metadataBypassDetected !== testCase.expected.metadataBypass) {
          metadataBypassMismatchCaseIds.push(testCase.id);
        }

        diagnostics.strictSemanticPathDetected = detectStrictSemanticPath({
          trace: firstRun.trace
        });
        if (triggeredClarification && testCase.followUpQuestion) {
          const followUpRun = await chatService.sendMessage(
            session.id,
            testCase.followUpQuestion,
            randomUUID()
          );
          diagnostics.followUpRunStatus = readRunStatus(followUpRun.status);
          diagnostics.strictSemanticPathDetected =
            diagnostics.strictSemanticPathDetected ||
            detectStrictSemanticPath({ trace: followUpRun.trace });
          diagnostics.semanticPlanStatus = extractSemanticPlanStatus({
            trace: followUpRun.trace
          });
          diagnostics.postClarifySemanticPass = evaluatePostClarifySemanticPass({
            status: diagnostics.followUpRunStatus,
            trace: followUpRun.trace
          });
          postClarifySemanticTotal += 1;
          if (diagnostics.postClarifySemanticPass) {
            postClarifySemanticPassed += 1;
          }
        } else if (triggeredClarification && !testCase.followUpQuestion) {
          diagnostics.errors.push(
            "followUpQuestion is required when expected.shouldClarify=true"
          );
        }

        if (
          testCase.expected.strictSemanticPath &&
          !diagnostics.strictSemanticPathDetected
        ) {
          strictSemanticPathMismatchCaseIds.push(testCase.id);
        }

        clarificationRoundTotal += diagnostics.clarificationRounds;
        if (diagnostics.clarificationRounds > testCase.expected.maxClarificationRounds) {
          clarificationRoundExceededCaseIds.push(testCase.id);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        diagnostics.errors.push(message);
        caseErrors.push({ caseId: testCase.id, message });
      }

      caseDiagnostics.push(diagnostics);
    }
  } finally {
    await moduleRef?.close();
    await sqliteFixture.cleanup();
  }

  const sampleSize = fixture.cases.length;
  const triggerRate = sampleSize === 0 ? 0 : clarificationTriggered / sampleSize;
  const falsePositiveRate = sampleSize === 0 ? 0 : falsePositiveCount / sampleSize;
  const falseNegativeRate = sampleSize === 0 ? 0 : falseNegativeCount / sampleSize;
  const postClarifySemanticPassRate =
    postClarifySemanticTotal === 0 ? 0 : postClarifySemanticPassed / postClarifySemanticTotal;
  const averageClarificationRounds =
    clarificationTriggered === 0 ? 0 : clarificationRoundTotal / clarificationTriggered;
  const sampleReady = sampleSize >= thresholds.minSamples;

  const reasons: string[] = [];
  if (!sampleReady) {
    reasons.push("sample_not_ready");
  }
  if (triggerRate < thresholds.minTriggerRate) {
    reasons.push("trigger_rate_below_threshold");
  }
  if (triggerRate > thresholds.maxTriggerRate) {
    reasons.push("trigger_rate_above_threshold");
  }
  if (falsePositiveRate > thresholds.maxFalsePositiveRate) {
    reasons.push("false_positive_rate_exceeded");
  }
  if (falseNegativeRate > thresholds.maxFalseNegativeRate) {
    reasons.push("false_negative_rate_exceeded");
  }
  if (postClarifySemanticPassRate < thresholds.minPostClarifySemanticPassRate) {
    reasons.push("post_clarify_semantic_pass_rate_below_threshold");
  }
  if (averageClarificationRounds > thresholds.maxAverageClarificationRounds) {
    reasons.push("avg_clarification_rounds_exceeded");
  }
  if (metadataBypassMismatchCaseIds.length > 0) {
    reasons.push("metadata_bypass_expectation_mismatch");
  }
  if (strictSemanticPathMismatchCaseIds.length > 0) {
    reasons.push("strict_semantic_path_expectation_mismatch");
  }
  if (clarificationRoundExceededCaseIds.length > 0) {
    reasons.push("clarification_rounds_exceeded");
  }
  if (caseErrors.length > 0) {
    reasons.push("case_execution_error");
  }

  const report: ClarificationBalanceGateReport = {
    generatedAt: new Date().toISOString(),
    strictMode,
    fixture: {
      path: fixturePath,
      version: fixture.version,
      generatedAt: fixture.generatedAt,
      sampleSize
    },
    sampleReady,
    gatePass: sampleReady && reasons.length === 0,
    reasons,
    thresholds,
    metrics: {
      sampleSize,
      clarificationTriggered,
      triggerRate: toRate(triggerRate),
      falsePositiveRate: toRate(falsePositiveRate),
      falseNegativeRate: toRate(falseNegativeRate),
      postClarifySemanticPassRate: toRate(postClarifySemanticPassRate),
      averageClarificationRounds: toRate(averageClarificationRounds)
    },
    diagnostics: {
      falsePositiveCaseIds,
      falseNegativeCaseIds,
      metadataBypassMismatchCaseIds,
      strictSemanticPathMismatchCaseIds,
      clarificationRoundExceededCaseIds,
      caseErrors,
      cases: caseDiagnostics
    }
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");

  return report;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const report = await collectClarificationBalanceGate({
    fixturePath: args.fixturePath,
    outputPath: args.outputPath,
    strictMode: args.strictMode
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.strictMode && !report.gatePass) {
    process.stderr.write(
      `clarification balance gate failed under strict mode: ${
        report.reasons.join(", ") || "unknown_reason"
      }\n`
    );
    process.exitCode = 2;
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
    );
    process.exit(1);
  });
}
