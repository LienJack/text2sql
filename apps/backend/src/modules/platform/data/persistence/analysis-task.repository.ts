import { Injectable } from "@nestjs/common";
import {
  ANALYSIS_TASK_PROTOCOL_ID,
  ANALYSIS_TASK_PROTOCOL_VERSION,
  type AnalysisArtifactMetadata,
  type AnalysisAttemptRecord,
  type AnalysisEvent,
  type AnalysisGoalContract,
  type AnalysisManifestRecord,
  type AnalysisReceiptRecord,
  type AnalysisTaskReadModel,
  type AnalysisTaskRecord,
  type AnalysisTaskRevisionRecord,
  type AnalysisTaskStatus,
  type AnalysisVisibility
} from "@text2sql/analysis-task-protocol";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "../../../../common/domain-error";
import {
  AnalysisLedgerPrismaService,
  type AnalysisPrismaClient
} from "./analysis-ledger-prisma.service";
import { parseJson, sha256Digest, stableJson, toIso } from "./analysis-ledger.util";

type TaskRow = {
  id: string;
  workspaceId: string;
  createdByActorId: string;
  status: string;
  version: number;
  currentRevisionNumber: number;
  authorityEpoch: number;
  goalDigest: string;
  retentionExpiresAt: Date | null;
  terminalAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type RevisionRow = {
  id: string;
  taskId: string;
  revision: number;
  status: string;
  goalContract: string;
  goalDigest: string;
  principalDigest: string;
  authPolicyVersion: string;
  createdByActorId: string;
  supersedesRevisionId: string | null;
  createdAt: Date;
};

type AttemptRow = {
  id: string;
  taskId: string;
  revisionId: string;
  attempt: number;
  status: string;
  authorityEpoch: number;
  idempotencyKey: string;
  failureReasonCode: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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

type ArtifactRow = {
  id: string;
  taskId: string;
  revisionId: string;
  attemptId: string | null;
  artifactType: string;
  schemaVersion: string;
  status: string;
  classification: string;
  visibility: string;
  payloadDigest: string;
  payloadSizeBytes: number;
  completeness: string;
  retentionExpiresAt: Date | null;
  staleAt: Date | null;
  invalidatedAt: Date | null;
  createdAt: Date;
  payload?: { deletedAt: Date | null } | null;
};

type ReceiptRow = {
  id: string;
  taskId: string;
  revisionId: string;
  attemptId: string | null;
  artifactId: string | null;
  receiptType: string;
  subjectType: string;
  subjectRef: string;
  subjectDigest: string;
  decision: string;
  reasonCodes: string[];
  authorityEpoch: number;
  principalDigest: string;
  policyRefs: string;
  createdAt: Date;
};

type ManifestRow = {
  id: string;
  taskId: string;
  revisionId: string;
  attemptId: string | null;
  manifestType: string;
  schemaVersion: string;
  status: string;
  digest: string;
  artifactRefs: string;
  receiptRefs: string;
  limitations: string;
  staleAt: Date | null;
  sealedAt: Date;
  createdAt: Date;
};

@Injectable()
export class AnalysisTaskRepository {
  constructor(private readonly prisma: AnalysisLedgerPrismaService) {}

  async createTask(input: {
    workspaceId: string;
    createdByActorId: string;
    principalDigest: string;
    authPolicyVersion: string;
    idempotencyKey: string;
    goalContract: AnalysisGoalContract;
    retentionExpiresAt?: string;
  }): Promise<AnalysisTaskReadModel> {
    const goalContractJson = stableJson(input.goalContract);
    const goalDigest = sha256Digest(goalContractJson);
    const taskId = uuidv4();
    const revisionId = uuidv4();
    const eventId = uuidv4();

    try {
      await this.prisma.transaction(async (transaction) => {
        const existing = (await transaction.analysisTask.findUnique({
        where: {
          workspaceId_idempotencyKey: {
            workspaceId: input.workspaceId,
            idempotencyKey: input.idempotencyKey
          }
        }
      })) as TaskRow | null;
        if (existing) {
          if (existing.goalDigest !== goalDigest) {
            throw new DomainError(
              "ANALYSIS_IDEMPOTENCY_CONFLICT",
              "相同 idempotency key 已绑定不同 GoalContract。",
              409
            );
          }
          return;
        }

        const now = new Date();
        await transaction.analysisTask.create({
        data: {
          id: taskId,
          workspaceId: input.workspaceId,
          createdByActorId: input.createdByActorId,
          status: "draft",
          version: 1,
          currentRevisionNumber: 1,
          authorityEpoch: 1,
          goalDigest,
          idempotencyKey: input.idempotencyKey,
          retentionExpiresAt: input.retentionExpiresAt
            ? new Date(input.retentionExpiresAt)
            : null,
          createdAt: now,
          updatedAt: now
        }
      });
        await transaction.analysisTaskRevision.create({
        data: {
          id: revisionId,
          taskId,
          revision: 1,
          status: "active",
          goalContract: goalContractJson,
          goalDigest,
          principalDigest: input.principalDigest,
          authPolicyVersion: input.authPolicyVersion,
          createdByActorId: input.createdByActorId,
          createdAt: now
        }
      });
        await transaction.analysisEvent.create({
        data: {
          id: eventId,
          taskId,
          revisionId,
          sequence: 1,
          idempotencyKey: `task-created:${input.idempotencyKey}`,
          eventType: "task.created",
          visibility: "user",
          data: stableJson({ status: "draft", goalDigest }),
          createdAt: now
        }
        });
      });
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) {
        throw error;
      }
      const concurrent = await this.findByWorkspaceAndIdempotencyKey(
        input.workspaceId,
        input.idempotencyKey
      );
      if (!concurrent || concurrent.goalDigest !== goalDigest) {
        throw new DomainError(
          "ANALYSIS_IDEMPOTENCY_CONFLICT",
          "相同 idempotency key 已绑定不同 GoalContract。",
          409
        );
      }
    }

    const task = await this.findByWorkspaceAndIdempotencyKey(
      input.workspaceId,
      input.idempotencyKey
    );
    if (!task) {
      throw new DomainError(
        "ANALYSIS_TASK_CREATE_FAILED",
        "创建 AnalysisTask 后未能读取 canonical record。",
        500
      );
    }
    return this.getReadModel(task.id);
  }

  async appendRevision(input: {
    taskId: string;
    expectedTaskVersion: number;
    createdByActorId: string;
    principalDigest: string;
    authPolicyVersion: string;
    goalContract: AnalysisGoalContract;
  }): Promise<AnalysisTaskReadModel> {
    const goalContractJson = stableJson(input.goalContract);
    const goalDigest = sha256Digest(goalContractJson);
    await this.prisma.transaction(async (transaction) => {
      const task = await this.requireTask(transaction, input.taskId);
      if (task.version !== input.expectedTaskVersion) {
        throw this.optimisticConflict(task);
      }
      const currentRevision = await this.requireCurrentRevision(transaction, task);
      const nextRevision = task.currentRevisionNumber + 1;
      const nextAuthorityEpoch = task.authorityEpoch + 1;
      const updated = await transaction.analysisTask.updateMany({
        where: { id: task.id, version: input.expectedTaskVersion },
        data: {
          version: { increment: 1 },
          currentRevisionNumber: nextRevision,
          authorityEpoch: nextAuthorityEpoch,
          goalDigest
        }
      });
      if (updated.count !== 1) {
        throw this.optimisticConflict(task);
      }
      await transaction.analysisTaskRevision.update({
        where: { id: currentRevision.id },
        data: { status: "superseded" }
      });
      const revisionId = uuidv4();
      await transaction.analysisTaskRevision.create({
        data: {
          id: revisionId,
          taskId: task.id,
          revision: nextRevision,
          status: "active",
          goalContract: goalContractJson,
          goalDigest,
          principalDigest: input.principalDigest,
          authPolicyVersion: input.authPolicyVersion,
          createdByActorId: input.createdByActorId,
          supersedesRevisionId: currentRevision.id
        }
      });
      await this.appendEventInTransaction(transaction, {
        taskId: task.id,
        revisionId,
        idempotencyKey: `task-revised:${revisionId}`,
        eventType: "task.revised",
        visibility: "user",
        data: {
          revision: nextRevision,
          goalDigest,
          authorityEpoch: nextAuthorityEpoch
        }
      });
    });
    return this.getReadModel(input.taskId);
  }

  async createAttempt(input: {
    taskId: string;
    revisionId: string;
    idempotencyKey: string;
  }): Promise<AnalysisAttemptRecord> {
    const attemptId = uuidv4();
    await this.prisma.transaction(async (transaction) => {
      const existing = (await transaction.analysisAttempt.findUnique({
        where: {
          taskId_idempotencyKey: {
            taskId: input.taskId,
            idempotencyKey: input.idempotencyKey
          }
        }
      })) as AttemptRow | null;
      if (existing) {
        if (existing.revisionId !== input.revisionId) {
          throw new DomainError(
            "ANALYSIS_IDEMPOTENCY_CONFLICT",
            "Attempt idempotency key 已绑定其他 Revision。",
            409
          );
        }
        return;
      }
      const task = await this.requireTask(transaction, input.taskId);
      const revision = (await transaction.analysisTaskRevision.findUnique({
        where: { id: input.revisionId }
      })) as RevisionRow | null;
      if (!revision || revision.taskId !== task.id || revision.status !== "active") {
        throw new DomainError(
          "ANALYSIS_REVISION_NOT_CURRENT",
          "Attempt 必须绑定当前 active Revision。",
          409
        );
      }
      const lastAttempt = (await transaction.analysisAttempt.findFirst({
        where: { taskId: task.id },
        orderBy: { attempt: "desc" }
      })) as AttemptRow | null;
      const attempt = (lastAttempt?.attempt ?? 0) + 1;
      await transaction.analysisAttempt.create({
        data: {
          id: attemptId,
          taskId: task.id,
          revisionId: revision.id,
          attempt,
          status: "queued",
          authorityEpoch: task.authorityEpoch,
          idempotencyKey: input.idempotencyKey
        }
      });
      await this.appendEventInTransaction(transaction, {
        taskId: task.id,
        revisionId: revision.id,
        attemptId,
        idempotencyKey: `attempt-created:${input.idempotencyKey}`,
        eventType: "attempt.created",
        visibility: "user",
        data: { attempt, authorityEpoch: task.authorityEpoch }
      });
    });
    const created = (await this.prisma.requireClient().analysisAttempt.findUnique({
      where: {
        taskId_idempotencyKey: {
          taskId: input.taskId,
          idempotencyKey: input.idempotencyKey
        }
      }
    })) as AttemptRow | null;
    if (!created) {
      throw new DomainError("ANALYSIS_ATTEMPT_CREATE_FAILED", "创建 Attempt 失败。", 500);
    }
    return this.mapAttempt(created);
  }

  async appendEvent(input: {
    taskId: string;
    revisionId?: string;
    attemptId?: string;
    idempotencyKey: string;
    eventType: string;
    visibility?: AnalysisVisibility;
    data: Record<string, unknown>;
  }): Promise<AnalysisEvent> {
    const event = await this.prisma.transaction((transaction) =>
      this.appendEventInTransaction(transaction, {
        ...input,
        visibility: input.visibility ?? "user"
      })
    );
    return this.mapEvent(event);
  }

  async transitionTask(input: {
    taskId: string;
    expectedTaskVersion: number;
    expectedAuthorityEpoch: number;
    nextStatus: AnalysisTaskStatus;
    eventType: string;
    idempotencyKey: string;
    incrementAuthorityEpoch?: boolean;
    terminal?: boolean;
    data?: Record<string, unknown>;
  }): Promise<AnalysisTaskReadModel> {
    await this.prisma.transaction(async (transaction) => {
      const task = await this.requireTask(transaction, input.taskId);
      const existingEvent = (await transaction.analysisEvent.findUnique({
        where: {
          taskId_idempotencyKey: {
            taskId: task.id,
            idempotencyKey: input.idempotencyKey
          }
        }
      })) as EventRow | null;
      if (existingEvent) {
        return;
      }
      if (
        task.version !== input.expectedTaskVersion ||
        task.authorityEpoch !== input.expectedAuthorityEpoch
      ) {
        throw this.optimisticConflict(task);
      }
      const authorityEpoch = input.incrementAuthorityEpoch
        ? task.authorityEpoch + 1
        : task.authorityEpoch;
      const updated = await transaction.analysisTask.updateMany({
        where: {
          id: task.id,
          version: input.expectedTaskVersion,
          authorityEpoch: input.expectedAuthorityEpoch
        },
        data: {
          status: input.nextStatus,
          version: { increment: 1 },
          authorityEpoch,
          terminalAt: input.terminal ? new Date() : null
        }
      });
      if (updated.count !== 1) {
        throw this.optimisticConflict(task);
      }
      const revision = await this.requireCurrentRevision(transaction, task);
      await this.appendEventInTransaction(transaction, {
        taskId: task.id,
        revisionId: revision.id,
        idempotencyKey: input.idempotencyKey,
        eventType: input.eventType,
        visibility: "user",
        data: {
          status: input.nextStatus,
          authorityEpoch,
          ...(input.data ?? {})
        }
      });
    });
    return this.getReadModel(input.taskId);
  }

  async getReadModel(taskId: string): Promise<AnalysisTaskReadModel> {
    const client = this.prisma.requireClient();
    const [task, revisions, attempts, events, artifacts, receipts, manifests] =
      await Promise.all([
        client.analysisTask.findUnique({ where: { id: taskId } }),
        client.analysisTaskRevision.findMany({
          where: { taskId },
          orderBy: { revision: "asc" }
        }),
        client.analysisAttempt.findMany({
          where: { taskId },
          orderBy: { attempt: "asc" }
        }),
        client.analysisEvent.findMany({
          where: { taskId },
          orderBy: { sequence: "asc" }
        }),
        client.analysisArtifact.findMany({
          where: { taskId },
          orderBy: { createdAt: "asc" },
          include: { payload: { select: { deletedAt: true } } }
        }),
        client.analysisReceipt.findMany({
          where: { taskId },
          orderBy: { createdAt: "asc" }
        }),
        client.analysisManifest.findMany({
          where: { taskId },
          orderBy: { sealedAt: "asc" }
        })
      ]);
    if (!task) {
      throw new DomainError("ANALYSIS_TASK_NOT_FOUND", "未找到 AnalysisTask。", 404);
    }
    const mappedRevisions = (revisions as RevisionRow[]).map((row) =>
      this.mapRevision(row)
    );
    const mappedTask = this.mapTask(task as TaskRow);
    const currentRevision = mappedRevisions.find(
      (revision) => revision.revision === mappedTask.currentRevisionNumber
    );
    if (!currentRevision) {
      throw new DomainError(
        "ANALYSIS_LEDGER_INCONSISTENT",
        "Task 当前 Revision 不存在。",
        500
      );
    }
    return {
      task: mappedTask,
      currentRevision,
      attempts: (attempts as AttemptRow[]).map((row) => this.mapAttempt(row)),
      events: (events as EventRow[]).map((row) => this.mapEvent(row)),
      artifacts: (artifacts as ArtifactRow[]).map((row) => this.mapArtifact(row)),
      receipts: (receipts as ReceiptRow[]).map((row) => this.mapReceipt(row)),
      manifests: (manifests as ManifestRow[]).map((row) => this.mapManifest(row))
    };
  }

  async getTask(taskId: string): Promise<AnalysisTaskRecord | null> {
    const row = (await this.prisma.requireClient().analysisTask.findUnique({
      where: { id: taskId }
    })) as TaskRow | null;
    return row ? this.mapTask(row) : null;
  }

  async listTasks(input: {
    workspaceId: string;
    createdByActorId?: string;
    limit?: number;
  }): Promise<AnalysisTaskRecord[]> {
    const rows = (await this.prisma.requireClient().analysisTask.findMany({
      where: {
        workspaceId: input.workspaceId,
        ...(input.createdByActorId
          ? { createdByActorId: input.createdByActorId }
          : {})
      },
      orderBy: { updatedAt: "desc" },
      take: Math.max(1, Math.min(input.limit ?? 50, 100))
    })) as TaskRow[];
    return rows.map((row) => this.mapTask(row));
  }

  async listEvents(input: {
    taskId: string;
    afterSequence?: number;
    limit?: number;
  }): Promise<AnalysisEvent[]> {
    const rows = (await this.prisma.requireClient().analysisEvent.findMany({
      where: {
        taskId: input.taskId,
        ...(input.afterSequence
          ? { sequence: { gt: input.afterSequence } }
          : {})
      },
      orderBy: { sequence: "asc" },
      take: Math.max(1, Math.min(input.limit ?? 200, 1_000))
    })) as EventRow[];
    return rows.map((row) => this.mapEvent(row));
  }

  async findByWorkspaceAndIdempotencyKey(
    workspaceId: string,
    idempotencyKey: string
  ): Promise<AnalysisTaskRecord | null> {
    const row = (await this.prisma.requireClient().analysisTask.findUnique({
      where: {
        workspaceId_idempotencyKey: { workspaceId, idempotencyKey }
      }
    })) as TaskRow | null;
    return row ? this.mapTask(row) : null;
  }

  private async appendEventInTransaction(
    transaction: AnalysisPrismaClient,
    input: {
      taskId: string;
      revisionId?: string;
      attemptId?: string;
      idempotencyKey: string;
      eventType: string;
      visibility: AnalysisVisibility;
      data: Record<string, unknown>;
    }
  ): Promise<EventRow> {
    await this.requireTask(transaction, input.taskId);
    await transaction.analysisTask.update({
      where: { id: input.taskId },
      data: { updatedAt: new Date() }
    });
    const existing = (await transaction.analysisEvent.findUnique({
      where: {
        taskId_idempotencyKey: {
          taskId: input.taskId,
          idempotencyKey: input.idempotencyKey
        }
      }
    })) as EventRow | null;
    if (existing) {
      return existing;
    }
    const lastEvent = (await transaction.analysisEvent.findFirst({
      where: { taskId: input.taskId },
      orderBy: { sequence: "desc" }
    })) as EventRow | null;
    return (await transaction.analysisEvent.create({
      data: {
        id: uuidv4(),
        taskId: input.taskId,
        revisionId: input.revisionId ?? null,
        attemptId: input.attemptId ?? null,
        sequence: (lastEvent?.sequence ?? 0) + 1,
        idempotencyKey: input.idempotencyKey,
        eventType: input.eventType,
        visibility: input.visibility,
        data: stableJson(input.data)
      }
    })) as EventRow;
  }

  private async requireTask(
    transaction: AnalysisPrismaClient,
    taskId: string
  ): Promise<TaskRow> {
    const task = (await transaction.analysisTask.findUnique({
      where: { id: taskId }
    })) as TaskRow | null;
    if (!task) {
      throw new DomainError("ANALYSIS_TASK_NOT_FOUND", "未找到 AnalysisTask。", 404);
    }
    return task;
  }

  private async requireCurrentRevision(
    transaction: AnalysisPrismaClient,
    task: TaskRow
  ): Promise<RevisionRow> {
    const revision = (await transaction.analysisTaskRevision.findUnique({
      where: {
        taskId_revision: {
          taskId: task.id,
          revision: task.currentRevisionNumber
        }
      }
    })) as RevisionRow | null;
    if (!revision) {
      throw new DomainError(
        "ANALYSIS_LEDGER_INCONSISTENT",
        "Task 当前 Revision 不存在。",
        500
      );
    }
    return revision;
  }

  private optimisticConflict(task: TaskRow): DomainError {
    return new DomainError(
      "ANALYSIS_TASK_VERSION_CONFLICT",
      "Task version 或 authority epoch 已变化，请刷新后重试。",
      409,
      { version: task.version, authorityEpoch: task.authorityEpoch }
    );
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return Boolean(
      error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
    );
  }

  private mapTask(row: TaskRow): AnalysisTaskRecord {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      createdByActorId: row.createdByActorId,
      status: row.status as AnalysisTaskStatus,
      version: row.version,
      currentRevisionNumber: row.currentRevisionNumber,
      authorityEpoch: row.authorityEpoch,
      goalDigest: row.goalDigest,
      retentionExpiresAt: toIso(row.retentionExpiresAt),
      terminalAt: toIso(row.terminalAt),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private mapRevision(row: RevisionRow): AnalysisTaskRevisionRecord {
    return {
      id: row.id,
      taskId: row.taskId,
      revision: row.revision,
      status: row.status as AnalysisTaskRevisionRecord["status"],
      goalContract: parseJson<AnalysisGoalContract>(row.goalContract, {
        version: "analysis-goal.v1",
        objective: "unavailable",
        decisionUse: "unavailable",
        workspaceId: "unavailable",
        datasourceIds: [],
        allowedSourceKinds: [],
        deliverables: [],
        budget: {
          maxDurationMs: 0,
          maxTokenCount: 0,
          maxQueryCount: 0,
          maxSearchCount: 0,
          maxArtifactBytes: 0
        },
        riskLevel: "high",
        stopConditions: []
      }),
      goalDigest: row.goalDigest,
      principalDigest: row.principalDigest,
      authPolicyVersion: row.authPolicyVersion,
      createdByActorId: row.createdByActorId,
      supersedesRevisionId: row.supersedesRevisionId,
      createdAt: row.createdAt.toISOString()
    };
  }

  private mapAttempt(row: AttemptRow): AnalysisAttemptRecord {
    return {
      id: row.id,
      taskId: row.taskId,
      revisionId: row.revisionId,
      attempt: row.attempt,
      status: row.status as AnalysisAttemptRecord["status"],
      authorityEpoch: row.authorityEpoch,
      idempotencyKey: row.idempotencyKey,
      failureReasonCode: row.failureReasonCode,
      startedAt: toIso(row.startedAt),
      endedAt: toIso(row.endedAt),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
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
      visibility: row.visibility as AnalysisVisibility,
      at: row.createdAt.toISOString(),
      data: parseJson<Record<string, unknown>>(row.data, {})
    };
  }

  private mapArtifact(row: ArtifactRow): AnalysisArtifactMetadata {
    return {
      id: row.id,
      taskId: row.taskId,
      revisionId: row.revisionId,
      attemptId: row.attemptId,
      artifactType: row.artifactType,
      schemaVersion: row.schemaVersion,
      status: row.status as AnalysisArtifactMetadata["status"],
      classification: row.classification as AnalysisArtifactMetadata["classification"],
      visibility: row.visibility as AnalysisVisibility,
      payloadDigest: row.payloadDigest,
      payloadSizeBytes: row.payloadSizeBytes,
      completeness: row.completeness as AnalysisArtifactMetadata["completeness"],
      retentionExpiresAt: toIso(row.retentionExpiresAt),
      payloadAvailable: Boolean(row.payload && !row.payload.deletedAt),
      staleAt: toIso(row.staleAt),
      invalidatedAt: toIso(row.invalidatedAt),
      createdAt: row.createdAt.toISOString()
    };
  }

  private mapReceipt(row: ReceiptRow): AnalysisReceiptRecord {
    return {
      id: row.id,
      taskId: row.taskId,
      revisionId: row.revisionId,
      attemptId: row.attemptId,
      artifactId: row.artifactId,
      receiptType: row.receiptType,
      subjectType: row.subjectType,
      subjectRef: row.subjectRef,
      subjectDigest: row.subjectDigest,
      decision: row.decision as AnalysisReceiptRecord["decision"],
      reasonCodes: row.reasonCodes,
      authorityEpoch: row.authorityEpoch,
      principalDigest: row.principalDigest,
      policyRefs: parseJson<Record<string, string>>(row.policyRefs, {}),
      createdAt: row.createdAt.toISOString()
    };
  }

  private mapManifest(row: ManifestRow): AnalysisManifestRecord {
    return {
      id: row.id,
      taskId: row.taskId,
      revisionId: row.revisionId,
      attemptId: row.attemptId,
      manifestType: row.manifestType,
      schemaVersion: row.schemaVersion,
      status: row.status as AnalysisManifestRecord["status"],
      digest: row.digest,
      artifactRefs: parseJson<string[]>(row.artifactRefs, []),
      receiptRefs: parseJson<string[]>(row.receiptRefs, []),
      limitations: parseJson<string[]>(row.limitations, []),
      staleAt: toIso(row.staleAt),
      sealedAt: row.sealedAt.toISOString(),
      createdAt: row.createdAt.toISOString()
    };
  }
}
