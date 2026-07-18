import { Injectable } from "@nestjs/common";
import type {
  Text2SqlAccuracyReleaseDecision,
  Text2SqlAccuracyReleasePhase
} from "../../runtime/evaluation/text2sql-accuracy-evaluation.service";

export const DATA_AGENT_EVIDENCE_COMPONENTS = [
  "identity_authorization",
  "durability_recovery",
  "deep_search_coverage",
  "evidence_claim_integrity",
  "knowledge_asset_governance",
  "multi_worker_paired_eval",
  "cost_safety",
  "text2sql_outcome",
  "analyst_outcome"
] as const;

export type DataAgentEvidenceComponentId =
  (typeof DATA_AGENT_EVIDENCE_COMPONENTS)[number];
export type DataAgentEvidenceStatus = "passed" | "failed" | "unknown" | "stale";
export type DataAgentReleaseDecision = Text2SqlAccuracyReleaseDecision;

export interface DataAgentEvidenceComponent {
  id: DataAgentEvidenceComponentId;
  version: string;
  scopeDigest: string;
  status: DataAgentEvidenceStatus;
  evidenceClass: "synthetic" | "signed_real";
  observedAt: string;
  freshUntil: string;
  evidenceRefs: string[];
  ownerApproval?: {
    ownerId: string;
    approvedAt: string;
    approvalDigest: string;
  };
  metrics?: {
    pairedNetBenefit?: number;
    safetyInvariantFailures?: number;
    analystOutcomeCount?: number;
  };
}

export interface DataAgentReleaseManifest {
  version: "data-agent-release-manifest/v1";
  releaseCandidate: string;
  releasePhase: Text2SqlAccuracyReleasePhase;
  scopeDigest: string;
  evaluatedAt: string;
  components: DataAgentEvidenceComponent[];
  topology: {
    mode: "single_workflow" | "multi_worker";
    reasonCode: string;
  };
  rollout: {
    gatePass: boolean;
    releaseDecision: DataAgentReleaseDecision;
    recommendedStage: "shadow" | "canary" | "go" | "hold" | "rollback";
    reasons: string[];
  };
}

@Injectable()
export class DataAgentEvaluationService {
  evaluate(input: {
    releaseCandidate: string;
    releasePhase: Text2SqlAccuracyReleasePhase;
    scopeDigest: string;
    components: DataAgentEvidenceComponent[];
    evaluatedAt?: string;
  }): DataAgentReleaseManifest {
    const evaluatedAt = input.evaluatedAt ?? new Date().toISOString();
    const now = Date.parse(evaluatedAt);
    const reasons: string[] = [];
    const byId = new Map(input.components.map((component) => [component.id, component]));
    const components = DATA_AGENT_EVIDENCE_COMPONENTS.map((id) => {
      const component = byId.get(id) ?? this.missingComponent(id, input.scopeDigest, evaluatedAt);
      return this.validateComponent(component, input.scopeDigest, now, reasons);
    });

    for (const outcomeId of ["text2sql_outcome", "analyst_outcome"] as const) {
      const outcome = components.find((component) => component.id === outcomeId)!;
      if (outcome.evidenceClass !== "signed_real") {
        reasons.push(`${outcomeId}:signed_real_evidence_required`);
      }
      if (!outcome.ownerApproval) {
        reasons.push(`${outcomeId}:owner_approval_required`);
      }
    }

    const safety = components.find((component) => component.id === "cost_safety")!;
    const safetyFailed =
      safety.status === "failed" ||
      (safety.metrics?.safetyInvariantFailures ?? 0) > 0;
    const failed = components.some((component) => component.status === "failed");
    const incomplete = components.some((component) =>
      component.status === "unknown" || component.status === "stale"
    );
    let releaseDecision: DataAgentReleaseDecision;
    if (safetyFailed) {
      reasons.push("safety_invariant_failed");
      releaseDecision = input.releasePhase === "pre_release" ? "NO_GO" : "ROLLBACK";
    } else if (failed) {
      reasons.push("required_component_failed");
      releaseDecision = "NO_GO";
    } else if (incomplete || reasons.length > 0) {
      releaseDecision = "HOLD";
    } else {
      releaseDecision = "GO";
    }

    const multiWorker = components.find(
      (component) => component.id === "multi_worker_paired_eval"
    )!;
    const pairedNetBenefit = multiWorker.metrics?.pairedNetBenefit ?? 0;
    const multiWorkerEnabled =
      multiWorker.status === "passed" && pairedNetBenefit > 0;
    if (!multiWorkerEnabled) reasons.push("multi_worker_no_paired_net_benefit");

    return {
      version: "data-agent-release-manifest/v1",
      releaseCandidate: input.releaseCandidate,
      releasePhase: input.releasePhase,
      scopeDigest: input.scopeDigest,
      evaluatedAt,
      components,
      topology: {
        mode: multiWorkerEnabled ? "multi_worker" : "single_workflow",
        reasonCode: multiWorkerEnabled
          ? "paired_net_benefit_verified"
          : "single_workflow_safe_default"
      },
      rollout: {
        gatePass: releaseDecision === "GO",
        releaseDecision,
        recommendedStage:
          releaseDecision === "GO"
            ? input.releasePhase === "pre_release"
              ? "canary"
              : "go"
            : releaseDecision === "ROLLBACK"
              ? "rollback"
              : releaseDecision === "HOLD"
                ? "hold"
                : "shadow",
        reasons: [...new Set(reasons)].sort()
      }
    };
  }

  private validateComponent(
    component: DataAgentEvidenceComponent,
    expectedScopeDigest: string,
    now: number,
    reasons: string[]
  ): DataAgentEvidenceComponent {
    let status = component.status;
    if (!component.version.trim()) {
      reasons.push(`${component.id}:version_missing`);
      status = "unknown";
    }
    if (component.scopeDigest !== expectedScopeDigest) {
      reasons.push(`${component.id}:scope_mismatch`);
      status = "unknown";
    }
    if (component.evidenceRefs.length === 0) {
      reasons.push(`${component.id}:evidence_refs_missing`);
      status = "unknown";
    }
    if (!component.ownerApproval) {
      reasons.push(`${component.id}:owner_approval_missing`);
      status = status === "failed" ? "failed" : "unknown";
    }
    const freshUntil = Date.parse(component.freshUntil);
    const observedAt = Date.parse(component.observedAt);
    if (!Number.isFinite(freshUntil) || !Number.isFinite(observedAt)) {
      reasons.push(`${component.id}:freshness_invalid`);
      status = "unknown";
    } else if (freshUntil < now || observedAt > now) {
      reasons.push(`${component.id}:evidence_stale`);
      status = "stale";
    }
    if (status !== "passed") reasons.push(`${component.id}:${status}`);
    return { ...component, status };
  }

  private missingComponent(
    id: DataAgentEvidenceComponentId,
    scopeDigest: string,
    evaluatedAt: string
  ): DataAgentEvidenceComponent {
    return {
      id,
      version: "unknown",
      scopeDigest,
      status: "unknown",
      evidenceClass: "synthetic",
      observedAt: evaluatedAt,
      freshUntil: evaluatedAt,
      evidenceRefs: []
    };
  }
}
