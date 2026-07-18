import { Injectable } from "@nestjs/common";
import type { AnalysisArtifactMetadata } from "@text2sql/analysis-task-protocol";
import { DomainError } from "../../../../common/domain-error";
import { AnalysisArtifactRepository } from "../../../platform/data/persistence/analysis-artifact.repository";
import { sha256Digest, stableJson } from "../../../platform/data/persistence/analysis-ledger.util";
import { AnalysisTaskService } from "../application/analysis-task.service";
import { AnalysisWorkerRegistryService } from "../workers/worker-registry.service";
import type {
  AnalysisWorkerInvocation,
  AnalysisWorkerProposal
} from "../workers/worker-contract.types";

export type AnalysisCommitGuardDecision = {
  decision: "accepted";
  invocationId: string;
  proposalId: string;
  artifactRefs: string[];
  reasonCodes: string[];
};

@Injectable()
export class AnalysisCommitGuardService {
  constructor(
    private readonly tasks: AnalysisTaskService,
    private readonly artifacts: AnalysisArtifactRepository,
    private readonly workers: AnalysisWorkerRegistryService
  ) {}

  async commit(input: {
    actor: Express.RequestActor;
    invocation: AnalysisWorkerInvocation;
    proposal: AnalysisWorkerProposal;
  }): Promise<{
    decision: AnalysisCommitGuardDecision;
    artifacts: AnalysisArtifactMetadata[];
  }> {
    const { invocation, proposal } = input;
    const readModel = await this.tasks.get(input.actor, invocation.taskId);
    this.assertBinding(invocation, proposal);
    this.workers.assertCapabilitySubset(
      invocation.capabilityGrant,
      proposal.requestedCapabilities
    );
    const grantDigest = sha256Digest(
      stableJson({
        invocationId: invocation.invocationId,
        capabilities: [...invocation.capabilityGrant].sort()
      })
    );
    if (grantDigest !== invocation.capabilityGrantDigest) {
      throw new DomainError(
        "ANALYSIS_CAPABILITY_GRANT_DIGEST_MISMATCH",
        "Worker invocation capability grant digest 不匹配。",
        409
      );
    }
    if (
      readModel.currentRevision.id !== invocation.revisionId ||
      readModel.task.authorityEpoch !== invocation.authorityEpoch
    ) {
      throw new DomainError(
        "ANALYSIS_COMMIT_AUTHORITY_STALE",
        "Worker proposal 已跨 Revision 或 authority epoch。",
        409
      );
    }
    const attempt = readModel.attempts.find(
      (item) => item.id === invocation.attemptId
    );
    if (
      !attempt ||
      attempt.revisionId !== invocation.revisionId ||
      attempt.authorityEpoch !== invocation.authorityEpoch
    ) {
      throw new DomainError(
        "ANALYSIS_ATTEMPT_NOT_COMMITTABLE",
        "Worker proposal 未绑定当前 Attempt。",
        409
      );
    }
    this.assertBudget(invocation, proposal);
    for (const ref of invocation.inputArtifactRefs) {
      const artifact = readModel.artifacts.find((item) => item.id === ref.id);
      if (!artifact || artifact.payloadDigest !== ref.digest) {
        throw new DomainError(
          "ANALYSIS_INPUT_ARTIFACT_DIGEST_MISMATCH",
          "Worker 输入 Artifact 已变化或不存在。",
          409,
          { artifactId: ref.id }
        );
      }
    }
    const committed: AnalysisArtifactMetadata[] = [];
    const candidateArtifactIds = new Map(
      proposal.candidates.map((candidate) => [
        candidate.candidateId,
        workerArtifactId(proposal.proposalId, candidate.candidateId)
      ])
    );
    for (const candidate of proposal.candidates) {
      if (
        (candidate.artifactType === "analysis.sql_evidence" ||
          candidate.artifactType === "analysis.research_evidence" ||
          candidate.artifactType === "analysis.evidence") &&
        candidate.receiptStatus !== "passed"
      ) {
        throw new DomainError(
          "ANALYSIS_EVIDENCE_RECEIPT_REQUIRED",
          "Analysis Evidence 必须有通过的 accuracy/coverage Receipt。",
          409
        );
      }
      if (candidate.artifactType === "analysis.claim") {
        this.assertSupportedClaim(candidate.payload);
      }
      const allowedOutputSchemas = new Set(
        invocation.allowedOutputSchemas ?? [invocation.expectedOutputSchema]
      );
      if (
        invocation.expectedOutputSchema &&
        !allowedOutputSchemas.has(candidate.schemaVersion)
      ) {
        throw new DomainError(
          "ANALYSIS_WORKER_OUTPUT_SCHEMA_MISMATCH",
          "Worker candidate 不符合 invocation 的 expected output schema。",
          409
        );
      }
      committed.push(
        await this.artifacts.commitArtifact({
          artifactId: candidateArtifactIds.get(candidate.candidateId),
          taskId: invocation.taskId,
          revisionId: invocation.revisionId,
          attemptId: invocation.attemptId,
          authorityEpoch: invocation.authorityEpoch,
          artifactType: candidate.artifactType,
          schemaVersion: candidate.schemaVersion,
          classification: this.classification(candidate),
          visibility: this.visibility(candidate),
          completeness: candidate.completeness,
          links: [
            ...invocation.inputArtifactRefs.map((ref) => ({
              targetArtifactId: ref.id,
              relationType: "derived_from" as const
            })),
            ...(candidate.derivedFromCandidateIds ?? []).map((candidateId) => ({
              targetArtifactId:
                candidateArtifactIds.get(candidateId) ?? `missing:${candidateId}`,
              relationType: "derived_from" as const
            }))
          ].filter(
            (link, index, links) =>
              links.findIndex(
                (candidateLink) =>
                  candidateLink.targetArtifactId === link.targetArtifactId
              ) === index
          ),
          payload: {
            ...candidate.payload,
            lineage: {
              invocationId: invocation.invocationId,
              proposalId: proposal.proposalId,
              workerId: proposal.workerId,
              workerVersion: proposal.workerVersion,
              inputArtifactRefs: invocation.inputArtifactRefs,
              inputDigest: invocation.inputDigest,
              capabilityGrantDigest: invocation.capabilityGrantDigest,
              receiptRefs: candidate.receiptRefs
            }
          },
          receipt: {
            receiptType: "analysis.commit-guard.v1",
            decision: "accepted",
            reasonCodes: [
              "current_authority_verified",
              "capability_subset_verified",
              "budget_verified",
              ...candidate.reasonCodes
            ],
            principalDigest: this.tasks.principalDigest(input.actor),
            policyRefs: {
              invocationId: invocation.invocationId,
              proposalId: proposal.proposalId,
              capabilityGrantDigest: invocation.capabilityGrantDigest
            }
          }
        })
      );
    }
    return {
      decision: {
        decision: "accepted",
        invocationId: invocation.invocationId,
        proposalId: proposal.proposalId,
        artifactRefs: committed.map((artifact) => artifact.id),
        reasonCodes: ["all_commit_guard_checks_passed"]
      },
      artifacts: committed
    };
  }

  private assertBinding(
    invocation: AnalysisWorkerInvocation,
    proposal: AnalysisWorkerProposal
  ): void {
    if (
      proposal.invocationId !== invocation.invocationId ||
      proposal.taskId !== invocation.taskId ||
      proposal.revisionId !== invocation.revisionId ||
      proposal.attemptId !== invocation.attemptId ||
      proposal.authorityEpoch !== invocation.authorityEpoch ||
      proposal.inputDigest !== invocation.inputDigest
    ) {
      throw new DomainError(
        "ANALYSIS_WORKER_PROPOSAL_BINDING_MISMATCH",
        "Worker proposal 与 invocation 绑定不一致。",
        409
      );
    }
  }

  private assertBudget(
    invocation: AnalysisWorkerInvocation,
    proposal: AnalysisWorkerProposal
  ): void {
    const pairs: Array<[number, number, string]> = [
      [proposal.cost.durationMs, invocation.budgetReservation.maxDurationMs, "duration"],
      [proposal.cost.tokenCount, invocation.budgetReservation.maxTokenCount, "token"],
      [proposal.cost.queryCount, invocation.budgetReservation.maxQueryCount, "query"],
      [proposal.cost.searchCount, invocation.budgetReservation.maxSearchCount, "search"],
      [proposal.cost.artifactBytes, invocation.budgetReservation.maxArtifactBytes, "artifact"]
    ];
    const exceeded = pairs.filter(([actual, limit]) => actual > limit);
    if (exceeded.length > 0) {
      throw new DomainError(
        "ANALYSIS_WORKER_BUDGET_EXCEEDED",
        "Worker proposal 超出预留 budget。",
        409,
        { dimensions: exceeded.map(([, , dimension]) => dimension) }
      );
    }
  }

  private assertSupportedClaim(payload: Record<string, unknown>): void {
    const supporting = Array.isArray(payload.supportingEvidenceRefs)
      ? payload.supportingEvidenceRefs
      : [];
    const calculations = Array.isArray(payload.calculationRefs)
      ? payload.calculationRefs
      : [];
    if (
      payload.version !== "analysis-claim.v1" ||
      payload.strength === "unsupported" ||
      supporting.length === 0 ||
      calculations.length === 0
    ) {
      throw new DomainError(
        "ANALYSIS_UNSUPPORTED_CLAIM_REJECTED",
        "Claim 必须绑定 supporting Evidence、Calculation 且 strength 不能为 unsupported。",
        409
      );
    }
  }

  private classification(candidate: AnalysisWorkerProposal["candidates"][number]) {
    if (candidate.artifactType === "analysis.research_evidence") {
      return "public" as const;
    }
    if (candidate.artifactType === "analysis.evidence") {
      return candidate.payload.sourceKind === "web"
        ? ("public" as const)
        : ("workspace" as const);
    }
    if (
      candidate.artifactType === "analysis.sql_evidence" ||
      [
        "analysis.evidence_alignment",
        "analysis.calculation",
        "analysis.claim",
        "analysis.conflict_set",
        "analysis.report"
      ].includes(candidate.artifactType)
    ) {
      return "workspace" as const;
    }
    return "confidential" as const;
  }

  private visibility(candidate: AnalysisWorkerProposal["candidates"][number]) {
    return [
      "analysis.sql_evidence",
      "analysis.research_evidence",
      "analysis.evidence",
      "analysis.evidence_alignment",
      "analysis.calculation",
      "analysis.claim",
      "analysis.conflict_set",
      "analysis.report"
    ].includes(candidate.artifactType)
      ? ("user" as const)
      : ("internal" as const);
  }
}

export function workerArtifactId(
  proposalId: string,
  candidateId: string
): string {
  return `worker:${sha256Digest(stableJson({ proposalId, candidateId }))}`;
}
