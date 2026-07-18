import { Injectable } from "@nestjs/common";
import {
  ANALYSIS_TASK_PROTOCOL_ID,
  ANALYSIS_TASK_PROTOCOL_VERSION,
  type AnalysisCommandAcceptance,
  type AnalysisEvent,
  type AnalysisTaskCommand,
  type AnalysisTaskCommandType,
  type AnalysisTaskStatus
} from "@text2sql/analysis-task-protocol";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "../../../../common/domain-error";
import {
  AnalysisLedgerPrismaService,
  type AnalysisPrismaClient
} from "./analysis-ledger-prisma.service";
import { parseJson, stableJson } from "./analysis-ledger.util";

export type AnalysisCommandTransition = {
  nextStatus: AnalysisTaskStatus;
  incrementAuthorityEpoch: boolean;
  terminal: boolean;
};

export type AcceptAnalysisCommandInput = {
  commandId: string;
  taskId: string;
  expectedTaskVersion: number;
  expectedAuthorityEpoch: number;
  revisionId: string;
  type: AnalysisTaskCommandType;
  actorId: string;
  principalDigest: string;
  principalSnapshot?: AnalysisTaskCommand["principalSnapshot"];
  at: string;
  payload: Record<string, unknown>;
  transition: AnalysisCommandTransition;
};

export type AcceptedAnalysisCommand = {
  acceptance: AnalysisCommandAcceptance;
  command: AnalysisTaskCommand;
  outbox: AnalysisCommandOutboxRecord;
  event: AnalysisEvent;
};

export type AnalysisCommandOutboxStatus =
  | "pending"
  | "processing"
  | "retry"
  | "delivered"
  | "failed";

export type AnalysisCommandOutboxRecord = {
  id: string;
  taskId: string;
  commandId: string;
  commandType: string;
  payload: AnalysisTaskCommand;
  status: AnalysisCommandOutboxStatus;
  attempts: number;
  nextAttemptAt?: string | null;
  deliveredAt?: string | null;
  lastReasonCode?: string | null;
  createdAt: string;
  updatedAt: string;
};

type OutboxRow = {
  id: string;
  taskId: string;
  commandId: string;
  commandType: string;
  payload: string;
  status: string;
  attempts: number;
  nextAttemptAt: Date | null;
  deliveredAt: Date | null;
  lastReasonCode: string | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class AnalysisCommandOutboxRepository {
  constructor(private readonly prisma: AnalysisLedgerPrismaService) {}

  async accept(input: AcceptAnalysisCommandInput): Promise<AcceptedAnalysisCommand> {
    return this.prisma.transaction(async (transaction) => {
      const task = (await transaction.analysisTask.findUnique({
        where: { id: input.taskId }
      })) as TaskCommandRow | null;
      if (!task) {
        throw new DomainError("ANALYSIS_TASK_NOT_FOUND", "未找到 AnalysisTask。", 404);
      }
      const existing = (await transaction.analysisCommandOutbox.findUnique({
        where: {
          taskId_commandId: { taskId: input.taskId, commandId: input.commandId }
        }
      })) as OutboxRow | null;
      if (existing) {
        const existingCommand = parseJson<AnalysisTaskCommand | null>(
          existing.payload,
          null
        );
        if (!existingCommand || !this.sameRequestedCommand(existingCommand, input)) {
          throw new DomainError(
            "ANALYSIS_COMMAND_IDEMPOTENCY_CONFLICT",
            "commandId 已绑定不同命令内容。",
            409
          );
        }
        const event = await this.requireAcceptedEvent(transaction, input);
        return {
          acceptance: {
            commandId: input.commandId,
            taskId: input.taskId,
            accepted: true,
            reasonCode: "already_accepted",
            taskVersion: existingCommand.acceptedTaskVersion ?? task.version,
            authorityEpoch:
              existingCommand.acceptedAuthorityEpoch ?? task.authorityEpoch
          },
          command: existingCommand,
          outbox: this.map(existing),
          event: this.mapEvent(event)
        };
      }
      if (
        task.version !== input.expectedTaskVersion ||
        task.authorityEpoch !== input.expectedAuthorityEpoch
      ) {
        throw new DomainError(
          "ANALYSIS_TASK_VERSION_CONFLICT",
          "Task version 或 authority epoch 已变化，请刷新后重试。",
          409,
          { version: task.version, authorityEpoch: task.authorityEpoch }
        );
      }
      const currentRevision = (await transaction.analysisTaskRevision.findUnique({
        where: {
          taskId_revision: {
            taskId: task.id,
            revision: task.currentRevisionNumber
          }
        }
      })) as { id: string } | null;
      if (currentRevision?.id !== input.revisionId) {
        throw new DomainError(
          "ANALYSIS_REVISION_NOT_CURRENT",
          "命令必须绑定当前 active Revision。",
          409
        );
      }
      const acceptedTaskVersion = task.version + 1;
      const acceptedAuthorityEpoch = input.transition.incrementAuthorityEpoch
        ? task.authorityEpoch + 1
        : task.authorityEpoch;
      const command: AnalysisTaskCommand = {
        commandId: input.commandId,
        taskId: input.taskId,
        expectedTaskVersion: input.expectedTaskVersion,
        acceptedTaskVersion,
        revisionId: input.revisionId,
        authorityEpoch: input.expectedAuthorityEpoch,
        acceptedAuthorityEpoch,
        type: input.type,
        actorId: input.actorId,
        principalDigest: input.principalDigest,
        ...(input.principalSnapshot
          ? { principalSnapshot: input.principalSnapshot }
          : {}),
        at: input.at,
        payload: input.payload
      };
      const updated = await transaction.analysisTask.updateMany({
        where: {
          id: task.id,
          version: input.expectedTaskVersion,
          authorityEpoch: input.expectedAuthorityEpoch
        },
        data: {
          status: input.transition.nextStatus,
          version: { increment: 1 },
          authorityEpoch: acceptedAuthorityEpoch,
          terminalAt: input.transition.terminal ? new Date(input.at) : null
        }
      });
      if (updated.count !== 1) {
        throw new DomainError(
          "ANALYSIS_TASK_VERSION_CONFLICT",
          "Task version 或 authority epoch 已变化，请刷新后重试。",
          409
        );
      }
      const outbox = (await transaction.analysisCommandOutbox.create({
        data: {
          id: uuidv4(),
          taskId: input.taskId,
          commandId: input.commandId,
          commandType: input.type,
          payload: stableJson(command),
          status: "pending"
        }
      })) as OutboxRow;
      const event = await this.appendAcceptedEvent(transaction, input, {
        acceptedTaskVersion,
        acceptedAuthorityEpoch
      });
      return {
        acceptance: {
          commandId: input.commandId,
          taskId: input.taskId,
          accepted: true,
          reasonCode: "accepted",
          taskVersion: acceptedTaskVersion,
          authorityEpoch: acceptedAuthorityEpoch
        },
        command,
        outbox: this.map(outbox),
        event: this.mapEvent(event)
      };
    });
  }

  async enqueue(command: AnalysisTaskCommand): Promise<AnalysisCommandOutboxRecord> {
    const row = await this.prisma.transaction(async (transaction) => {
      const task = await transaction.analysisTask.findUnique({
        where: { id: command.taskId }
      });
      if (!task) {
        throw new DomainError("ANALYSIS_TASK_NOT_FOUND", "未找到 AnalysisTask。", 404);
      }
      const existing = (await transaction.analysisCommandOutbox.findUnique({
        where: {
          taskId_commandId: {
            taskId: command.taskId,
            commandId: command.commandId
          }
        }
      })) as OutboxRow | null;
      const payload = stableJson(command);
      if (existing) {
        if (existing.payload !== payload) {
          throw new DomainError(
            "ANALYSIS_COMMAND_IDEMPOTENCY_CONFLICT",
            "commandId 已绑定不同命令内容。",
            409
          );
        }
        return existing;
      }
      return (await transaction.analysisCommandOutbox.create({
        data: {
          id: uuidv4(),
          taskId: command.taskId,
          commandId: command.commandId,
          commandType: command.type,
          payload,
          status: "pending"
        }
      })) as OutboxRow;
    });
    return this.map(row);
  }

  async findByCommandId(
    taskId: string,
    commandId: string
  ): Promise<AnalysisCommandOutboxRecord | null> {
    const row = (await this.prisma.requireClient().analysisCommandOutbox.findUnique({
      where: { taskId_commandId: { taskId, commandId } }
    })) as OutboxRow | null;
    return row ? this.map(row) : null;
  }

  async claimPending(limit = 20, now = new Date()): Promise<AnalysisCommandOutboxRecord[]> {
    const candidates = (await this.prisma
      .requireClient()
      .analysisCommandOutbox.findMany({
        where: {
          status: { in: ["pending", "retry"] },
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }]
        },
        orderBy: { createdAt: "asc" },
        take: Math.max(1, Math.min(limit, 100))
      })) as OutboxRow[];
    const claimed: OutboxRow[] = [];
    for (const candidate of candidates) {
      const updated = await this.prisma.requireClient().analysisCommandOutbox.updateMany({
        where: {
          id: candidate.id,
          status: { in: ["pending", "retry"] }
        },
        data: {
          status: "processing",
          attempts: { increment: 1 },
          nextAttemptAt: null
        }
      });
      if (updated.count !== 1) {
        continue;
      }
      const row = (await this.prisma.requireClient().analysisCommandOutbox.findUnique({
        where: { id: candidate.id }
      })) as OutboxRow | null;
      if (row) {
        claimed.push(row);
      }
    }
    return claimed.map((row) => this.map(row));
  }

  async markDelivered(id: string): Promise<AnalysisCommandOutboxRecord> {
    const row = (await this.prisma.requireClient().analysisCommandOutbox.update({
      where: { id },
      data: {
        status: "delivered",
        deliveredAt: new Date(),
        lastReasonCode: null
      }
    })) as OutboxRow;
    return this.map(row);
  }

  async markRetry(input: {
    id: string;
    reasonCode: string;
    nextAttemptAt: Date;
    terminal?: boolean;
  }): Promise<AnalysisCommandOutboxRecord> {
    const row = (await this.prisma.requireClient().analysisCommandOutbox.update({
      where: { id: input.id },
      data: {
        status: input.terminal ? "failed" : "retry",
        nextAttemptAt: input.terminal ? null : input.nextAttemptAt,
        lastReasonCode: input.reasonCode
      }
    })) as OutboxRow;
    return this.map(row);
  }

  async backlogCount(): Promise<number> {
    const rows = await this.prisma.requireClient().analysisCommandOutbox.findMany({
      where: { status: { in: ["pending", "processing", "retry"] } },
      select: { id: true }
    });
    return rows.length;
  }

  async requeueStaleProcessing(
    staleBefore: Date,
    reasonCode = "dispatcher_recovered"
  ): Promise<number> {
    const updated = await this.prisma.requireClient().analysisCommandOutbox.updateMany({
      where: { status: "processing", updatedAt: { lt: staleBefore } },
      data: {
        status: "retry",
        nextAttemptAt: new Date(),
        lastReasonCode: reasonCode
      }
    });
    return updated.count;
  }

  private sameRequestedCommand(
    existing: AnalysisTaskCommand,
    input: AcceptAnalysisCommandInput
  ): boolean {
    return (
      existing.taskId === input.taskId &&
      existing.type === input.type &&
      existing.expectedTaskVersion === input.expectedTaskVersion &&
      existing.authorityEpoch === input.expectedAuthorityEpoch &&
      existing.revisionId === input.revisionId &&
      existing.actorId === input.actorId &&
      existing.principalDigest === input.principalDigest &&
      stableJson(existing.principalSnapshot ?? null) ===
        stableJson(input.principalSnapshot ?? null) &&
      stableJson(existing.payload) === stableJson(input.payload)
    );
  }

  private async appendAcceptedEvent(
    transaction: AnalysisPrismaClient,
    input: AcceptAnalysisCommandInput,
    accepted: { acceptedTaskVersion: number; acceptedAuthorityEpoch: number }
  ): Promise<EventRow> {
    const last = (await transaction.analysisEvent.findFirst({
      where: { taskId: input.taskId },
      orderBy: { sequence: "desc" }
    })) as EventRow | null;
    return (await transaction.analysisEvent.create({
      data: {
        id: uuidv4(),
        taskId: input.taskId,
        revisionId: input.revisionId,
        sequence: (last?.sequence ?? 0) + 1,
        idempotencyKey: `command-accepted:${input.commandId}`,
        eventType: "command.accepted",
        visibility: "user",
        data: stableJson({
          commandId: input.commandId,
          commandType: input.type,
          status: input.transition.nextStatus,
          taskVersion: accepted.acceptedTaskVersion,
          authorityEpoch: accepted.acceptedAuthorityEpoch,
          deliveryStatus: "pending"
        }),
        createdAt: new Date(input.at)
      }
    })) as EventRow;
  }

  private async requireAcceptedEvent(
    transaction: AnalysisPrismaClient,
    input: AcceptAnalysisCommandInput
  ): Promise<EventRow> {
    const event = (await transaction.analysisEvent.findUnique({
      where: {
        taskId_idempotencyKey: {
          taskId: input.taskId,
          idempotencyKey: `command-accepted:${input.commandId}`
        }
      }
    })) as EventRow | null;
    if (!event) {
      throw new DomainError(
        "ANALYSIS_LEDGER_INCONSISTENT",
        "命令 outbox 缺少 accepted event。",
        500
      );
    }
    return event;
  }

  private mapEvent(row: EventRow): AnalysisEvent {
    return {
      protocol: ANALYSIS_TASK_PROTOCOL_ID,
      version: ANALYSIS_TASK_PROTOCOL_VERSION,
      id: row.id,
      taskId: row.taskId,
      ...(row.revisionId ? { revisionId: row.revisionId } : {}),
      ...(row.attemptId ? { attemptId: row.attemptId } : {}),
      sequence: row.sequence,
      idempotencyKey: row.idempotencyKey,
      type: row.eventType,
      visibility: row.visibility as AnalysisEvent["visibility"],
      at: row.createdAt.toISOString(),
      data: parseJson<Record<string, unknown>>(row.data, {})
    };
  }

  private map(row: OutboxRow): AnalysisCommandOutboxRecord {
    return {
      id: row.id,
      taskId: row.taskId,
      commandId: row.commandId,
      commandType: row.commandType,
      payload: parseJson<AnalysisTaskCommand>(row.payload, {
        commandId: row.commandId,
        taskId: row.taskId,
        expectedTaskVersion: 0,
        authorityEpoch: 0,
        type: row.commandType as AnalysisTaskCommand["type"],
        actorId: "unavailable",
        principalDigest: "unavailable",
        at: row.createdAt.toISOString(),
        payload: {}
      }),
      status: row.status as AnalysisCommandOutboxStatus,
      attempts: row.attempts,
      nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      lastReasonCode: row.lastReasonCode,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }
}

type TaskCommandRow = {
  id: string;
  status: string;
  version: number;
  authorityEpoch: number;
  currentRevisionNumber: number;
};

type EventRow = {
  id: string;
  taskId: string;
  revisionId: string | null;
  attemptId: string | null;
  sequence: number;
  idempotencyKey: string;
  eventType: string;
  visibility: string;
  data: string;
  createdAt: Date;
};
