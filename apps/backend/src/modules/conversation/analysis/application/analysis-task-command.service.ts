import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit
} from "@nestjs/common";
import type {
  AnalysisCommandAcceptance,
  AnalysisGoalContract,
  AnalysisTaskCommandType
} from "@text2sql/analysis-task-protocol";
import { DomainError } from "../../../../common/domain-error";
import { AnalysisCommandOutboxRepository } from "../../../platform/data/persistence/analysis-command-outbox.repository";
import { AnalysisTaskRepository } from "../../../platform/data/persistence/analysis-task.repository";
import { DurableWorkflowPort } from "../../../platform/durable/contracts/durable-workflow.port";
import { resolveAnalysisTaskTransition } from "./analysis-task-state-machine";
import { AnalysisTaskService } from "./analysis-task.service";
import { AnalysisOrchestratorService } from "../orchestration/analysis-orchestrator.service";

@Injectable()
export class AnalysisTaskCommandService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalysisTaskCommandService.name);
  private timer?: NodeJS.Timeout;
  private dispatchPromise?: Promise<number>;

  constructor(
    private readonly taskService: AnalysisTaskService,
    private readonly tasks: AnalysisTaskRepository,
    private readonly outbox: AnalysisCommandOutboxRepository,
    private readonly durable: DurableWorkflowPort,
    private readonly orchestrator?: AnalysisOrchestratorService
  ) {}

  async onModuleInit(): Promise<void> {
    if (
      process.env.JEST_WORKER_ID &&
      process.env.ANALYSIS_TEST_DISABLE_BACKGROUND_DISPATCH === "true"
    ) {
      return;
    }
    await this.outbox.requeueStaleProcessing(new Date(Date.now() - 30_000));
    void this.dispatchPending();
    this.timer = setInterval(() => void this.dispatchPending(), 2_000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async accept(input: {
    actor: Express.RequestActor;
    taskId: string;
    commandId: string;
    type: Exclude<AnalysisTaskCommandType, "revise">;
    expectedTaskVersion: number;
    expectedAuthorityEpoch: number;
    payload?: Record<string, unknown>;
  }): Promise<AnalysisCommandAcceptance> {
    const task = await this.taskService.requireAuthorizedTask(
      input.actor,
      input.taskId
    );
    const readModel = await this.tasks.getReadModel(task.id);
    const commandId = this.requireCommandId(input.commandId);
    const existing = await this.outbox.findByCommandId(task.id, commandId);
    const transition = existing
      ? {
          nextStatus: task.status,
          incrementAuthorityEpoch: false,
          terminal: false
        }
      : resolveAnalysisTaskTransition(task.status, input.type);
    if (
      input.type === "decide" &&
      typeof input.payload?.scopeDigest !== "string"
    ) {
      throw new DomainError(
        "ANALYSIS_DECISION_SCOPE_REQUIRED",
        "decision 命令必须绑定当前 Revision 的 scopeDigest。",
        400
      );
    }
    const accepted = await this.outbox.accept({
      commandId,
      taskId: task.id,
      expectedTaskVersion: input.expectedTaskVersion,
      expectedAuthorityEpoch: input.expectedAuthorityEpoch,
      revisionId: readModel.currentRevision.id,
      type: input.type,
      actorId: input.actor.id,
      principalDigest: this.taskService.principalDigest(input.actor),
      principalSnapshot: this.principalSnapshot(input.actor),
      at: new Date().toISOString(),
      payload: input.payload ?? {},
      transition
    });
    if (input.type === "start") {
      await this.tasks.createAttempt({
        taskId: task.id,
        revisionId: readModel.currentRevision.id,
        idempotencyKey: `command:${accepted.command.commandId}`
      });
    }
    void this.dispatchPending();
    return accepted.acceptance;
  }

  async acceptRevision(input: {
    actor: Express.RequestActor;
    taskId: string;
    commandId: string;
    expectedTaskVersion: number;
    expectedAuthorityEpoch: number;
  }): Promise<AnalysisCommandAcceptance> {
    const task = await this.taskService.requireAuthorizedTask(
      input.actor,
      input.taskId
    );
    const readModel = await this.tasks.getReadModel(task.id);
    const commandId = this.requireCommandId(input.commandId);
    const existing = await this.outbox.findByCommandId(task.id, commandId);
    const accepted = await this.outbox.accept({
      commandId,
      taskId: task.id,
      expectedTaskVersion: input.expectedTaskVersion,
      expectedAuthorityEpoch: input.expectedAuthorityEpoch,
      revisionId: readModel.currentRevision.id,
      type: "revise",
      actorId: input.actor.id,
      principalDigest: this.taskService.principalDigest(input.actor),
      principalSnapshot: this.principalSnapshot(input.actor),
      at: new Date().toISOString(),
      payload: {
        revision: readModel.currentRevision.revision,
        goalDigest: readModel.currentRevision.goalDigest
      },
      transition: existing
        ? {
            nextStatus: task.status,
            incrementAuthorityEpoch: false,
            terminal: false
          }
        : resolveAnalysisTaskTransition(task.status, "revise")
    });
    void this.dispatchPending();
    return accepted.acceptance;
  }

  async findExistingRevisionAcceptance(input: {
    actor: Express.RequestActor;
    taskId: string;
    commandId: string;
    goalContract: AnalysisGoalContract;
  }): Promise<AnalysisCommandAcceptance | null> {
    const task = await this.taskService.requireAuthorizedTask(
      input.actor,
      input.taskId
    );
    const record = await this.outbox.findByCommandId(
      task.id,
      this.requireCommandId(input.commandId)
    );
    if (!record) {
      return null;
    }
    const command = record.payload;
    const payload = command.payload as { goalDigest?: unknown };
    if (
      command.type !== "revise" ||
      command.actorId !== input.actor.id ||
      command.principalDigest !== this.taskService.principalDigest(input.actor) ||
      payload.goalDigest !== this.taskService.goalDigest(input.goalContract)
    ) {
      throw new DomainError(
        "ANALYSIS_COMMAND_IDEMPOTENCY_CONFLICT",
        "commandId 已绑定不同 Revision 内容。",
        409
      );
    }
    return {
      commandId: command.commandId,
      taskId: command.taskId,
      accepted: true,
      reasonCode: "already_accepted",
      taskVersion: command.acceptedTaskVersion ?? task.version,
      authorityEpoch: command.acceptedAuthorityEpoch ?? task.authorityEpoch
    };
  }

  dispatchPending(limit = 20): Promise<number> {
    if (this.dispatchPromise) {
      return this.dispatchPromise;
    }
    const operation = this.performDispatch(limit);
    let tracked: Promise<number>;
    tracked = operation.finally(() => {
      if (this.dispatchPromise === tracked) {
        this.dispatchPromise = undefined;
      }
    });
    this.dispatchPromise = tracked;
    return tracked;
  }

  private async performDispatch(limit: number): Promise<number> {
    let delivered = 0;
    try {
      const records = await this.outbox.claimPending(limit);
      for (const record of records) {
        try {
          const model = await this.tasks.getReadModel(record.taskId);
          await this.durable.startWorkflow({
            taskId: record.taskId,
            revisionId: model.currentRevision.id,
            authorityEpoch: model.task.authorityEpoch,
            taskVersion: model.task.version
          });
          await this.durable.deliverCommand(record.payload);
          await this.outbox.markDelivered(record.id);
          await this.tasks.appendEvent({
            taskId: record.taskId,
            revisionId: model.currentRevision.id,
            idempotencyKey: `command-delivered:${record.commandId}`,
            eventType: "command.delivered",
            data: {
              commandId: record.commandId,
              commandType: record.commandType,
              deliveryStatus: "delivered"
            }
          });
          delivered += 1;
          if (
            this.orchestrator &&
            ["start", "resume", "decide"].includes(record.payload.type)
          ) {
            try {
              await this.orchestrator.runAvailable(
                this.restoreActor(record.payload, model.task.workspaceId),
                record.taskId
              );
            } catch (error) {
              await this.tasks.appendEvent({
                taskId: record.taskId,
                revisionId: model.currentRevision.id,
                idempotencyKey: `orchestrator-blocked:${record.commandId}`,
                eventType: "orchestrator.blocked",
                data: {
                  commandId: record.commandId,
                  reasonCode: this.reasonCode(error)
                }
              });
            }
          }
        } catch (error) {
          await this.outbox.markRetry({
            id: record.id,
            reasonCode: this.reasonCode(error),
            nextAttemptAt: new Date(
              Date.now() + Math.min(60_000, 1_000 * 2 ** Math.min(record.attempts, 6))
            )
          });
        }
      }
    } catch (error) {
      this.logger.warn(`analysis command dispatch failed: ${this.reasonCode(error)}`);
    }
    return delivered;
  }

  private requireCommandId(value: string): string {
    const normalized = value?.trim();
    if (!normalized) {
      throw new DomainError("VALIDATION_ERROR", "commandId 为必填项。", 400);
    }
    return normalized;
  }

  private reasonCode(error: unknown): string {
    if (error instanceof DomainError) {
      return error.code;
    }
    return error instanceof Error ? error.name : "unknown_dispatch_error";
  }

  private principalSnapshot(
    actor: Express.RequestActor
  ): NonNullable<import("@text2sql/analysis-task-protocol").AnalysisTaskCommand["principalSnapshot"]> {
    const principal = actor.principal;
    if (!principal) {
      throw new DomainError(
        "PRINCIPAL_CONTEXT_REQUIRED",
        "Analysis command 需要 Principal snapshot。",
        401
      );
    }
    return {
      authenticationMethod: principal.authenticationMethod,
      trustLevel: principal.trustLevel,
      requestedWorkspaceId: principal.requestedWorkspaceId,
      roleSet: [...principal.roleSet],
      authPolicyVersion: principal.authPolicyVersion
    };
  }

  private restoreActor(
    command: import("@text2sql/analysis-task-protocol").AnalysisTaskCommand,
    workspaceId: string
  ): Express.RequestActor {
    const snapshot = command.principalSnapshot;
    const roleSet = (snapshot?.roleSet ?? ["workspace_member"]) as Express.AccessRole[];
    return {
      id: command.actorId,
      role: roleSet.includes("system_admin") ? "admin" : "user",
      isSystemAdmin: roleSet.includes("system_admin"),
      requestedWorkspaceId: snapshot?.requestedWorkspaceId ?? workspaceId,
      accessContext: {
        actorId: command.actorId,
        workspaceId,
        roleSet
      },
      principal: {
        authenticationMethod: snapshot?.authenticationMethod ?? "dev_headers",
        trustLevel: snapshot?.trustLevel ?? "development",
        subject: command.actorId,
        actorId: command.actorId,
        requestedWorkspaceId: snapshot?.requestedWorkspaceId ?? workspaceId,
        roleSet,
        authPolicyVersion: snapshot?.authPolicyVersion ?? "unavailable",
        digest: command.principalDigest
      }
    };
  }
}
