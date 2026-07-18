import { Injectable } from "@nestjs/common";
import type {
  AnalysisConflictSetV1,
  AnalysisEvidenceV1
} from "@text2sql/shared-types";
import { DomainError } from "../../../../common/domain-error";
import { AnalysisArtifactRepository } from "../../../platform/data/persistence/analysis-artifact.repository";
import { stableJson } from "../../../platform/data/persistence/analysis-ledger.util";
import { AlignmentObligationService } from "../evidence/alignment-obligation.service";
import { ConflictSetService } from "../evidence/conflict-set.service";
import { EvidenceNormalizerService } from "../evidence/evidence-normalizer.service";
import { workerArtifactId } from "../orchestration/analysis-commit-guard.service";
import type {
  AnalysisWorker,
  AnalysisWorkerCandidate,
  AnalysisWorkerInvocation,
  AnalysisWorkerProposal
} from "./worker-contract.types";

@Injectable()
export class EvidenceAlignmentWorker implements AnalysisWorker {
  readonly workerId = "evidence-alignment.v1";
  readonly workerVersion = "1.0.0";
  readonly workKinds = ["evidence_alignment" as const];
  readonly capabilities = ["artifact.read" as const, "artifact.propose" as const];

  constructor(
    private readonly artifacts: AnalysisArtifactRepository,
    private readonly normalizer: EvidenceNormalizerService,
    private readonly alignment: AlignmentObligationService,
    private readonly conflicts: ConflictSetService
  ) {}

  async execute(
    invocation: AnalysisWorkerInvocation
  ): Promise<AnalysisWorkerProposal> {
    const startedAt = Date.now();
    const proposalId = `proposal:${invocation.invocationId}`;
    try {
      const evidence: AnalysisEvidenceV1[] = [];
      const evidenceCandidates: AnalysisWorkerCandidate[] = [];
      for (const ref of invocation.inputArtifactRefs) {
        const artifact = await this.artifacts.readCommittedPayload(
          invocation.taskId,
          ref.id
        );
        for (const normalized of this.normalizer.normalize(artifact)) {
          const candidateId = `evidence:${normalized.evidenceId}`;
          const canonicalRef = workerArtifactId(proposalId, candidateId);
          const bound: AnalysisEvidenceV1 = {
            ...normalized,
            evidenceId: canonicalRef
          };
          if (bound.calculationHint) {
            bound.calculationHint = {
              ...bound.calculationHint,
              inputs: bound.calculationHint.inputs.map((input) => ({
                ...input,
                evidenceRef:
                  input.evidenceRef === "self" ? canonicalRef : input.evidenceRef
              }))
            };
          }
          evidence.push(bound);
          evidenceCandidates.push({
            candidateId,
            artifactType: "analysis.evidence",
            schemaVersion: "analysis-evidence.v1",
            completeness: bound.completeness,
            payload: bound as unknown as Record<string, unknown>,
            receiptStatus: "passed",
            receiptRefs: [
              ...bound.authorization.receiptRefs,
              ...bound.authorization.policyRefs
            ],
            reasonCodes: ["source_artifact_normalized_and_verified"]
          });
        }
      }
      if (evidence.length === 0) {
        throw new DomainError(
          "ANALYSIS_NORMALIZED_EVIDENCE_REQUIRED",
          "Alignment Worker 没有可验证的 SQL/Research Evidence。",
          409
        );
      }
      const conflicts = this.conflicts.detect(evidence);
      const conflictCandidates = conflicts.map((conflict) =>
        this.conflictCandidate(conflict, evidenceCandidates)
      );
      const result = this.alignment.evaluate({ evidence, conflicts });
      const alignmentCandidateId = `alignment:${invocation.workItemId}`;
      const candidates: AnalysisWorkerCandidate[] = [
        ...evidenceCandidates,
        ...conflictCandidates,
        {
          candidateId: alignmentCandidateId,
          artifactType: result.closed
            ? "analysis.evidence_alignment"
            : "analysis.evidence_alignment_diagnostic",
          schemaVersion: "analysis-evidence-alignment.v1",
          completeness: result.closed
            ? conflicts.length > 0
              ? "conflicted"
              : "complete"
            : "insufficient",
          payload: result as unknown as Record<string, unknown>,
          receiptStatus: result.closed ? "passed" : "failed",
          receiptRefs: [],
          reasonCodes: result.closed
            ? ["all_alignment_obligations_closed"]
            : ["alignment_obligations_unresolved"],
          derivedFromCandidateIds: [
            ...evidenceCandidates.map((candidate) => candidate.candidateId),
            ...conflictCandidates.map((candidate) => candidate.candidateId)
          ]
        }
      ];
      return proposal(invocation, {
        proposalId,
        startedAt,
        candidates,
        unresolvedGaps: result.closed
          ? []
          : result.unresolvedDimensions.map(
              (dimension) => `alignment_${dimension}_unresolved`
            )
      });
    } catch (error) {
      if (!(error instanceof DomainError)) {
        throw error;
      }
      return proposal(invocation, {
        proposalId,
        startedAt,
        candidates: [
          {
            candidateId: `alignment:${invocation.workItemId}`,
            artifactType: "analysis.evidence_alignment_diagnostic",
            schemaVersion: "analysis-evidence-alignment.v1",
            completeness: "insufficient",
            payload: {
              version: "analysis-evidence-alignment.v1",
              closed: false,
              reasonCodes: [error.code]
            },
            receiptStatus: "failed",
            receiptRefs: [],
            reasonCodes: [error.code]
          }
        ],
        unresolvedGaps: [error.code]
      });
    }
  }

  private conflictCandidate(
    conflict: AnalysisConflictSetV1,
    evidenceCandidates: AnalysisWorkerCandidate[]
  ): AnalysisWorkerCandidate {
    return {
      candidateId: conflict.conflictId,
      artifactType: "analysis.conflict_set",
      schemaVersion: "analysis-conflict-set.v1",
      completeness: "conflicted",
      payload: conflict as unknown as Record<string, unknown>,
      receiptStatus: "passed",
      receiptRefs: [],
      reasonCodes: ["competing_evidence_preserved_without_averaging"],
      derivedFromCandidateIds: evidenceCandidates.map(
        (candidate) => candidate.candidateId
      )
    };
  }
}

function proposal(
  invocation: AnalysisWorkerInvocation,
  input: {
    proposalId: string;
    startedAt: number;
    candidates: AnalysisWorkerCandidate[];
    unresolvedGaps: string[];
  }
): AnalysisWorkerProposal {
  return {
    proposalId: input.proposalId,
    invocationId: invocation.invocationId,
    workerId: "evidence-alignment.v1",
    workerVersion: "1.0.0",
    taskId: invocation.taskId,
    revisionId: invocation.revisionId,
    attemptId: invocation.attemptId,
    authorityEpoch: invocation.authorityEpoch,
    inputDigest: invocation.inputDigest,
    requestedCapabilities: ["artifact.read", "artifact.propose"],
    candidates: input.candidates,
    cost: {
      durationMs: Date.now() - input.startedAt,
      tokenCount: 0,
      queryCount: 0,
      searchCount: 0,
      artifactBytes: Buffer.byteLength(stableJson(input.candidates), "utf8")
    },
    unresolvedGaps: input.unresolvedGaps
  };
}
