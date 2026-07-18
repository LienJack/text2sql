import { Injectable } from "@nestjs/common";
import type {
  KnowledgeAssetEvaluationV1,
  KnowledgeAssetStatus
} from "@text2sql/shared-types";

export interface KnowledgePromotionEvidenceInput {
  independentEvidenceRefs?: string[];
  regressionReceiptRefs?: string[];
  pairedEvaluationRefs?: string[];
  canaryReceiptRefs?: string[];
  approvalDecisionRef?: string;
  requestedCapabilities?: string[];
  invocationGrant?: string[];
  riskTags?: string[];
  rollbackRef?: string;
}

export interface KnowledgePromotionDecision {
  fromStatus: KnowledgeAssetStatus;
  evaluatedFromStatus: Exclude<KnowledgeAssetStatus, "held">;
  targetStatus: KnowledgeAssetStatus;
  nextStatus: KnowledgeAssetStatus;
  accepted: boolean;
  reasonCodes: string[];
  evaluation: KnowledgeAssetEvaluationV1;
  rollbackRef?: string;
}

const NEXT_STATUS: Partial<
  Record<Exclude<KnowledgeAssetStatus, "held">, KnowledgeAssetStatus>
> = {
  candidate: "verified",
  verified: "shadow",
  shadow: "canary",
  canary: "active"
};

@Injectable()
export class KnowledgePromotionPolicy {
  evaluate(input: {
    status: KnowledgeAssetStatus;
    currentEvaluation: KnowledgeAssetEvaluationV1;
    evidence: KnowledgePromotionEvidenceInput;
  }): KnowledgePromotionDecision {
    const evaluatedFromStatus = this.evaluatedFrom(
      input.status,
      input.currentEvaluation
    );
    const targetStatus = NEXT_STATUS[evaluatedFromStatus];
    if (!targetStatus) {
      return this.decision(input, evaluatedFromStatus, input.status, false, [
        "knowledge_asset_status_not_promotable"
      ]);
    }

    const evaluation = this.mergeEvaluation(
      input.currentEvaluation,
      input.evidence
    );
    const reasonCodes = this.requirements(
      evaluatedFromStatus,
      evaluation,
      input.evidence.rollbackRef
    );
    if (reasonCodes.length > 0) {
      return {
        fromStatus: input.status,
        evaluatedFromStatus,
        targetStatus,
        nextStatus: "held",
        accepted: false,
        reasonCodes,
        evaluation: {
          ...evaluation,
          heldFromStatus: evaluatedFromStatus,
          reasonCodes
        },
        ...(input.evidence.rollbackRef
          ? { rollbackRef: input.evidence.rollbackRef }
          : {})
      };
    }
    return {
      fromStatus: input.status,
      evaluatedFromStatus,
      targetStatus,
      nextStatus: targetStatus,
      accepted: true,
      reasonCodes: ["knowledge_promotion_requirements_passed"],
      evaluation: {
        ...evaluation,
        reasonCodes: ["knowledge_promotion_requirements_passed"]
      },
      ...(input.evidence.rollbackRef
        ? { rollbackRef: input.evidence.rollbackRef }
        : {})
    };
  }

  initialEvaluation(
    input: KnowledgePromotionEvidenceInput = {}
  ): KnowledgeAssetEvaluationV1 {
    return this.mergeEvaluation(
      {
        version: "knowledge-asset-evaluation.v1",
        independentEvidenceRefs: [],
        regressionReceiptRefs: [],
        pairedEvaluationRefs: [],
        canaryReceiptRefs: [],
        requestedCapabilities: [],
        invocationGrant: [],
        riskTags: [],
        reasonCodes: ["candidate_only"]
      },
      input
    );
  }

  private evaluatedFrom(
    status: KnowledgeAssetStatus,
    evaluation: KnowledgeAssetEvaluationV1
  ): Exclude<KnowledgeAssetStatus, "held"> {
    if (status === "held") {
      return evaluation.heldFromStatus ?? "candidate";
    }
    return status;
  }

  private requirements(
    status: Exclude<KnowledgeAssetStatus, "held">,
    evaluation: KnowledgeAssetEvaluationV1,
    rollbackRef?: string
  ): string[] {
    const reasons: string[] = [];
    if (evaluation.riskTags.length > 0) {
      reasons.push("knowledge_asset_risk_requires_review");
    }
    if (
      !evaluation.requestedCapabilities.every((capability) =>
        evaluation.invocationGrant.includes(capability)
      )
    ) {
      reasons.push("capability_ceiling_exceeds_grant");
    }
    if (status === "candidate") {
      if (new Set(evaluation.independentEvidenceRefs).size < 2) {
        reasons.push("independent_evidence_required");
      }
      if (!evaluation.approvalDecisionRef) {
        reasons.push("governance_approval_required");
      }
    }
    if (status === "verified" && evaluation.regressionReceiptRefs.length === 0) {
      reasons.push("regression_evidence_required");
    }
    if (status === "shadow") {
      if (evaluation.pairedEvaluationRefs.length === 0) {
        reasons.push("paired_evaluation_required");
      }
      if (!rollbackRef) {
        reasons.push("rollback_pointer_required");
      }
    }
    if (status === "canary") {
      if (evaluation.canaryReceiptRefs.length === 0) {
        reasons.push("canary_evidence_required");
      }
      if (!evaluation.approvalDecisionRef) {
        reasons.push("governance_approval_required");
      }
      if (!rollbackRef) {
        reasons.push("rollback_pointer_required");
      }
    }
    return [...new Set(reasons)].sort();
  }

  private mergeEvaluation(
    current: KnowledgeAssetEvaluationV1,
    input: KnowledgePromotionEvidenceInput
  ): KnowledgeAssetEvaluationV1 {
    return {
      version: "knowledge-asset-evaluation.v1",
      independentEvidenceRefs: unique([
        ...current.independentEvidenceRefs,
        ...(input.independentEvidenceRefs ?? [])
      ]),
      regressionReceiptRefs: unique([
        ...current.regressionReceiptRefs,
        ...(input.regressionReceiptRefs ?? [])
      ]),
      pairedEvaluationRefs: unique([
        ...current.pairedEvaluationRefs,
        ...(input.pairedEvaluationRefs ?? [])
      ]),
      canaryReceiptRefs: unique([
        ...current.canaryReceiptRefs,
        ...(input.canaryReceiptRefs ?? [])
      ]),
      ...(input.approvalDecisionRef ?? current.approvalDecisionRef
        ? {
            approvalDecisionRef:
              input.approvalDecisionRef ?? current.approvalDecisionRef
          }
        : {}),
      requestedCapabilities: unique([
        ...current.requestedCapabilities,
        ...(input.requestedCapabilities ?? [])
      ]),
      invocationGrant: unique([
        ...current.invocationGrant,
        ...(input.invocationGrant ?? [])
      ]),
      riskTags: unique([...current.riskTags, ...(input.riskTags ?? [])]),
      ...(current.heldFromStatus
        ? { heldFromStatus: current.heldFromStatus }
        : {}),
      reasonCodes: [...current.reasonCodes]
    };
  }

  private decision(
    input: {
      status: KnowledgeAssetStatus;
      currentEvaluation: KnowledgeAssetEvaluationV1;
      evidence: KnowledgePromotionEvidenceInput;
    },
    evaluatedFromStatus: Exclude<KnowledgeAssetStatus, "held">,
    targetStatus: KnowledgeAssetStatus,
    accepted: boolean,
    reasonCodes: string[]
  ): KnowledgePromotionDecision {
    return {
      fromStatus: input.status,
      evaluatedFromStatus,
      targetStatus,
      nextStatus: input.status,
      accepted,
      reasonCodes,
      evaluation: {
        ...this.mergeEvaluation(input.currentEvaluation, input.evidence),
        reasonCodes
      }
    };
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()).map((value) => value.trim()))].sort();
}
