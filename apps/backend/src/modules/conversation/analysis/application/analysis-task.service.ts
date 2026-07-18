import { Injectable } from "@nestjs/common";
import type {
  AnalysisGoalContract,
  AnalysisTaskReadModel,
  AnalysisTaskRecord
} from "@text2sql/analysis-task-protocol";
import { DomainError } from "../../../../common/domain-error";
import { GovernanceAnalysisAccessFacade } from "../../../governance/access/governance-analysis-access.facade";
import { AnalysisTaskRepository } from "../../../platform/data/persistence/analysis-task.repository";
import { sha256Digest, stableJson } from "../../../platform/data/persistence/analysis-ledger.util";

export type AnalysisPrincipalInput = {
  actor: Express.RequestActor;
};

@Injectable()
export class AnalysisTaskService {
  constructor(
    private readonly tasks: AnalysisTaskRepository,
    private readonly access: GovernanceAnalysisAccessFacade
  ) {}

  async create(input: {
    actor: Express.RequestActor;
    goalContract: AnalysisGoalContract;
    idempotencyKey: string;
    retentionExpiresAt?: string;
  }): Promise<AnalysisTaskReadModel> {
    this.assertGoal(input.goalContract);
    await this.access.assertWorkspaceRead(input.actor, input.goalContract.workspaceId);
    return this.tasks.createTask({
      workspaceId: input.goalContract.workspaceId,
      createdByActorId: input.actor.id,
      principalDigest: this.principalDigest(input.actor),
      authPolicyVersion: this.authPolicyVersion(input.actor),
      idempotencyKey: this.requireKey(input.idempotencyKey, "idempotencyKey"),
      goalContract: input.goalContract,
      retentionExpiresAt: input.retentionExpiresAt
    });
  }

  async revise(input: {
    actor: Express.RequestActor;
    taskId: string;
    expectedTaskVersion: number;
    goalContract: AnalysisGoalContract;
  }): Promise<AnalysisTaskReadModel> {
    const task = await this.requireAuthorizedTask(input.actor, input.taskId);
    this.assertGoal(input.goalContract);
    if (input.goalContract.workspaceId !== task.workspaceId) {
      throw new DomainError(
        "ANALYSIS_GOAL_WORKSPACE_IMMUTABLE",
        "Revision 不得切换 Task 所属 workspace。",
        409
      );
    }
    return this.tasks.appendRevision({
      taskId: input.taskId,
      expectedTaskVersion: input.expectedTaskVersion,
      createdByActorId: input.actor.id,
      principalDigest: this.principalDigest(input.actor),
      authPolicyVersion: this.authPolicyVersion(input.actor),
      goalContract: input.goalContract
    });
  }

  async get(
    actor: Express.RequestActor,
    taskId: string
  ): Promise<AnalysisTaskReadModel> {
    await this.requireAuthorizedTask(actor, taskId);
    return this.tasks.getReadModel(taskId);
  }

  async list(input: {
    actor: Express.RequestActor;
    workspaceId: string;
    limit?: number;
  }): Promise<AnalysisTaskRecord[]> {
    const workspaceId = this.requireKey(input.workspaceId, "workspaceId");
    await this.access.assertWorkspaceRead(input.actor, workspaceId);
    return this.tasks.listTasks({ workspaceId, limit: input.limit });
  }

  async events(input: {
    actor: Express.RequestActor;
    taskId: string;
    afterSequence?: number;
    limit?: number;
  }) {
    await this.requireAuthorizedTask(input.actor, input.taskId);
    return this.tasks.listEvents({
      taskId: input.taskId,
      afterSequence: input.afterSequence,
      limit: input.limit
    });
  }

  async requireAuthorizedTask(
    actor: Express.RequestActor,
    taskId: string
  ): Promise<AnalysisTaskRecord> {
    const task = await this.tasks.getTask(this.requireKey(taskId, "taskId"));
    if (!task) {
      throw new DomainError("ANALYSIS_TASK_NOT_FOUND", "未找到 AnalysisTask。", 404);
    }
    await this.access.assertWorkspaceRead(actor, task.workspaceId, {
      hideExistence: true
    });
    return task;
  }

  principalDigest(actor: Express.RequestActor): string {
    const digest = actor.principal?.digest;
    if (!digest) {
      throw new DomainError(
        "PRINCIPAL_CONTEXT_REQUIRED",
        "Analysis 操作需要可信 Principal digest。",
        401
      );
    }
    return digest;
  }

  goalDigest(goal: AnalysisGoalContract): string {
    return sha256Digest(stableJson(goal));
  }

  private authPolicyVersion(actor: Express.RequestActor): string {
    const version = actor.principal?.authPolicyVersion;
    if (!version) {
      throw new DomainError(
        "PRINCIPAL_CONTEXT_REQUIRED",
        "Analysis 操作需要 auth policy version。",
        401
      );
    }
    return version;
  }

  private assertGoal(goal: AnalysisGoalContract): void {
    if (
      !goal ||
      goal.version !== "analysis-goal.v1" ||
      !goal.objective?.trim() ||
      !goal.decisionUse?.trim() ||
      !goal.workspaceId?.trim() ||
      !Array.isArray(goal.deliverables) ||
      goal.deliverables.length === 0 ||
      !goal.budget
    ) {
      throw new DomainError(
        "ANALYSIS_GOAL_INVALID",
        "GoalContract 缺少 objective、decisionUse、workspaceId、deliverables 或 budget。",
        400
      );
    }
    const budgets = Object.values(goal.budget);
    if (budgets.some((value) => !Number.isSafeInteger(value) || value < 1)) {
      throw new DomainError(
        "ANALYSIS_BUDGET_INVALID",
        "GoalContract budget 必须全部为正整数。",
        400
      );
    }
  }

  private requireKey(value: string, field: string): string {
    const normalized = value?.trim();
    if (!normalized) {
      throw new DomainError("VALIDATION_ERROR", `${field} 为必填项。`, 400, {
        field
      });
    }
    return normalized;
  }
}
