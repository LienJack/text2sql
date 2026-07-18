import { Injectable } from "@nestjs/common";
import type { Text2SqlAccuracyEvidenceV1 } from "@text2sql/shared-types";
import { DomainError } from "../../../../common/domain-error";
import { sha256Digest, stableJson } from "../../../platform/data/persistence/analysis-ledger.util";
import { Text2SQLWorkflowRunner } from "../../application/workflow/text2sql-workflow-runner.service";
import { SessionLifecycleUsecase } from "../../chat/application/session-lifecycle.usecase";
import type {
  AnalysisWorker,
  AnalysisWorkerInvocation,
  AnalysisWorkerProposal
} from "./worker-contract.types";

@Injectable()
export class Text2SqlAnalysisWorker implements AnalysisWorker {
  readonly workerId = "text2sql.v1";
  readonly workerVersion = "1.0.0";
  readonly workKinds = ["text2sql" as const];
  readonly capabilities = ["datasource.read" as const, "artifact.propose" as const];

  constructor(
    private readonly sessions: SessionLifecycleUsecase,
    private readonly workflow: Text2SQLWorkflowRunner
  ) {}

  async execute(
    invocation: AnalysisWorkerInvocation
  ): Promise<AnalysisWorkerProposal> {
    if (!invocation.datasourceId) {
      throw new DomainError(
        "ANALYSIS_DATASOURCE_REQUIRED",
        "Text2SQL Worker 需要 datasourceId。",
        400
      );
    }
    const startedAt = Date.now();
    const session = await this.sessions.createSession(invocation.datasourceId, undefined, {
      workspaceId: invocation.actor.principal?.requestedWorkspaceId,
      createdByUserId: invocation.actor.id,
      actor: invocation.actor,
      origin: "analysis",
      analysisTaskId: invocation.taskId
    });
    const run = await this.workflow.runSync({
      sessionId: session.id,
      message: invocation.instruction,
      requestId: invocation.invocationId,
      actor: invocation.actor
    });
    const accuracy = run.trace.v2?.accuracy;
    const receiptStatus = this.receiptStatus(run.status, accuracy);
    const receiptRefs = this.receiptRefs(accuracy);
    const payload = {
      version: "analysis-sql-evidence.v1",
      invocationId: invocation.invocationId,
      runId: run.runId,
      sessionId: run.sessionId,
      datasourceId: invocation.datasourceId,
      question: run.question,
      status: run.status,
      sql: run.sql ?? null,
      explanation: run.explanation ?? null,
      answer: run.answer ?? null,
      columns: run.columns ?? [],
      rowCount: run.rows?.length ?? 0,
      rowsPreview: (run.rows ?? []).slice(0, 100),
      accuracy: accuracy
        ? {
            mode: accuracy.mode ?? null,
            queryContractDigest: accuracy.queryContract?.digest ?? null,
            executionStatus: accuracy.executionReceipt?.status ?? null,
            resultStatus: accuracy.resultReceipt?.status ?? null,
            validationStatus: accuracy.validationReceipt?.status ?? null,
            receiptRefs
          }
        : null
    };
    const artifactBytes = Buffer.byteLength(stableJson(payload), "utf8");
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
      requestedCapabilities: ["datasource.read", "artifact.propose"],
      candidates: [
        {
          candidateId: `sql:${run.runId}`,
          artifactType:
            receiptStatus === "passed"
              ? "analysis.sql_evidence"
              : "analysis.sql_diagnostic",
          schemaVersion: "analysis-sql-evidence.v1",
          completeness: receiptStatus === "passed" ? "complete" : "insufficient",
          payload,
          receiptStatus,
          receiptRefs,
          reasonCodes:
            receiptStatus === "passed"
              ? ["text2sql_accuracy_receipts_passed"]
              : ["text2sql_accuracy_receipts_not_passed"]
        }
      ],
      cost: {
        durationMs: Date.now() - startedAt,
        tokenCount: 0,
        queryCount: run.sql ? 1 : 0,
        searchCount: 0,
        artifactBytes
      },
      unresolvedGaps:
        receiptStatus === "passed" ? [] : ["sql_result_not_supported_for_claim"]
    };
  }

  private receiptStatus(
    runStatus: string,
    accuracy: Text2SqlAccuracyEvidenceV1 | undefined
  ): "passed" | "failed" | "unavailable" {
    if (!accuracy) {
      return "unavailable";
    }
    const receipts = [
      accuracy.executionReceipt,
      accuracy.resultReceipt,
      accuracy.validationReceipt
    ];
    if (
      runStatus === "executionResult" &&
      receipts.every((receipt) => receipt?.status === "passed") &&
      (accuracy.gateReceipts ?? []).every((receipt) => receipt.status === "passed")
    ) {
      return "passed";
    }
    return receipts.some((receipt) => receipt?.status === "failed")
      ? "failed"
      : "unavailable";
  }

  private receiptRefs(accuracy?: Text2SqlAccuracyEvidenceV1): string[] {
    return [
      ...(accuracy?.gateReceipts ?? []).map((receipt) => receipt.receiptId),
      accuracy?.executionReceipt?.receiptId,
      accuracy?.resultReceipt?.receiptId,
      accuracy?.validationReceipt?.receiptId
    ].filter((value): value is string => Boolean(value));
  }
}
