import { Inject, Injectable } from "@nestjs/common";
import type { AnalysisCompleteness } from "@text2sql/analysis-task-protocol";
import { DomainError } from "../../../../common/domain-error";
import {
  KNOWLEDGE_RESEARCH_CONTRACT,
  type KnowledgeResearchContract
} from "../../../knowledge";
import { stableJson } from "../../../platform/data/persistence/analysis-ledger.util";
import { AnalysisTaskService } from "../application/analysis-task.service";
import type {
  AnalysisWorker,
  AnalysisWorkerInvocation,
  AnalysisWorkerProposal
} from "./worker-contract.types";

@Injectable()
export class ResearchAnalysisWorker implements AnalysisWorker {
  readonly workerId = "research.v1";
  readonly workerVersion = "1.0.0";
  readonly workKinds = ["research" as const];
  readonly capabilities = [
    "web.search" as const,
    "web.fetch" as const,
    "artifact.propose" as const
  ];

  constructor(
    private readonly tasks: AnalysisTaskService,
    @Inject(KNOWLEDGE_RESEARCH_CONTRACT)
    private readonly research: KnowledgeResearchContract
  ) {}

  async execute(
    invocation: AnalysisWorkerInvocation
  ): Promise<AnalysisWorkerProposal> {
    const startedAt = Date.now();
    try {
      const model = await this.tasks.get(invocation.actor, invocation.taskId);
      const goal = model.currentRevision.goalContract;
      if (!goal.allowedSourceKinds.includes("web")) {
        throw new DomainError(
          "RESEARCH_SOURCE_KIND_NOT_ALLOWED",
          "当前 GoalContract 未授权 web source kind。",
          403
        );
      }
      const result = await this.research.run({
        actor: invocation.actor,
        taskId: invocation.taskId,
        revisionId: invocation.revisionId,
        workspaceId: goal.workspaceId,
        question: invocation.instruction,
        decisionUse: goal.decisionUse,
        timeBoundary: goal.timeBoundary,
        stopConditions: goal.stopConditions,
        budget: {
          maxSearchCount: invocation.budgetReservation.maxSearchCount,
          maxArtifactBytes: invocation.budgetReservation.maxArtifactBytes
        }
      });
      const passed =
        result.coverage.status === "complete" ||
        result.coverage.status === "conflicted";
      const unavailable = result.coverage.stopReason === "provider_unavailable";
      const payload = {
        version: "analysis-research-evidence.v1",
        invocationId: invocation.invocationId,
        brief: result.brief,
        coverage: result.coverage,
        sourceSnapshots: result.snapshots.map((snapshot) => ({
          snapshotId: snapshot.id,
          locator: snapshot.locator,
          contentDigest: snapshot.contentDigest,
          completeness: snapshot.completeness,
          publishedAt: snapshot.publishedAt,
          retrievedAt: snapshot.retrievedAt,
          retentionExpiresAt: snapshot.retentionExpiresAt,
          injectionIndicators: snapshot.injectionIndicators
        })),
        providerRequestIds: result.providerRequestIds,
        providerAnswerAccepted: false,
        relevanceScoreAcceptedAsTruth: false,
        externalContentChannel: "untrusted_data_only"
      };
      const unresolvedGaps = result.coverage.obligations
        .filter((obligation) => obligation.status !== "passed")
        .map((obligation) => `research_coverage_${obligation.id}_${obligation.status}`);
      return this.proposal(invocation, {
        startedAt,
        artifactType:
          result.snapshots.length > 0
            ? "analysis.research_evidence"
            : "analysis.research_diagnostic",
        completeness: coverageCompleteness(result.coverage.status),
        payload,
        receiptStatus: passed ? "passed" : unavailable ? "unavailable" : "failed",
        reasonCodes: passed
          ? ["research_policy_and_coverage_verified"]
          : ["research_coverage_not_closed"],
        cost: {
          queryCount: result.queryCount,
          searchCount: result.searchCount,
          artifactBytes: result.artifactBytes
        },
        receiptRefs: [
          `policy:${result.brief.policyDigest}`,
          `connector:${result.brief.connectorConfigDigest}`,
          ...result.snapshots.map((snapshot) => `snapshot:${snapshot.id}`)
        ],
        unresolvedGaps
      });
    } catch (error) {
      if (!(error instanceof DomainError)) {
        throw error;
      }
      const reasonCode = error.code;
      const payload = {
        version: "analysis-research-evidence.v1",
        invocationId: invocation.invocationId,
        coverage: {
          status: "insufficient",
          stopReason: "provider_unavailable",
          reasonCodes: [reasonCode]
        },
        providerAnswerAccepted: false,
        relevanceScoreAcceptedAsTruth: false,
        externalContentChannel: "untrusted_data_only"
      };
      return this.proposal(invocation, {
        startedAt,
        artifactType: "analysis.research_diagnostic",
        completeness: "insufficient",
        payload,
        receiptStatus: "unavailable",
        reasonCodes: [reasonCode],
        cost: { queryCount: 0, searchCount: 0, artifactBytes: 0 },
        receiptRefs: [],
        unresolvedGaps: [reasonCode]
      });
    }
  }

  private proposal(
    invocation: AnalysisWorkerInvocation,
    input: {
      startedAt: number;
      artifactType: string;
      completeness: AnalysisCompleteness;
      payload: Record<string, unknown>;
      receiptStatus: "passed" | "failed" | "unavailable";
      reasonCodes: string[];
      cost: { queryCount: number; searchCount: number; artifactBytes: number };
      receiptRefs: string[];
      unresolvedGaps: string[];
    }
  ): AnalysisWorkerProposal {
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
      requestedCapabilities: ["web.search", "web.fetch", "artifact.propose"],
      candidates: [
        {
          candidateId: `research:${invocation.workItemId}`,
          artifactType: input.artifactType,
          schemaVersion: "analysis-research-evidence.v1",
          completeness: input.completeness,
          payload: input.payload,
          receiptStatus: input.receiptStatus,
          receiptRefs: input.receiptRefs,
          reasonCodes: input.reasonCodes
        }
      ],
      cost: {
        durationMs: Date.now() - input.startedAt,
        tokenCount: 0,
        queryCount: input.cost.queryCount,
        searchCount: input.cost.searchCount,
        artifactBytes: Math.max(
          input.cost.artifactBytes,
          Buffer.byteLength(stableJson(input.payload), "utf8")
        )
      },
      unresolvedGaps: input.unresolvedGaps
    };
  }
}

function coverageCompleteness(
  status: "complete" | "partial" | "conflicted" | "insufficient"
): AnalysisCompleteness {
  return status;
}
