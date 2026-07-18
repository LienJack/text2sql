import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";
import { ConfigService } from "@nestjs/config";
import { AppConfigService } from "../src/modules/config/app-config.service";
import {
  Text2SqlAccuracyEvaluationService,
  type Text2SqlAccuracyEvaluationReport,
  type Text2SqlAccuracyReleaseDecision,
  type Text2SqlAccuracyReleasePhase,
  type Text2SqlAccuracySliceManifest,
  type Text2SqlAccuracyTrialEvidence,
  type Text2SqlAccuracyVersionTuple,
  type Text2SqlOutcomeTrialPayload
} from "../src/modules/conversation/runtime/evaluation/text2sql-accuracy-evaluation.service";
import {
  Text2SqlOutcomeEvidenceVerifierService,
  type Text2SqlOutcomeEvidenceBinding,
  type Text2SqlSignedOutcomeEvidenceEnvelope
} from "../src/modules/conversation/runtime/evaluation/text2sql-outcome-evidence-verifier.service";
import {
  collectText2SqlV2EvalGate,
  type Text2SqlV2CloseoutGateReport
} from "./collect-text2sql-v2-eval-gate";

const execFileAsync = promisify(execFile);

export interface GuidelineBaselineArtifact {
  id: string;
  relativePath: string;
  sha256: string;
  capturedAt: string;
  appliesToRequirements: string[];
}

export interface GuidelineBaseline {
  version: "text2sql-guideline-baseline/v1";
  baselineId: string;
  source: {
    projectSlug: string;
    projectStatus: string;
    projectUpdatedAt: string;
    rootPath: string;
  };
  artifacts: GuidelineBaselineArtifact[];
}

interface AccuracyThresholdProfile {
  version: "text2sql-accuracy-thresholds/v1";
  profileId: string;
  approvedBy: string;
  approvedAt: string;
  minRealOutcomePairs: number;
  minOutcomeAccuracyLowerBound: number;
  minPairedImprovementLowerBound: number;
  maxLatencyP95Ms: number;
}

interface SanitizedFixture {
  id: string;
  digest: string;
  setupSql: string;
  expectedRows: Array<Record<string, unknown>>;
}

interface SanitizedAccuracyCase {
  id: string;
  question: string;
  questionDigest: string;
  queryContractDigest: string;
  baselineSql: string;
  candidateSql: string;
  oracle: {
    id: string;
    kind: "golden_result";
    mandatory: true;
  };
  fixtures: SanitizedFixture[];
}

interface SanitizedAccuracySlice {
  version: "text2sql-accuracy-slice/v1";
  sliceId: string;
  frozenAt: string;
  questionSetDigest: string;
  thresholdProfile: string;
  baseline: { id: string; versions: Text2SqlAccuracyVersionTuple };
  candidate: { id: string; versions: Text2SqlAccuracyVersionTuple };
  oracleApproval: { approvedBy: string; approvedAt: string };
  cases: SanitizedAccuracyCase[];
}

interface GuidelineComparison {
  baselineId: string;
  sourceStatus: "current" | "drifted" | "unavailable";
  driftedArtifactIds: string[];
  affectedRequirements: string[];
}

interface AccuracyTrialSummary {
  evidenceId: string;
  trialId: string;
  caseId: string;
  role: "baseline" | "candidate";
  trust: "sanitized" | "signed-real";
  verified: boolean;
  passed: boolean;
  reasonCodes: string[];
}

export interface Text2SqlAccuracyGateReport {
  version: "text2sql-accuracy-gate-report/v1";
  generatedAt: string;
  evaluationIdentity: string;
  guideline: GuidelineComparison;
  evidence: {
    sanitizedTrialCount: number;
    signedRealTrialCount: number;
    rejectedRealTrialCount: number;
    trials: AccuracyTrialSummary[];
  };
  summary: Text2SqlAccuracyEvaluationReport;
  closeout: {
    status: "passed" | "failed" | "unavailable";
    recommendedStage?: "direct_v2_go" | "hold" | "rollback_or_hold";
    rollbackSuggested: boolean;
    reasons: string[];
  };
  rollout: {
    gatePass: boolean;
    releaseDecision: Text2SqlAccuracyReleaseDecision;
    reasons: string[];
  };
}

interface CollectAccuracyGateOptions {
  guidelineBaselinePath: string;
  slicePath: string;
  thresholdsPath: string;
  releasePhase: Text2SqlAccuracyReleasePhase;
  guidelineSourceRoot?: string;
  outcomeEvidenceEnvelopes?: Text2SqlSignedOutcomeEvidenceEnvelope[];
  evidenceVerifier?: Text2SqlOutcomeEvidenceVerifierService;
  closeoutReport?: Text2SqlV2CloseoutGateReport;
}

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)])
    );
  }
  return value;
};

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf-8")) as T;
}

function buildManifest(
  slice: SanitizedAccuracySlice,
  thresholds: AccuracyThresholdProfile
): Text2SqlAccuracySliceManifest {
  if (slice.thresholdProfile !== thresholds.profileId) {
    throw new Error("accuracy_threshold_profile_mismatch");
  }
  return {
    version: slice.version,
    sliceId: slice.sliceId,
    questionSetDigest: slice.questionSetDigest,
    baseline: slice.baseline,
    candidate: slice.candidate,
    oracleApproval: slice.oracleApproval,
    thresholds: {
      approvedBy: thresholds.approvedBy,
      approvedAt: thresholds.approvedAt,
      minRealOutcomePairs: thresholds.minRealOutcomePairs,
      minOutcomeAccuracyLowerBound: thresholds.minOutcomeAccuracyLowerBound,
      minPairedImprovementLowerBound: thresholds.minPairedImprovementLowerBound,
      maxLatencyP95Ms: thresholds.maxLatencyP95Ms
    }
  };
}

export async function compareGuidelineBaseline(
  baseline: GuidelineBaseline,
  sourceRootOverride?: string
): Promise<GuidelineComparison> {
  const sourceRoot = sourceRootOverride ?? baseline.source.rootPath;
  if (!existsSync(sourceRoot)) {
    return {
      baselineId: baseline.baselineId,
      sourceStatus: "unavailable",
      driftedArtifactIds: [],
      affectedRequirements: []
    };
  }

  const drifted = await Promise.all(
    baseline.artifacts.map(async (artifact) => {
      const artifactPath = resolve(sourceRoot, artifact.relativePath);
      if (!existsSync(artifactPath)) {
        return artifact;
      }
      const actualDigest = sha256(await readFile(artifactPath, "utf-8"));
      return actualDigest === artifact.sha256 ? undefined : artifact;
    })
  );
  const driftedArtifacts = drifted.filter(
    (item): item is GuidelineBaselineArtifact => Boolean(item)
  );
  return {
    baselineId: baseline.baselineId,
    sourceStatus: driftedArtifacts.length === 0 ? "current" : "drifted",
    driftedArtifactIds: driftedArtifacts.map((item) => item.id),
    affectedRequirements: [
      ...new Set(driftedArtifacts.flatMap((item) => item.appliesToRequirements))
    ].sort()
  };
}

function fixtureDigest(fixture: SanitizedFixture): string {
  return sha256(
    stableJson({
      id: fixture.id,
      setupSql: fixture.setupSql,
      expectedRows: fixture.expectedRows
    })
  );
}

function buildTrialId(input: {
  sliceId: string;
  caseId: string;
  role: "baseline" | "candidate";
  versions: Text2SqlAccuracyVersionTuple;
  questionDigest: string;
  fixtureDigest: string;
  queryContractDigest: string;
}): string {
  return sha256(stableJson(input));
}

async function executeSql(
  setupSql: string,
  querySql: string
): Promise<{ rows: Array<Record<string, unknown>>; latencyMs: number }> {
  const startedAt = Date.now();
  const { stdout } = await execFileAsync(
    "sqlite3",
    [":memory:", "-json", `${setupSql}\n${querySql}`],
    { timeout: 5_000, maxBuffer: 1_048_576 }
  );
  const output = stdout.trim();
  return {
    rows: output ? (JSON.parse(output) as Array<Record<string, unknown>>) : [],
    latencyMs: Math.max(1, Date.now() - startedAt)
  };
}

export async function executeSanitizedSlice(
  slice: SanitizedAccuracySlice
): Promise<Text2SqlAccuracyTrialEvidence[]> {
  const trials: Text2SqlAccuracyTrialEvidence[] = [];
  for (const accuracyCase of slice.cases) {
    for (const fixture of accuracyCase.fixtures) {
      const actualFixtureDigest = fixtureDigest(fixture);
      if (actualFixtureDigest !== fixture.digest) {
        throw new Error(`sanitized_fixture_digest_mismatch:${accuracyCase.id}:${fixture.id}`);
      }
      const caseId = `${accuracyCase.id}:${fixture.id}`;
      for (const role of ["baseline", "candidate"] as const) {
        const versions = slice[role].versions;
        const trialId = buildTrialId({
          sliceId: slice.sliceId,
          caseId,
          role,
          versions,
          questionDigest: accuracyCase.questionDigest,
          fixtureDigest: fixture.digest,
          queryContractDigest: accuracyCase.queryContractDigest
        });
        let executionSucceeded = false;
        let latencyMs = 0;
        let passed = false;
        try {
          const execution = await executeSql(
            fixture.setupSql,
            role === "baseline" ? accuracyCase.baselineSql : accuracyCase.candidateSql
          );
          executionSucceeded = true;
          latencyMs = execution.latencyMs;
          passed = stableJson(execution.rows) === stableJson(fixture.expectedRows);
        } catch {
          executionSucceeded = false;
        }

        const payload: Text2SqlOutcomeTrialPayload = {
          version: "text2sql-outcome-trial/v1",
          evidenceId: `sanitized-${trialId}`,
          trialId,
          sliceId: slice.sliceId,
          caseId,
          role,
          mode: "controlled_shadow",
          versions,
          questionDigest: accuracyCase.questionDigest,
          fixtureDigest: fixture.digest,
          queryContractDigest: accuracyCase.queryContractDigest,
          outcome: {
            passed,
            executionSucceeded,
            latencyMs,
            oracleVerdicts: [
              {
                oracleId: accuracyCase.oracle.id,
                kind: accuracyCase.oracle.kind,
                mandatory: accuracyCase.oracle.mandatory,
                passed
              }
            ]
          },
          safety: {
            unauthorizedSqlCount: 0,
            hardGateFalsePassCount: 0,
            outOfBoundRepairCount: 0
          },
          issuedAt: slice.frozenAt
        };
        trials.push({ trust: "sanitized", verified: true, reasonCodes: [], payload });
      }
    }
  }
  return trials;
}

function expectedBinding(
  slice: SanitizedAccuracySlice,
  payload: Text2SqlOutcomeTrialPayload
): Text2SqlOutcomeEvidenceBinding | undefined {
  const separator = payload.caseId.lastIndexOf(":");
  if (separator < 1) {
    return undefined;
  }
  const caseId = payload.caseId.slice(0, separator);
  const fixtureId = payload.caseId.slice(separator + 1);
  const accuracyCase = slice.cases.find((item) => item.id === caseId);
  const fixture = accuracyCase?.fixtures.find((item) => item.id === fixtureId);
  if (!accuracyCase || !fixture) {
    return undefined;
  }
  const versions = slice[payload.role].versions;
  return {
    sliceId: slice.sliceId,
    caseId: payload.caseId,
    role: payload.role,
    trialId: buildTrialId({
      sliceId: slice.sliceId,
      caseId: payload.caseId,
      role: payload.role,
      versions,
      questionDigest: accuracyCase.questionDigest,
      fixtureDigest: fixture.digest,
      queryContractDigest: accuracyCase.queryContractDigest
    }),
    fixtureDigest: fixture.digest,
    questionDigest: accuracyCase.questionDigest,
    queryContractDigest: accuracyCase.queryContractDigest,
    versions
  };
}

function verifyRealEvidence(
  slice: SanitizedAccuracySlice,
  envelopes: Text2SqlSignedOutcomeEvidenceEnvelope[],
  verifier?: Text2SqlOutcomeEvidenceVerifierService
): Text2SqlAccuracyTrialEvidence[] {
  return envelopes.map((envelope) => {
    const binding = expectedBinding(slice, envelope.payload);
    if (!binding || !verifier) {
      return {
        trust: "signed-real",
        verified: false,
        reasonCodes: [binding ? "evidence_verifier_unavailable" : "trial_binding_unknown"],
        payload: envelope.payload
      };
    }
    return verifier.verifyEnvelope(envelope, binding);
  });
}

function summarizeTrial(trial: Text2SqlAccuracyTrialEvidence): AccuracyTrialSummary {
  return {
    evidenceId: trial.payload.evidenceId,
    trialId: trial.payload.trialId,
    caseId: trial.payload.caseId,
    role: trial.payload.role,
    trust: trial.trust,
    verified: trial.verified,
    passed: trial.payload.outcome.passed,
    reasonCodes: trial.reasonCodes
  };
}

export async function collectText2SqlAccuracyGate(
  options: CollectAccuracyGateOptions
): Promise<Text2SqlAccuracyGateReport> {
  const [baseline, slice, thresholds] = await Promise.all([
    readJson<GuidelineBaseline>(options.guidelineBaselinePath),
    readJson<SanitizedAccuracySlice>(options.slicePath),
    readJson<AccuracyThresholdProfile>(options.thresholdsPath)
  ]);
  const manifest = buildManifest(slice, thresholds);
  const guideline = await compareGuidelineBaseline(
    baseline,
    options.guidelineSourceRoot
  );
  const sanitizedTrials = await executeSanitizedSlice(slice);
  const realTrials = verifyRealEvidence(
    slice,
    options.outcomeEvidenceEnvelopes ?? [],
    options.evidenceVerifier
  );
  const allTrials = [...sanitizedTrials, ...realTrials];
  const summary = new Text2SqlAccuracyEvaluationService().summarize({
    manifest,
    trials: allTrials,
    releasePhase: options.releasePhase
  });
  const reasons = [...summary.reasons];
  let releaseDecision = summary.releaseDecision;
  if (guideline.sourceStatus === "drifted") {
    reasons.push("guideline_baseline_drift");
    if (releaseDecision === "GO") {
      releaseDecision = "HOLD";
    }
  }
  const closeout = options.closeoutReport
    ? {
        status: options.closeoutReport.rollout.gatePass
          ? ("passed" as const)
          : ("failed" as const),
        recommendedStage: options.closeoutReport.rollout.recommendedStage,
        rollbackSuggested: options.closeoutReport.rollout.rollbackSuggested,
        reasons: options.closeoutReport.rollout.reasons
      }
    : {
        status: "unavailable" as const,
        rollbackSuggested: false,
        reasons: ["closeout_gate_unavailable"]
      };
  if (closeout.status !== "passed") {
    reasons.push(...closeout.reasons.map((reason) => `closeout:${reason}`));
    const missingOrUnavailable = closeout.reasons.some((reason) =>
      /missing|unavailable|not_ready|empty/i.test(reason)
    );
    if (
      closeout.rollbackSuggested &&
      options.releasePhase !== "pre_release"
    ) {
      releaseDecision = "ROLLBACK";
    } else if (releaseDecision === "GO") {
      releaseDecision = missingOrUnavailable ? "HOLD" : "NO_GO";
    }
  }

  return {
    version: "text2sql-accuracy-gate-report/v1",
    generatedAt: new Date().toISOString(),
    evaluationIdentity: sha256(stableJson({ baseline, manifest })),
    guideline,
    evidence: {
      sanitizedTrialCount: sanitizedTrials.length,
      signedRealTrialCount: realTrials.filter((item) => item.verified).length,
      rejectedRealTrialCount: realTrials.filter((item) => !item.verified).length,
      trials: allTrials.map((item) => summarizeTrial(item))
    },
    summary,
    closeout,
    rollout: {
      gatePass: releaseDecision === "GO",
      releaseDecision,
      reasons: [...new Set(reasons)]
    }
  };
}

async function readEvidenceDirectory(
  directory: string | undefined
): Promise<Text2SqlSignedOutcomeEvidenceEnvelope[]> {
  if (!directory) {
    return [];
  }
  const root = resolve(directory);
  if (!existsSync(root)) {
    return [];
  }
  const entries = (await readdir(root)).filter((item) => item.endsWith(".json")).sort();
  return Promise.all(
    entries.map((entry) => readJson<Text2SqlSignedOutcomeEvidenceEnvelope>(resolve(root, entry)))
  );
}

function optionValue(argv: string[], name: string): string | undefined {
  return argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const fixtureRoot = resolve(__dirname, "../test/fixtures/text2sql-accuracy");
  const config = new AppConfigService(new ConfigService(process.env));
  const envelopes = await readEvidenceDirectory(
    optionValue(argv, "--evidence-dir") ?? process.env.TEXT2SQL_ACCURACY_EVIDENCE_DIR
  );
  const sourceRootOverride = optionValue(argv, "--guideline-source-root");
  const closeoutReport = await collectText2SqlV2EvalGate({
    fixturePath:
      optionValue(argv, "--eval-fixture") ??
      resolve(__dirname, "../test/fixtures/text2sql-v2-eval-cases.json"),
    characterizationFixturePath:
      optionValue(argv, "--characterization-fixture") ??
      resolve(__dirname, "../test/fixtures/text2sql-v2-characterization-cases.json"),
    focusedCoveragePath:
      optionValue(argv, "--coverage-json") ??
      resolve(__dirname, "../coverage/coverage-final.json"),
    focusedMatrixPath:
      optionValue(argv, "--matrix") ??
      resolve(__dirname, "../test/fixtures/text2sql-v2-closeout-flow-matrix.json")
  });
  const report = await collectText2SqlAccuracyGate({
    guidelineBaselinePath:
      optionValue(argv, "--guideline-baseline") ??
      resolve(fixtureRoot, "guideline-baseline.json"),
    slicePath:
      optionValue(argv, "--slice") ??
      resolve(fixtureRoot, "sanitized-reference-slice.json"),
    thresholdsPath:
      optionValue(argv, "--thresholds") ?? resolve(fixtureRoot, "thresholds.json"),
    releasePhase: (optionValue(argv, "--release-phase") ??
      "pre_release") as Text2SqlAccuracyReleasePhase,
    guidelineSourceRoot:
      sourceRootOverride && !isAbsolute(sourceRootOverride)
        ? resolve(sourceRootOverride)
        : sourceRootOverride,
    outcomeEvidenceEnvelopes: envelopes,
    evidenceVerifier: new Text2SqlOutcomeEvidenceVerifierService(config),
    closeoutReport
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if ((argv.includes("--strict") || argv.includes("--fail-on-gate")) && !report.rollout.gatePass) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}
