import { Injectable } from "@nestjs/common";
import type {
  AnalysisClaimV1,
  AnalysisConflictSetV1
} from "@text2sql/shared-types";
import { DomainError } from "../../../../common/domain-error";
import { AnalysisArtifactRepository } from "../../../platform/data/persistence/analysis-artifact.repository";
import { stableJson } from "../../../platform/data/persistence/analysis-ledger.util";
import { AnalysisReportProjectorService } from "../evidence/analysis-report-projector.service";
import type {
  AnalysisWorker,
  AnalysisWorkerCandidate,
  AnalysisWorkerInvocation,
  AnalysisWorkerProposal
} from "./worker-contract.types";

@Injectable()
export class ReportAnalysisWorker implements AnalysisWorker {
  readonly workerId = "report.v1";
  readonly workerVersion = "1.0.0";
  readonly workKinds = ["report" as const];
  readonly capabilities = ["artifact.read" as const, "artifact.propose" as const];

  constructor(
    private readonly artifacts: AnalysisArtifactRepository,
    private readonly projector: AnalysisReportProjectorService
  ) {}

  async execute(
    invocation: AnalysisWorkerInvocation
  ): Promise<AnalysisWorkerProposal> {
    const startedAt = Date.now();
    try {
      const claims: Array<{ artifactRef: string; claim: AnalysisClaimV1 }> = [];
      const conflicts: Array<{
        artifactRef: string;
        conflict: AnalysisConflictSetV1;
      }> = [];
      for (const ref of invocation.inputArtifactRefs) {
        const artifact = await this.artifacts.readCommittedPayload(
          invocation.taskId,
          ref.id
        );
        if (
          artifact.artifactType === "analysis.claim" &&
          artifact.payload.version === "analysis-claim.v1"
        ) {
          claims.push({
            artifactRef: artifact.id,
            claim: artifact.payload as unknown as AnalysisClaimV1
          });
        }
        if (
          artifact.artifactType === "analysis.conflict_set" &&
          artifact.payload.version === "analysis-conflict-set.v1"
        ) {
          conflicts.push({
            artifactRef: artifact.id,
            conflict: artifact.payload as unknown as AnalysisConflictSetV1
          });
        }
      }
      const report = this.projector.project({
        title: invocation.instruction,
        claims,
        conflicts,
        limitations: invocation.inputArtifactRefs.length === 0
          ? ["没有可投影的 Artifact。"]
          : []
      });
      return proposal(invocation, {
        startedAt,
        candidates: [
          {
            candidateId: `report:${invocation.workItemId}`,
            artifactType: "analysis.report",
            schemaVersion: "analysis-report.v1",
            completeness: conflicts.some(
              ({ conflict }) => conflict.status === "unresolved"
            )
              ? "conflicted"
              : "complete",
            payload: report as unknown as Record<string, unknown>,
            receiptStatus: "passed",
            receiptRefs: claims.map(({ artifactRef }) => artifactRef),
            reasonCodes: ["report_projected_from_committed_claims_only"]
          }
        ],
        unresolvedGaps: report.limitations
      });
    } catch (error) {
      if (!(error instanceof DomainError)) {
        throw error;
      }
      return proposal(invocation, {
        startedAt,
        candidates: [
          {
            candidateId: `report:${invocation.workItemId}`,
            artifactType: "analysis.report_diagnostic",
            schemaVersion: "analysis-report.v1",
            completeness: "insufficient",
            payload: {
              version: "analysis-report.v1",
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
}

function proposal(
  invocation: AnalysisWorkerInvocation,
  input: {
    startedAt: number;
    candidates: AnalysisWorkerCandidate[];
    unresolvedGaps: string[];
  }
): AnalysisWorkerProposal {
  return {
    proposalId: `proposal:${invocation.invocationId}`,
    invocationId: invocation.invocationId,
    workerId: "report.v1",
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
