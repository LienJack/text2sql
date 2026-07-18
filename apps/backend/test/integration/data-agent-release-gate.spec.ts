import {
  DATA_AGENT_EVIDENCE_COMPONENTS,
  DataAgentEvaluationService,
  type DataAgentEvidenceComponent
} from "../../src/modules/conversation/analysis/evaluation/data-agent-evaluation.service";
import {
  collectDataAgentReleaseGate,
  type CollectDataAgentReleaseGateOptions
} from "../../scripts/collect-data-agent-release-gate";

const evaluatedAt = "2026-07-17T00:00:00.000Z";
const scopeDigest = "scope-digest";

function component(
  id: DataAgentEvidenceComponent["id"],
  overrides: Partial<DataAgentEvidenceComponent> = {}
): DataAgentEvidenceComponent {
  return {
    id,
    version: "candidate-1",
    scopeDigest,
    status: "passed",
    evidenceClass:
      id === "text2sql_outcome" || id === "analyst_outcome"
        ? "signed_real"
        : "synthetic",
    observedAt: evaluatedAt,
    freshUntil: "2026-07-18T00:00:00.000Z",
    evidenceRefs: [`evidence:${id}`],
    ownerApproval: {
      ownerId: `owner:${id}`,
      approvedAt: evaluatedAt,
      approvalDigest: `approval:${id}`
    },
    ...(id === "multi_worker_paired_eval"
      ? { metrics: { pairedNetBenefit: 0 } }
      : {}),
    ...overrides
  };
}

function allComponents(): DataAgentEvidenceComponent[] {
  return DATA_AGENT_EVIDENCE_COMPONENTS.map((id) => component(id));
}

function accuracyReport(
  releaseDecision: "GO" | "HOLD" | "NO_GO" | "ROLLBACK",
  signedRealTrialCount: number
): CollectDataAgentReleaseGateOptions["text2sqlAccuracy"] {
  return {
    version: "text2sql-accuracy-gate-report/v1",
    generatedAt: evaluatedAt,
    evaluationIdentity: "accuracy-evaluation-1",
    guideline: {
      baselineId: "baseline-1",
      sourceStatus: "current",
      driftedArtifactIds: [],
      affectedRequirements: []
    },
    evidence: {
      sanitizedTrialCount: 4,
      signedRealTrialCount,
      rejectedRealTrialCount: 0,
      trials: []
    },
    summary: {
      sliceId: "slice-1",
      pairedTrialCount: 2,
      realOutcomePairCount: signedRealTrialCount / 2,
      baselineOutcomeAccuracy: 0.8,
      candidateOutcomeAccuracy: 0.9,
      candidateOutcomeAccuracyInterval: { lower: 0.8, upper: 1 },
      pairedImprovement: 0.1,
      pairedImprovementInterval: { lower: 0.01, upper: 0.2 },
      candidateLatencyP95Ms: 100,
      safety: {
        unauthorizedSqlCount: 0,
        hardGateFalsePassCount: 0,
        outOfBoundRepairCount: 0
      },
      releaseDecision,
      gatePass: releaseDecision === "GO",
      reasons: []
    },
    closeout: {
      status: "passed",
      recommendedStage: "direct_v2_go",
      rollbackSuggested: false,
      reasons: []
    },
    rollout: {
      gatePass: releaseDecision === "GO",
      releaseDecision,
      reasons: []
    }
  };
}

describe("Data Agent composite release gate", () => {
  it("keeps HOLD when synthetic gates pass but signed analyst Outcome is missing", () => {
    const report = collectDataAgentReleaseGate({
      releaseCandidate: "candidate-1",
      releasePhase: "pre_release",
      scopeDigest,
      text2sqlAccuracy: accuracyReport("GO", 4),
      components: [component("text2sql_outcome")],
      evaluatedAt
    });
    expect(report.rollout.releaseDecision).toBe("HOLD");
    expect(report.rollout.gatePass).toBe(false);
    expect(report.rollout.reasons).toContain("analyst_outcome:signed_real_evidence_required");
  });

  it("selects the single-workflow topology when paired multi-worker benefit is absent", () => {
    const report = new DataAgentEvaluationService().evaluate({
      releaseCandidate: "candidate-1",
      releasePhase: "pre_release",
      scopeDigest,
      components: allComponents(),
      evaluatedAt
    });
    expect(report.rollout.releaseDecision).toBe("GO");
    expect(report.topology).toEqual({
      mode: "single_workflow",
      reasonCode: "single_workflow_safe_default"
    });
  });

  it("returns NO_GO before release and ROLLBACK online for a safety invariant failure", () => {
    const components = allComponents().map((item) =>
      item.id === "cost_safety"
        ? component("cost_safety", {
            status: "failed",
            metrics: { safetyInvariantFailures: 1 }
          })
        : item
    );
    const service = new DataAgentEvaluationService();
    expect(
      service.evaluate({ releaseCandidate: "candidate-1", releasePhase: "pre_release", scopeDigest, components, evaluatedAt }).rollout.releaseDecision
    ).toBe("NO_GO");
    expect(
      service.evaluate({ releaseCandidate: "candidate-1", releasePhase: "online", scopeDigest, components, evaluatedAt }).rollout.releaseDecision
    ).toBe("ROLLBACK");
  });

  it("holds stale evidence even when every component claims passed", () => {
    const components = allComponents().map((item) =>
      item.id === "durability_recovery"
        ? component("durability_recovery", { freshUntil: "2026-07-16T00:00:00.000Z" })
        : item
    );
    const report = new DataAgentEvaluationService().evaluate({
      releaseCandidate: "candidate-1",
      releasePhase: "pre_release",
      scopeDigest,
      components,
      evaluatedAt
    });
    expect(report.rollout.releaseDecision).toBe("HOLD");
    expect(report.rollout.reasons).toContain("durability_recovery:evidence_stale");
  });
});
