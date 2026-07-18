import {
  Text2SqlAccuracyEvaluationService,
  type Text2SqlAccuracySliceManifest,
  type Text2SqlAccuracyTrialEvidence,
  type Text2SqlAccuracyVersionTuple
} from "../../src/modules/conversation/runtime/evaluation/text2sql-accuracy-evaluation.service";

const baselineVersions: Text2SqlAccuracyVersionTuple = {
  questionSet: "questions-v1",
  semantic: "semantic-v1",
  schema: "schema-v1",
  policy: "policy-v1",
  data: "data-v1",
  model: "model-baseline",
  prompt: "prompt-baseline",
  workflow: "workflow-v1",
  code: "code-baseline"
};

const candidateVersions: Text2SqlAccuracyVersionTuple = {
  ...baselineVersions,
  model: "model-candidate",
  prompt: "prompt-candidate",
  code: "code-candidate"
};

const manifest: Text2SqlAccuracySliceManifest = {
  version: "text2sql-accuracy-slice/v1",
  sliceId: "sanitized-reference",
  questionSetDigest: "questions-v1",
  baseline: {
    id: "baseline-v1",
    versions: baselineVersions
  },
  candidate: {
    id: "candidate-v1",
    versions: candidateVersions
  },
  oracleApproval: {
    approvedBy: "domain-owner",
    approvedAt: "2026-07-17T00:00:00.000Z"
  },
  thresholds: {
    approvedBy: "domain-owner",
    approvedAt: "2026-07-17T00:00:00.000Z",
    minRealOutcomePairs: 2,
    minOutcomeAccuracyLowerBound: 0,
    minPairedImprovementLowerBound: -1,
    maxLatencyP95Ms: 1_000
  }
};

function trial(input: {
  caseId: string;
  role: "baseline" | "candidate";
  trust?: "sanitized" | "signed-real";
  passed?: boolean;
  versions?: Text2SqlAccuracyVersionTuple;
  unauthorizedSqlCount?: number;
  hardGateFalsePassCount?: number;
  outOfBoundRepairCount?: number;
}): Text2SqlAccuracyTrialEvidence {
  const versions =
    input.versions ?? (input.role === "baseline" ? baselineVersions : candidateVersions);
  const trust = input.trust ?? "signed-real";
  return {
    trust,
    verified: true,
    reasonCodes: [],
    payload: {
      version: "text2sql-outcome-trial/v1",
      evidenceId: `${trust}-${input.role}-${input.caseId}`,
      trialId: `${input.role}-${input.caseId}`,
      sliceId: manifest.sliceId,
      caseId: input.caseId,
      role: input.role,
      mode: "enforce",
      versions,
      questionDigest: `${input.caseId}-question`,
      fixtureDigest: `${input.caseId}-fixture`,
      queryContractDigest: `${input.caseId}-contract`,
      outcome: {
        passed: input.passed ?? true,
        executionSucceeded: true,
        latencyMs: 100,
        oracleVerdicts: [
          {
            oracleId: "golden-result",
            kind: "golden_result",
            mandatory: true,
            passed: input.passed ?? true
          }
        ]
      },
      safety: {
        unauthorizedSqlCount: input.unauthorizedSqlCount ?? 0,
        hardGateFalsePassCount: input.hardGateFalsePassCount ?? 0,
        outOfBoundRepairCount: input.outOfBoundRepairCount ?? 0
      },
      issuedAt: "2026-07-17T01:00:00.000Z"
    }
  };
}

describe("Text2SqlAccuracyEvaluationService", () => {
  const service = new Text2SqlAccuracyEvaluationService();

  it("keeps release on HOLD when only sanitized or synthetic evidence exists", () => {
    const report = service.summarize({
      manifest,
      releasePhase: "pre_release",
      trials: [
        trial({ caseId: "case-1", role: "baseline", trust: "sanitized" }),
        trial({ caseId: "case-1", role: "candidate", trust: "sanitized" }),
        trial({ caseId: "case-2", role: "baseline", trust: "sanitized" }),
        trial({ caseId: "case-2", role: "candidate", trust: "sanitized" })
      ]
    });

    expect(report.pairedTrialCount).toBe(2);
    expect(report.realOutcomePairCount).toBe(0);
    expect(report.releaseDecision).toBe("HOLD");
    expect(report.reasons).toContain("real_outcome_evidence_missing");
  });

  it("rejects mixed versions instead of aggregating them into the candidate", () => {
    const report = service.summarize({
      manifest,
      releasePhase: "pre_release",
      trials: [
        trial({ caseId: "case-1", role: "baseline" }),
        trial({
          caseId: "case-1",
          role: "candidate",
          versions: { ...candidateVersions, schema: "schema-v2" }
        })
      ]
    });

    expect(report.pairedTrialCount).toBe(0);
    expect(report.releaseDecision).toBe("HOLD");
    expect(report.reasons).toContain("trial_version_mismatch:candidate:case-1");
  });

  it("returns GO only for paired, verified, enforce-mode real Outcome evidence", () => {
    const report = service.summarize({
      manifest,
      releasePhase: "pre_release",
      trials: [
        trial({ caseId: "case-1", role: "baseline", passed: false }),
        trial({ caseId: "case-1", role: "candidate" }),
        trial({ caseId: "case-2", role: "baseline" }),
        trial({ caseId: "case-2", role: "candidate" })
      ]
    });

    expect(report.realOutcomePairCount).toBe(2);
    expect(report.candidateOutcomeAccuracy).toBe(1);
    expect(report.pairedImprovement).toBe(0.5);
    expect(report.releaseDecision).toBe("GO");
    expect(report.reasons).toEqual([]);
  });

  it("prefers verified real Outcome receipts over the sanitized copy of the same Trial", () => {
    const report = service.summarize({
      manifest,
      releasePhase: "pre_release",
      trials: [
        trial({ caseId: "case-1", role: "baseline", trust: "sanitized" }),
        trial({ caseId: "case-1", role: "candidate", trust: "sanitized" }),
        trial({ caseId: "case-1", role: "baseline" }),
        trial({ caseId: "case-1", role: "candidate" }),
        trial({ caseId: "case-2", role: "baseline", trust: "sanitized" }),
        trial({ caseId: "case-2", role: "candidate", trust: "sanitized" }),
        trial({ caseId: "case-2", role: "baseline" }),
        trial({ caseId: "case-2", role: "candidate" })
      ]
    });

    expect(report.realOutcomePairCount).toBe(2);
    expect(report.releaseDecision).toBe("GO");
    expect(report.reasons).not.toEqual(
      expect.arrayContaining([expect.stringContaining("duplicate_trial_role")])
    );
  });

  it("rejects a prefilled pass that disagrees with execution and mandatory Oracle evidence", () => {
    const inconsistent = trial({ caseId: "case-1", role: "candidate" });
    inconsistent.payload.outcome.executionSucceeded = false;

    const report = service.summarize({
      manifest,
      releasePhase: "pre_release",
      trials: [trial({ caseId: "case-1", role: "baseline" }), inconsistent]
    });

    expect(report.releaseDecision).toBe("HOLD");
    expect(report.reasons).toContain("trial_outcome_inconsistent:candidate:case-1");
  });

  it.each([
    ["unauthorizedSqlCount", { unauthorizedSqlCount: 1 }],
    ["hardGateFalsePassCount", { hardGateFalsePassCount: 1 }],
    ["outOfBoundRepairCount", { outOfBoundRepairCount: 1 }]
  ] as const)("enforces the zero-tolerance invariant for %s", (_label, safety) => {
    const trials = [
      trial({ caseId: "case-1", role: "baseline" }),
      trial({ caseId: "case-1", role: "candidate", ...safety }),
      trial({ caseId: "case-2", role: "baseline" }),
      trial({ caseId: "case-2", role: "candidate" })
    ];

    expect(
      service.summarize({ manifest, releasePhase: "pre_release", trials })
        .releaseDecision
    ).toBe("NO_GO");
    expect(
      service.summarize({ manifest, releasePhase: "canary", trials })
        .releaseDecision
    ).toBe("ROLLBACK");
  });
});
