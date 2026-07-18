import { Injectable } from "@nestjs/common";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "../../../../common/domain-error";
import { AppConfigService } from "../../../config/app-config.service";
import { AnalysisArtifactRepository } from "../../../platform/data/persistence/analysis-artifact.repository";
import { sha256Digest, stableJson } from "../../../platform/data/persistence/analysis-ledger.util";
import { AnalysisTaskRepository } from "../../../platform/data/persistence/analysis-task.repository";
import { AnalysisTaskService } from "../application/analysis-task.service";
import { AnalysisWorkerRegistryService } from "../workers/worker-registry.service";
import type {
  AnalysisCapability,
  AnalysisWorkerInvocation,
  AnalysisWorkerProposal
} from "../workers/worker-contract.types";
import { AnalysisCommitGuardService } from "./analysis-commit-guard.service";
import { AnalysisGoalCompilerService } from "./analysis-goal-compiler.service";
import type { AnalysisWorkGraph, AnalysisWorkItem } from "./work-graph.types";

@Injectable()
export class AnalysisOrchestratorService {
  constructor(
    private readonly taskService: AnalysisTaskService,
    private readonly tasks: AnalysisTaskRepository,
    private readonly artifacts: AnalysisArtifactRepository,
    private readonly compiler: AnalysisGoalCompilerService,
    private readonly registry: AnalysisWorkerRegistryService,
    private readonly commitGuard: AnalysisCommitGuardService,
    private readonly config: AppConfigService
  ) {}

  async runAvailable(
    actor: Express.RequestActor,
    taskId: string,
    maxSteps = 20
  ): Promise<{ steps: number; blocked: boolean }> {
    let steps = 0;
    for (; steps < maxSteps; steps += 1) {
      const result = await this.runNext(actor, taskId);
      if (!result.executed) {
        return { steps, blocked: false };
      }
      if (result.executed.status === "blocked") {
        return { steps: steps + 1, blocked: true };
      }
    }
    throw new DomainError(
      "ANALYSIS_ORCHESTRATOR_STEP_LIMIT",
      "Orchestrator 达到单轮 step 上限，等待下一次 durable dispatch。",
      409,
      { maxSteps }
    );
  }

  async runNext(actor: Express.RequestActor, taskId: string) {
    let model = await this.taskService.get(actor, taskId);
    if (model.task.status === "queued") {
      model = await this.tasks.transitionTask({
        taskId,
        expectedTaskVersion: model.task.version,
        expectedAuthorityEpoch: model.task.authorityEpoch,
        nextStatus: "running",
        eventType: "orchestrator.started",
        idempotencyKey: `orchestrator-started:${model.currentRevision.id}`,
        data: { revisionId: model.currentRevision.id }
      });
    }
    if (model.task.status !== "running") {
      throw new DomainError(
        "ANALYSIS_TASK_NOT_RUNNABLE",
        `Task 状态 ${model.task.status} 不能调度 work。`,
        409
      );
    }
    const attempt = [...model.attempts]
      .reverse()
      .find((item) => item.revisionId === model.currentRevision.id);
    if (!attempt) {
      throw new DomainError(
        "ANALYSIS_ATTEMPT_REQUIRED",
        "Orchestrator 需要当前 Revision 的 Attempt。",
        409
      );
    }
    const graph = this.compiler.compile({
      taskId,
      revision: model.currentRevision,
      multiWorkerMode: this.config.analysisMultiWorkerMode
    });
    await this.artifacts.commitArtifact({
      artifactId: `work-graph:${model.currentRevision.id}`,
      taskId,
      revisionId: model.currentRevision.id,
      attemptId: attempt.id,
      authorityEpoch: model.task.authorityEpoch,
      artifactType: "analysis.work_graph",
      schemaVersion: graph.version,
      classification: "workspace",
      visibility: "user",
      completeness: graph.deferredKinds.length > 0 ? "partial" : "complete",
      payload: { ...graph },
      receipt: {
        receiptType: "analysis.goal-compiler.v1",
        decision: "accepted",
        reasonCodes: ["deterministic_graph_validated"],
        principalDigest: this.taskService.principalDigest(actor),
        policyRefs: { goalDigest: graph.goalDigest, graphDigest: graph.graphDigest }
      }
    });
    model = await this.taskService.get(actor, taskId);
    const completed = new Set(
      model.events
        .filter(
          (event) =>
            event.type === "work.completed" &&
            event.revisionId === model.currentRevision.id
        )
        .map((event) => String(event.data.workItemId ?? ""))
        .filter(Boolean)
    );
    const blocked = new Set(
      model.events
        .filter(
          (event) =>
            event.type === "work.blocked" &&
            event.revisionId === model.currentRevision.id
        )
        .map((event) => String(event.data.workItemId ?? ""))
        .filter(Boolean)
    );
    const next = graph.workItems.find(
      (item) =>
        item.supported &&
        !completed.has(item.id) &&
        !blocked.has(item.id) &&
        item.dependencies.every((dependency) => completed.has(dependency))
    );
    if (!next) {
      return { graph: this.projectGraph(graph, completed, blocked), executed: null };
    }
    const inputRefs = model.artifacts
      .filter((artifact) => artifact.artifactType !== "analysis.work_graph")
      .map((artifact) => ({ id: artifact.id, digest: artifact.payloadDigest }));
    const invocation = this.buildInvocation({
      actor,
      graph,
      workItem: next,
      attemptId: attempt.id,
      authorityEpoch: model.task.authorityEpoch,
      inputRefs
    });
    const worker = this.registry.resolve(next.workerId, next.kind);
    this.registry.assertInvocationGrant(worker, invocation);
    const proposal = await worker.execute(invocation);
    const committed = await this.commitGuard.commit({ actor, invocation, proposal });
    const workStatus = this.proposalSatisfiesWork(next, proposal)
      ? "completed"
      : "blocked";
    await this.tasks.appendEvent({
      taskId,
      revisionId: model.currentRevision.id,
      attemptId: attempt.id,
      idempotencyKey: `work-${workStatus}:${model.currentRevision.id}:${next.id}`,
      eventType: `work.${workStatus}`,
      data: {
        workItemId: next.id,
        workerId: worker.workerId,
        artifactRefs: committed.decision.artifactRefs,
        unresolvedGaps: proposal.unresolvedGaps
      }
    });
    if (workStatus === "completed") {
      completed.add(next.id);
    } else {
      blocked.add(next.id);
    }
    return {
      graph: this.projectGraph(graph, completed, blocked),
      executed: {
        workItemId: next.id,
        invocationId: invocation.invocationId,
        proposalId: proposal.proposalId,
        decision: committed.decision,
        status: workStatus
      }
    };
  }

  private buildInvocation(input: {
    actor: Express.RequestActor;
    graph: AnalysisWorkGraph;
    workItem: AnalysisWorkItem;
    attemptId: string;
    authorityEpoch: number;
    inputRefs: Array<{ id: string; digest: string }>;
  }): AnalysisWorkerInvocation {
    const capabilities = this.capabilitiesFor(input.workItem.kind);
    const invocationId = uuidv4();
    const capabilityGrantDigest = sha256Digest(
      stableJson({ invocationId, capabilities: [...capabilities].sort() })
    );
    const divisor = Math.max(
      1,
      input.graph.workItems.filter((item) => item.supported).length
    );
    return {
      invocationId,
      taskId: input.graph.taskId,
      revisionId: input.graph.revisionId,
      attemptId: input.attemptId,
      workItemId: input.workItem.id,
      workKind: input.workItem.kind,
      authorityEpoch: input.authorityEpoch,
      actor: input.actor,
      datasourceId: input.workItem.datasourceId,
      instruction: input.workItem.description,
      capabilityGrant: capabilities,
      capabilityGrantDigest,
      budgetReservation: {
        maxDurationMs: Math.max(1, Math.floor(input.graph.budget.maxDurationMs / divisor)),
        maxTokenCount: Math.max(1, Math.floor(input.graph.budget.maxTokenCount / divisor)),
        maxQueryCount: Math.max(1, Math.floor(input.graph.budget.maxQueryCount / divisor)),
        maxSearchCount: Math.max(1, Math.floor(input.graph.budget.maxSearchCount / divisor)),
        maxArtifactBytes: Math.max(1, Math.floor(input.graph.budget.maxArtifactBytes / divisor))
      },
      inputArtifactRefs: input.inputRefs,
      inputDigest: sha256Digest(stableJson(input.inputRefs)),
      expectedOutputSchema: this.expectedOutputSchema(input.workItem.kind),
      allowedOutputSchemas: this.allowedOutputSchemas(input.workItem.kind)
    };
  }

  private capabilitiesFor(kind: AnalysisWorkItem["kind"]): AnalysisCapability[] {
    if (kind === "text2sql") {
      return ["datasource.read", "artifact.propose"];
    }
    if (kind === "critique") {
      return ["artifact.read", "artifact.propose", "claim.challenge"];
    }
    if (kind === "research") {
      return ["web.search", "web.fetch", "artifact.propose"];
    }
    if (kind === "calculation") {
      return ["artifact.read", "artifact.propose", "calculation.execute"];
    }
    return ["artifact.read", "artifact.propose"];
  }

  private allowedOutputSchemas(kind: AnalysisWorkItem["kind"]): string[] {
    if (kind === "evidence_alignment") {
      return [
        "analysis-evidence.v1",
        "analysis-evidence-alignment.v1",
        "analysis-conflict-set.v1"
      ];
    }
    if (kind === "calculation") {
      return ["analysis-calculation.v1", "analysis-claim.v1"];
    }
    return [this.expectedOutputSchema(kind)];
  }

  private expectedOutputSchema(kind: AnalysisWorkItem["kind"]): string {
    if (kind === "text2sql") {
      return "analysis-sql-evidence.v1";
    }
    if (kind === "research") {
      return "analysis-research-evidence.v1";
    }
    if (kind === "critique") {
      return "analysis-critique.v1";
    }
    return `analysis-${kind.replaceAll("_", "-")}.v1`;
  }

  private proposalSatisfiesWork(
    workItem: AnalysisWorkItem,
    proposal: AnalysisWorkerProposal
  ): boolean {
    if (workItem.kind === "text2sql") {
      return proposal.candidates.some(
        (candidate) =>
          candidate.artifactType === "analysis.sql_evidence" &&
          candidate.receiptStatus === "passed"
      );
    }
    if (workItem.kind === "research") {
      return proposal.candidates.some(
        (candidate) =>
          candidate.artifactType === "analysis.research_evidence" &&
          candidate.receiptStatus === "passed" &&
          (candidate.completeness === "complete" ||
            candidate.completeness === "conflicted")
      );
    }
    if (workItem.kind === "evidence_alignment") {
      return proposal.candidates.some(
        (candidate) =>
          candidate.artifactType === "analysis.evidence_alignment" &&
          candidate.receiptStatus === "passed"
      );
    }
    if (workItem.kind === "calculation") {
      return (
        proposal.candidates.some(
          (candidate) =>
            candidate.artifactType === "analysis.calculation" &&
            candidate.receiptStatus === "passed"
        ) &&
        proposal.candidates.some(
          (candidate) =>
            candidate.artifactType === "analysis.claim" &&
            candidate.receiptStatus === "passed"
        )
      );
    }
    if (workItem.kind === "report") {
      return proposal.candidates.some(
        (candidate) =>
          candidate.artifactType === "analysis.report" &&
          candidate.receiptStatus === "passed"
      );
    }
    return true;
  }

  private projectGraph(
    graph: AnalysisWorkGraph,
    completed: Set<string>,
    blocked: Set<string>
  ): AnalysisWorkGraph {
    return {
      ...graph,
      workItems: graph.workItems.map((item) => ({
        ...item,
        status: completed.has(item.id)
          ? "completed"
          : blocked.has(item.id)
            ? "failed"
            : item.status
      })),
      obligations: graph.obligations.map((obligation) => {
        const owners = graph.workItems.filter((item) =>
          item.obligationIds.includes(obligation.id)
        );
        return owners.length > 0 && owners.every((item) => completed.has(item.id))
          ? { ...obligation, status: "satisfied" as const }
          : obligation;
      })
    };
  }
}
