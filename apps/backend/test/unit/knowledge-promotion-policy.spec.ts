import { KnowledgePromotionPolicy } from "../../src/modules/knowledge/assets/knowledge-promotion-policy";

describe("KnowledgePromotionPolicy", () => {
  const policy = new KnowledgePromotionPolicy();

  it("keeps a single successful observation as held candidate", () => {
    const decision = policy.evaluate({
      status: "candidate",
      currentEvaluation: policy.initialEvaluation({
        independentEvidenceRefs: ["run-1"],
        requestedCapabilities: ["datasource.read"],
        invocationGrant: ["datasource.read"]
      }),
      evidence: {}
    });

    expect(decision.accepted).toBe(false);
    expect(decision.nextStatus).toBe("held");
    expect(decision.reasonCodes).toEqual(
      expect.arrayContaining([
        "independent_evidence_required",
        "governance_approval_required"
      ])
    );
  });

  it("requires capability subset and every governed promotion stage", () => {
    const held = policy.evaluate({
      status: "candidate",
      currentEvaluation: policy.initialEvaluation(),
      evidence: {
        independentEvidenceRefs: ["run-1", "run-2"],
        approvalDecisionRef: "decision-1",
        requestedCapabilities: ["web.fetch"],
        invocationGrant: ["artifact.read"]
      }
    });
    expect(held.reasonCodes).toContain("capability_ceiling_exceeds_grant");

    const verified = policy.evaluate({
      status: "held",
      currentEvaluation: held.evaluation,
      evidence: { invocationGrant: ["web.fetch"] }
    });
    expect(verified.nextStatus).toBe("verified");
    expect(verified.accepted).toBe(true);

    const shadow = policy.evaluate({
      status: "verified",
      currentEvaluation: verified.evaluation,
      evidence: { regressionReceiptRefs: ["regression-1"] }
    });
    expect(shadow.nextStatus).toBe("shadow");

    const canary = policy.evaluate({
      status: "shadow",
      currentEvaluation: shadow.evaluation,
      evidence: {
        pairedEvaluationRefs: ["paired-1"],
        rollbackRef: "release:stable-v1"
      }
    });
    expect(canary.nextStatus).toBe("canary");

    const active = policy.evaluate({
      status: "canary",
      currentEvaluation: canary.evaluation,
      evidence: {
        canaryReceiptRefs: ["canary-1"],
        approvalDecisionRef: "decision-2",
        rollbackRef: "release:stable-v1"
      }
    });
    expect(active.nextStatus).toBe("active");
    expect(active.accepted).toBe(true);
  });
});
