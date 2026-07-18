import { Injectable } from "@nestjs/common";
import type {
  AnalysisEvidenceAlignmentV1,
  AnalysisCalculationContractV1
} from "@text2sql/shared-types";
import { DomainError } from "../../../../common/domain-error";
import { AnalysisArtifactRepository } from "../../../platform/data/persistence/analysis-artifact.repository";
import { stableJson } from "../../../platform/data/persistence/analysis-ledger.util";
import { ClaimCommitService } from "../evidence/claim-commit.service";
import { DeterministicCalculationService } from "../evidence/deterministic-calculation.service";
import { workerArtifactId } from "../orchestration/analysis-commit-guard.service";
import type {
  AnalysisWorker,
  AnalysisWorkerCandidate,
  AnalysisWorkerInvocation,
  AnalysisWorkerProposal
} from "./worker-contract.types";

@Injectable()
export class CalculationAnalysisWorker implements AnalysisWorker {
  readonly workerId = "calculation.v1";
  readonly workerVersion = "1.0.0";
  readonly workKinds = ["calculation" as const];
  readonly capabilities = [
    "artifact.read" as const,
    "artifact.propose" as const,
    "calculation.execute" as const
  ];

  constructor(
    private readonly artifacts: AnalysisArtifactRepository,
    private readonly calculations: DeterministicCalculationService,
    private readonly claims: ClaimCommitService
  ) {}

  async execute(
    invocation: AnalysisWorkerInvocation
  ): Promise<AnalysisWorkerProposal> {
    const startedAt = Date.now();
    const proposalId = `proposal:${invocation.invocationId}`;
    try {
      const alignmentArtifact = await this.requireAlignmentArtifact(invocation);
      const alignment = alignmentArtifact.payload as unknown as AnalysisEvidenceAlignmentV1;
      if (
        alignment.version !== "analysis-evidence-alignment.v1" ||
        !alignment.closed ||
        !alignment.calculationContract
      ) {
        throw new DomainError(
          "ANALYSIS_CALCULATION_CONTRACT_REQUIRED",
          "Calculation 需要 closed alignment 与显式 operator contract。",
          409
        );
      }
      const contract = alignment.calculationContract as AnalysisCalculationContractV1;
      const calculation = this.calculations.execute(contract);
      const calculationCandidateId = `calculation:${invocation.workItemId}`;
      const calculationRef = workerArtifactId(proposalId, calculationCandidateId);
      const claim = this.claims.build({
        kind: "fact",
        statement: `确定性计算 ${contract.operator} 的结果为 ${calculation.output.value}${
          calculation.output.unit ?? ""
        }。`,
        calculation,
        calculationRef,
        alignment,
        alignmentRef: alignmentArtifact.id,
        scope: invocation.instruction
      });
      const claimCandidateId = `claim:${claim.claimId}`;
      const candidates: AnalysisWorkerCandidate[] = [
        {
          candidateId: calculationCandidateId,
          artifactType: "analysis.calculation",
          schemaVersion: "analysis-calculation.v1",
          completeness: "complete",
          payload: calculation as unknown as Record<string, unknown>,
          receiptStatus: "passed",
          receiptRefs: contract.inputs.map(
            (input) => `evidence:${input.evidenceRef}`
          ),
          reasonCodes: ["deterministic_operator_recomputed"]
        },
        {
          candidateId: claimCandidateId,
          artifactType: "analysis.claim",
          schemaVersion: "analysis-claim.v1",
          completeness: "complete",
          payload: claim as unknown as Record<string, unknown>,
          receiptStatus: "passed",
          receiptRefs: [calculation.outputDigest],
          reasonCodes: ["claim_supported_by_alignment_and_calculation"],
          derivedFromCandidateIds: [calculationCandidateId]
        }
      ];
      return proposal(invocation, {
        proposalId,
        startedAt,
        candidates,
        unresolvedGaps: []
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
            candidateId: `calculation:${invocation.workItemId}`,
            artifactType: "analysis.calculation_diagnostic",
            schemaVersion: "analysis-calculation.v1",
            completeness: "insufficient",
            payload: {
              version: "analysis-calculation.v1",
              recomputable: false,
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

  private async requireAlignmentArtifact(
    invocation: AnalysisWorkerInvocation
  ) {
    for (const ref of [...invocation.inputArtifactRefs].reverse()) {
      const artifact = await this.artifacts.readCommittedPayload(
        invocation.taskId,
        ref.id
      );
      if (artifact.artifactType === "analysis.evidence_alignment") {
        return artifact;
      }
    }
    throw new DomainError(
      "ANALYSIS_EVIDENCE_ALIGNMENT_REQUIRED",
      "Calculation Worker 未找到 committed evidence alignment。",
      409
    );
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
    workerId: "calculation.v1",
    workerVersion: "1.0.0",
    taskId: invocation.taskId,
    revisionId: invocation.revisionId,
    attemptId: invocation.attemptId,
    authorityEpoch: invocation.authorityEpoch,
    inputDigest: invocation.inputDigest,
    requestedCapabilities: [
      "artifact.read",
      "artifact.propose",
      "calculation.execute"
    ],
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
