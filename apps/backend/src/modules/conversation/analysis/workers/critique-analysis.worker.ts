import { Injectable } from "@nestjs/common";
import { stableJson } from "../../../platform/data/persistence/analysis-ledger.util";
import type {
  AnalysisWorker,
  AnalysisWorkerInvocation,
  AnalysisWorkerProposal
} from "./worker-contract.types";

@Injectable()
export class CritiqueAnalysisWorker implements AnalysisWorker {
  readonly workerId = "critique.v1";
  readonly workerVersion = "1.0.0";
  readonly workKinds = ["critique" as const];
  readonly capabilities = ["artifact.read" as const, "artifact.propose" as const, "claim.challenge" as const];

  async execute(
    invocation: AnalysisWorkerInvocation
  ): Promise<AnalysisWorkerProposal> {
    const payload = {
      version: "analysis-critique.v1",
      invocationId: invocation.invocationId,
      inputArtifactRefs: invocation.inputArtifactRefs,
      challenges: [
        "是否存在口径变化而非真实业务变化？",
        "分段贡献是否被总体平均掩盖？",
        "当前证据是否覆盖反例、滞后效应和外部事件？"
      ],
      directClaimMutationAllowed: false,
      confidenceUpgradeAllowed: false
    };
    return {
      proposalId: `proposal:${invocation.invocationId}`,
      invocationId: invocation.invocationId,
      workerId: this.workerId,
      workerVersion: this.workerVersion,
      taskId: invocation.taskId,
      revisionId: invocation.revisionId,
      attemptId: invocation.attemptId,
      authorityEpoch: invocation.authorityEpoch,
      inputDigest: invocation.inputDigest,
      requestedCapabilities: [
        "artifact.read",
        "artifact.propose",
        "claim.challenge"
      ],
      candidates: [
        {
          candidateId: `critique:${invocation.workItemId}`,
          artifactType: "analysis.critique",
          schemaVersion: "analysis-critique.v1",
          completeness: "partial",
          payload,
          receiptStatus: "passed",
          receiptRefs: [],
          reasonCodes: ["challenge_only_no_claim_mutation"]
        }
      ],
      cost: {
        durationMs: 0,
        tokenCount: 0,
        queryCount: 0,
        searchCount: 0,
        artifactBytes: Buffer.byteLength(stableJson(payload), "utf8")
      },
      unresolvedGaps: ["critique_requires_evidence_resolution"]
    };
  }
}
