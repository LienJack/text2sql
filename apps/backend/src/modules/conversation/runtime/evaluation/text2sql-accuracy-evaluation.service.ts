import { Injectable } from "@nestjs/common";

export const TEXT2SQL_ACCURACY_VERSION_KEYS = [
  "questionSet",
  "semantic",
  "schema",
  "policy",
  "data",
  "model",
  "prompt",
  "workflow",
  "code"
] as const;

export type Text2SqlAccuracyVersionKey =
  (typeof TEXT2SQL_ACCURACY_VERSION_KEYS)[number];

export type Text2SqlAccuracyReleaseDecision =
  | "GO"
  | "HOLD"
  | "NO_GO"
  | "ROLLBACK";

export type Text2SqlAccuracyReleasePhase = "pre_release" | "canary" | "online";

export interface Text2SqlAccuracyVersionTuple {
  questionSet: string;
  semantic: string;
  schema: string;
  policy: string;
  data: string;
  model: string;
  prompt: string;
  workflow: string;
  code: string;
}

export interface Text2SqlAccuracySliceManifest {
  version: "text2sql-accuracy-slice/v1";
  sliceId: string;
  questionSetDigest: string;
  baseline: {
    id: string;
    versions: Text2SqlAccuracyVersionTuple;
  };
  candidate: {
    id: string;
    versions: Text2SqlAccuracyVersionTuple;
  };
  oracleApproval: {
    approvedBy: string;
    approvedAt: string;
  };
  thresholds: {
    approvedBy: string;
    approvedAt: string;
    minRealOutcomePairs: number;
    minOutcomeAccuracyLowerBound: number;
    minPairedImprovementLowerBound: number;
    maxLatencyP95Ms: number;
  };
}

export type Text2SqlAccuracyOracleKind =
  | "golden_result"
  | "differential"
  | "metamorphic"
  | "mutation"
  | "business_invariant"
  | "llm_judge";

export interface Text2SqlOutcomeTrialPayload {
  version: "text2sql-outcome-trial/v1";
  evidenceId: string;
  trialId: string;
  sliceId: string;
  caseId: string;
  role: "baseline" | "candidate";
  mode: "controlled_shadow" | "enforce";
  versions: Text2SqlAccuracyVersionTuple;
  questionDigest: string;
  fixtureDigest: string;
  queryContractDigest: string;
  outcome: {
    passed: boolean;
    executionSucceeded: boolean;
    latencyMs: number;
    oracleVerdicts: Array<{
      oracleId: string;
      kind: Text2SqlAccuracyOracleKind;
      mandatory: boolean;
      passed: boolean;
    }>;
  };
  safety: {
    unauthorizedSqlCount: number;
    hardGateFalsePassCount: number;
    outOfBoundRepairCount: number;
  };
  issuedAt: string;
}

export interface Text2SqlAccuracyTrialEvidence {
  trust: "sanitized" | "signed-real";
  verified: boolean;
  reasonCodes: string[];
  payload: Text2SqlOutcomeTrialPayload;
}

export interface Text2SqlAccuracyEvaluationReport {
  sliceId: string;
  pairedTrialCount: number;
  realOutcomePairCount: number;
  baselineOutcomeAccuracy: number;
  candidateOutcomeAccuracy: number;
  candidateOutcomeAccuracyInterval: {
    lower: number;
    upper: number;
  };
  pairedImprovement: number;
  pairedImprovementInterval: {
    lower: number;
    upper: number;
  };
  candidateLatencyP95Ms: number;
  safety: Text2SqlOutcomeTrialPayload["safety"];
  releaseDecision: Text2SqlAccuracyReleaseDecision;
  gatePass: boolean;
  reasons: string[];
}

type AccuracyPair = {
  baseline: Text2SqlAccuracyTrialEvidence;
  candidate: Text2SqlAccuracyTrialEvidence;
};

const round = (value: number): number => Number(value.toFixed(4));

@Injectable()
export class Text2SqlAccuracyEvaluationService {
  summarize(input: {
    manifest: Text2SqlAccuracySliceManifest;
    trials: Text2SqlAccuracyTrialEvidence[];
    releasePhase: Text2SqlAccuracyReleasePhase;
  }): Text2SqlAccuracyEvaluationReport {
    const reasons: string[] = [];
    this.validateManifest(input.manifest, reasons);

    const validTrials = this.validateTrials(input.manifest, input.trials, reasons);
    const pairs = this.buildPairs(validTrials, reasons);
    const realPairs = pairs.filter(
      (pair) =>
        pair.baseline.trust === "signed-real" &&
        pair.candidate.trust === "signed-real" &&
        pair.baseline.payload.mode === "enforce" &&
        pair.candidate.payload.mode === "enforce"
    );
    const metricPairs = realPairs.length > 0 ? realPairs : pairs;

    const baselinePassed = metricPairs.filter(
      (pair) => pair.baseline.payload.outcome.passed
    ).length;
    const candidatePassed = metricPairs.filter(
      (pair) => pair.candidate.payload.outcome.passed
    ).length;
    const baselineOutcomeAccuracy = this.rate(baselinePassed, metricPairs.length);
    const candidateOutcomeAccuracy = this.rate(candidatePassed, metricPairs.length);
    const candidateOutcomeAccuracyInterval = this.wilsonInterval(
      candidatePassed,
      metricPairs.length
    );
    const improvements = metricPairs.map(
      (pair) =>
        Number(pair.candidate.payload.outcome.passed) -
        Number(pair.baseline.payload.outcome.passed)
    );
    const pairedImprovement = this.mean(improvements);
    const pairedImprovementInterval = this.meanInterval(improvements);
    const candidateLatencyP95Ms = this.percentile(
      metricPairs.map((pair) => pair.candidate.payload.outcome.latencyMs),
      0.95
    );
    const safety = this.sumSafety(validTrials);

    const safetyFailed = Object.values(safety).some((value) => value > 0);
    let releaseDecision: Text2SqlAccuracyReleaseDecision;
    if (safetyFailed) {
      reasons.push("safety_zero_tolerance_violated");
      releaseDecision =
        input.releasePhase === "pre_release" ? "NO_GO" : "ROLLBACK";
    } else if (reasons.length > 0) {
      releaseDecision = "HOLD";
    } else if (realPairs.length < input.manifest.thresholds.minRealOutcomePairs) {
      reasons.push(
        realPairs.length === 0
          ? "real_outcome_evidence_missing"
          : "real_outcome_sample_not_ready"
      );
      releaseDecision = "HOLD";
    } else if (
      candidateOutcomeAccuracy <
        input.manifest.thresholds.minOutcomeAccuracyLowerBound ||
      pairedImprovement < input.manifest.thresholds.minPairedImprovementLowerBound ||
      candidateLatencyP95Ms > input.manifest.thresholds.maxLatencyP95Ms
    ) {
      if (
        candidateOutcomeAccuracy <
        input.manifest.thresholds.minOutcomeAccuracyLowerBound
      ) {
        reasons.push("outcome_accuracy_below_threshold");
      }
      if (
        pairedImprovement < input.manifest.thresholds.minPairedImprovementLowerBound
      ) {
        reasons.push("paired_improvement_below_threshold");
      }
      if (candidateLatencyP95Ms > input.manifest.thresholds.maxLatencyP95Ms) {
        reasons.push("latency_p95_exceeded");
      }
      releaseDecision = "NO_GO";
    } else if (
      candidateOutcomeAccuracyInterval.lower <
        input.manifest.thresholds.minOutcomeAccuracyLowerBound ||
      pairedImprovementInterval.lower <
        input.manifest.thresholds.minPairedImprovementLowerBound
    ) {
      if (
        candidateOutcomeAccuracyInterval.lower <
        input.manifest.thresholds.minOutcomeAccuracyLowerBound
      ) {
        reasons.push("outcome_accuracy_uncertain");
      }
      if (
        pairedImprovementInterval.lower <
        input.manifest.thresholds.minPairedImprovementLowerBound
      ) {
        reasons.push("paired_improvement_uncertain");
      }
      releaseDecision = "HOLD";
    } else {
      releaseDecision = "GO";
    }

    return {
      sliceId: input.manifest.sliceId,
      pairedTrialCount: pairs.length,
      realOutcomePairCount: realPairs.length,
      baselineOutcomeAccuracy,
      candidateOutcomeAccuracy,
      candidateOutcomeAccuracyInterval,
      pairedImprovement,
      pairedImprovementInterval,
      candidateLatencyP95Ms,
      safety,
      releaseDecision,
      gatePass: releaseDecision === "GO",
      reasons: [...new Set(reasons)]
    };
  }

  private validateManifest(
    manifest: Text2SqlAccuracySliceManifest,
    reasons: string[]
  ): void {
    if (manifest.version !== "text2sql-accuracy-slice/v1") {
      reasons.push("manifest_version_unsupported");
    }
    if (!manifest.sliceId.trim() || !manifest.questionSetDigest.trim()) {
      reasons.push("manifest_identity_incomplete");
    }
    if (
      manifest.questionSetDigest !== manifest.baseline.versions.questionSet ||
      manifest.questionSetDigest !== manifest.candidate.versions.questionSet
    ) {
      reasons.push("manifest_question_set_mismatch");
    }
    if (
      !this.versionTupleComplete(manifest.baseline.versions) ||
      !this.versionTupleComplete(manifest.candidate.versions)
    ) {
      reasons.push("manifest_version_tuple_incomplete");
    }
    if (
      !manifest.oracleApproval ||
      !manifest.oracleApproval.approvedBy.trim() ||
      !this.validDate(manifest.oracleApproval.approvedAt)
    ) {
      reasons.push("oracle_approval_missing");
    }
    if (
      !manifest.thresholds.approvedBy.trim() ||
      !this.validDate(manifest.thresholds.approvedAt)
    ) {
      reasons.push("threshold_approval_missing");
    }
    if (
      !Number.isInteger(manifest.thresholds.minRealOutcomePairs) ||
      manifest.thresholds.minRealOutcomePairs <= 0 ||
      !Number.isFinite(manifest.thresholds.minOutcomeAccuracyLowerBound) ||
      manifest.thresholds.minOutcomeAccuracyLowerBound < 0 ||
      manifest.thresholds.minOutcomeAccuracyLowerBound > 1 ||
      !Number.isFinite(manifest.thresholds.minPairedImprovementLowerBound) ||
      manifest.thresholds.minPairedImprovementLowerBound < -1 ||
      manifest.thresholds.minPairedImprovementLowerBound > 1 ||
      !Number.isFinite(manifest.thresholds.maxLatencyP95Ms) ||
      manifest.thresholds.maxLatencyP95Ms <= 0
    ) {
      reasons.push("thresholds_invalid");
    }
  }

  private validateTrials(
    manifest: Text2SqlAccuracySliceManifest,
    trials: Text2SqlAccuracyTrialEvidence[],
    reasons: string[]
  ): Text2SqlAccuracyTrialEvidence[] {
    const evidenceIds = new Set<string>();
    const valid: Text2SqlAccuracyTrialEvidence[] = [];
    for (const trial of trials) {
      const payload = trial.payload;
      if (!trial.verified || trial.reasonCodes.length > 0) {
        reasons.push(`trial_evidence_unverified:${payload.role}:${payload.caseId}`);
        continue;
      }
      if (evidenceIds.has(payload.evidenceId)) {
        reasons.push(`trial_evidence_replayed:${payload.evidenceId}`);
        continue;
      }
      evidenceIds.add(payload.evidenceId);
      if (payload.sliceId !== manifest.sliceId) {
        reasons.push(`trial_slice_mismatch:${payload.role}:${payload.caseId}`);
        continue;
      }
      if (!this.validDate(payload.issuedAt)) {
        reasons.push(`trial_issued_at_invalid:${payload.role}:${payload.caseId}`);
        continue;
      }
      const expectedVersions =
        payload.role === "baseline"
          ? manifest.baseline.versions
          : manifest.candidate.versions;
      if (!this.versionTupleMatches(payload.versions, expectedVersions)) {
        reasons.push(`trial_version_mismatch:${payload.role}:${payload.caseId}`);
        continue;
      }
      const mandatoryOracles = payload.outcome.oracleVerdicts.filter(
        (item) => item.mandatory
      );
      if (
        mandatoryOracles.length === 0 ||
        mandatoryOracles.some((item) => item.kind === "llm_judge")
      ) {
        reasons.push(`trial_oracle_incomplete:${payload.role}:${payload.caseId}`);
        continue;
      }
      const expectedOutcomePassed =
        payload.outcome.executionSucceeded &&
        mandatoryOracles.every((item) => item.passed);
      if (
        payload.outcome.passed !== expectedOutcomePassed ||
        !Number.isFinite(payload.outcome.latencyMs) ||
        payload.outcome.latencyMs < 0 ||
        Object.values(payload.safety).some(
          (value) => !Number.isInteger(value) || value < 0
        )
      ) {
        reasons.push(`trial_outcome_inconsistent:${payload.role}:${payload.caseId}`);
        continue;
      }
      valid.push(trial);
    }
    return valid;
  }

  private buildPairs(
    trials: Text2SqlAccuracyTrialEvidence[],
    reasons: string[]
  ): AccuracyPair[] {
    const index = new Map<
      string,
      Partial<Record<Text2SqlOutcomeTrialPayload["role"], Text2SqlAccuracyTrialEvidence>>
    >();
    for (const trial of trials) {
      const current = index.get(trial.payload.caseId) ?? {};
      const existing = current[trial.payload.role];
      if (existing) {
        if (existing.trust === "sanitized" && trial.trust === "signed-real") {
          current[trial.payload.role] = trial;
          index.set(trial.payload.caseId, current);
          continue;
        }
        if (existing.trust === "signed-real" && trial.trust === "sanitized") {
          continue;
        }
        reasons.push(`duplicate_trial_role:${trial.payload.role}:${trial.payload.caseId}`);
        continue;
      }
      current[trial.payload.role] = trial;
      index.set(trial.payload.caseId, current);
    }

    const pairs: AccuracyPair[] = [];
    for (const [caseId, pair] of index) {
      if (!pair.baseline || !pair.candidate) {
        reasons.push(`trial_pair_incomplete:${caseId}`);
        continue;
      }
      const baseline = pair.baseline.payload;
      const candidate = pair.candidate.payload;
      if (
        baseline.questionDigest !== candidate.questionDigest ||
        baseline.fixtureDigest !== candidate.fixtureDigest ||
        baseline.queryContractDigest !== candidate.queryContractDigest
      ) {
        reasons.push(`trial_pair_identity_mismatch:${caseId}`);
        continue;
      }
      pairs.push({ baseline: pair.baseline, candidate: pair.candidate });
    }
    return pairs;
  }

  private versionTupleComplete(tuple: Text2SqlAccuracyVersionTuple): boolean {
    return TEXT2SQL_ACCURACY_VERSION_KEYS.every(
      (key) => typeof tuple[key] === "string" && tuple[key].trim().length > 0
    );
  }

  private versionTupleMatches(
    actual: Text2SqlAccuracyVersionTuple,
    expected: Text2SqlAccuracyVersionTuple
  ): boolean {
    return TEXT2SQL_ACCURACY_VERSION_KEYS.every(
      (key) => actual[key] === expected[key]
    );
  }

  private validDate(value: string): boolean {
    return typeof value === "string" && Number.isFinite(Date.parse(value));
  }

  private rate(numerator: number, denominator: number): number {
    return denominator === 0 ? 0 : round(numerator / denominator);
  }

  private mean(values: number[]): number {
    return values.length === 0
      ? 0
      : round(values.reduce((sum, value) => sum + value, 0) / values.length);
  }

  private wilsonInterval(successes: number, total: number): {
    lower: number;
    upper: number;
  } {
    if (total === 0) {
      return { lower: 0, upper: 0 };
    }
    const z = 1.96;
    const p = successes / total;
    const denominator = 1 + (z * z) / total;
    const center = (p + (z * z) / (2 * total)) / denominator;
    const margin =
      (z / denominator) *
      Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
    return {
      lower: round(Math.max(0, center - margin)),
      upper: round(Math.min(1, center + margin))
    };
  }

  private meanInterval(values: number[]): { lower: number; upper: number } {
    if (values.length === 0) {
      return { lower: 0, upper: 0 };
    }
    const mean = this.mean(values);
    if (values.length === 1) {
      return { lower: -1, upper: 1 };
    }
    const variance =
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      (values.length - 1);
    const margin = 1.96 * Math.sqrt(variance / values.length);
    return {
      lower: round(Math.max(-1, mean - margin)),
      upper: round(Math.min(1, mean + margin))
    };
  }

  private percentile(values: number[], percentile: number): number {
    const sorted = values
      .filter((value) => Number.isFinite(value) && value >= 0)
      .sort((left, right) => left - right);
    if (sorted.length === 0) {
      return 0;
    }
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(sorted.length * percentile) - 1)
    );
    return Math.round(sorted[index] ?? 0);
  }

  private sumSafety(
    trials: Text2SqlAccuracyTrialEvidence[]
  ): Text2SqlOutcomeTrialPayload["safety"] {
    return trials.reduce<Text2SqlOutcomeTrialPayload["safety"]>(
      (summary, trial) => ({
        unauthorizedSqlCount:
          summary.unauthorizedSqlCount + trial.payload.safety.unauthorizedSqlCount,
        hardGateFalsePassCount:
          summary.hardGateFalsePassCount + trial.payload.safety.hardGateFalsePassCount,
        outOfBoundRepairCount:
          summary.outOfBoundRepairCount + trial.payload.safety.outOfBoundRepairCount
      }),
      {
        unauthorizedSqlCount: 0,
        hardGateFalsePassCount: 0,
        outOfBoundRepairCount: 0
      }
    );
  }
}
