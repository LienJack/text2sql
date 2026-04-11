import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type {
  ChatMessage,
  EvaluationReport,
  Session,
  SessionSyncStatus,
  SqlRun
} from "@text2sql/shared-types";
import { AppConfigService } from "../../config/app-config.service";

type PrismaClientLike = {
  session: {
    create: (args: Record<string, unknown>) => Promise<unknown>;
    findUnique: (args: Record<string, unknown>) => Promise<unknown>;
    findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
    update: (args: Record<string, unknown>) => Promise<unknown>;
    upsert: (args: Record<string, unknown>) => Promise<unknown>;
  };
  message: {
    create: (args: Record<string, unknown>) => Promise<unknown>;
    findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
    upsert: (args: Record<string, unknown>) => Promise<unknown>;
  };
  sqlRun: {
    create: (args: Record<string, unknown>) => Promise<unknown>;
    findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
    findUnique: (args: Record<string, unknown>) => Promise<unknown>;
    upsert: (args: Record<string, unknown>) => Promise<unknown>;
  };
  evaluationReport: {
    create: (args: Record<string, unknown>) => Promise<unknown>;
    findUnique: (args: Record<string, unknown>) => Promise<unknown>;
    upsert: (args: Record<string, unknown>) => Promise<unknown>;
  };
  $disconnect: () => Promise<void>;
};

type SessionRow = {
  id: string;
  datasource: string;
  title: string;
  modelCatalogId: string | null;
  modelProvider: string | null;
  modelName: string | null;
  debugEnabled: boolean;
  syncStatus: string;
  syncFailedCount: number;
  lastMessageAt: Date | null;
  lastSyncFailureAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
};

type SqlRunRow = {
  runId: string;
  sessionId: string;
  status: SqlRun["status"];
  provider: string;
  model: string | null;
  question: string;
  sql: string | null;
  explanation: string | null;
  answer: string | null;
  columns: string | null;
  rows: string | null;
  error: string | null;
  clarification: string | null;
  trace: string;
  llmRaw: string | null;
  createdAt: Date;
};

type SessionPatch = Partial<
  Pick<
    Session,
    | "title"
    | "modelCatalogId"
    | "modelProvider"
    | "modelName"
    | "debugEnabled"
    | "lastMessageAt"
    | "syncStatus"
    | "syncFailedCount"
    | "lastSyncFailureAt"
    | "deletedAt"
  >
>;

@Injectable()
export class ChatRepository implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatRepository.name);
  private prisma?: PrismaClientLike;
  private readonly sessions = new Map<string, Session>();
  private readonly messages = new Map<string, ChatMessage[]>();
  private readonly runs = new Map<string, SqlRun>();
  private readonly reports = new Map<string, EvaluationReport>();

  constructor(private readonly appConfig: AppConfigService) {}

  async onModuleInit(): Promise<void> {
    if (!this.isPrimaryPersistenceConfigured()) {
      return;
    }
    try {
      const prismaClientModulePath = "../../../generated/prisma/client";
      const prismaModule = (await import(prismaClientModulePath)) as unknown as {
        PrismaClient?: new (...args: unknown[]) => PrismaClientLike;
        default?: {
          PrismaClient?: new (...args: unknown[]) => PrismaClientLike;
        };
      };
      const adapterModule = (await import("@prisma/adapter-pg")) as unknown as {
        PrismaPg?: new (...args: unknown[]) => unknown;
        default?: {
          PrismaPg?: new (...args: unknown[]) => unknown;
        };
      };
      const PrismaCtor =
        prismaModule.PrismaClient ?? prismaModule.default?.PrismaClient;
      const PrismaPgCtor =
        adapterModule.PrismaPg ?? adapterModule.default?.PrismaPg;
      if (!PrismaCtor) {
        throw new Error("PrismaClient 未生成，请先执行 prisma generate");
      }
      if (!PrismaPgCtor) {
        throw new Error("Prisma PostgreSQL adapter 未安装");
      }
      const adapter = new PrismaPgCtor({
        connectionString: this.appConfig.databaseUrl
      });
      this.prisma = new PrismaCtor({
        adapter
      }) as PrismaClientLike;
      this.logger.log("Prisma 已启用，会话与运行记录将持久化到 PostgreSQL。");
    } catch (error) {
      this.logger.warn(
        `Prisma 初始化失败，降级为内存持久化: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.prisma) {
      await this.prisma.$disconnect();
    }
  }

  async createSession(session: Session): Promise<void> {
    const normalized = this.withSessionDefaults(session);
    this.sessions.set(normalized.id, normalized);
    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return;
    }
    await this.tryPrismaWrite(async () => {
      await this.prisma?.session.upsert({
        where: { id: normalized.id },
        update: this.toSessionWriteData(normalized),
        create: {
          id: normalized.id,
          datasource: normalized.datasource,
          ...this.toSessionWriteData(normalized)
        }
      });
    });
  }

  async listSessions(options?: {
    includeDeleted?: boolean;
    statuses?: SessionSyncStatus[];
  }): Promise<Session[]> {
    const includeDeleted = options?.includeDeleted ?? false;
    const statusFilter = options?.statuses;

    const memory = Array.from(this.sessions.values());
    const fromMemory = this.filterAndSortSessions(memory, includeDeleted, statusFilter);

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return fromMemory;
    }

    const rows = (await this.tryPrismaRead(async () =>
      this.prisma?.session.findMany({
        where: includeDeleted ? {} : { deletedAt: null }
      })
    )) as SessionRow[] | null;

    if (!rows) {
      return fromMemory;
    }

    const merged = new Map<string, Session>();
    for (const row of rows) {
      const session = this.fromSessionRow(row);
      merged.set(session.id, session);
      this.sessions.set(session.id, session);
    }
    for (const session of fromMemory) {
      merged.set(session.id, session);
    }

    return this.filterAndSortSessions(
      Array.from(merged.values()),
      includeDeleted,
      statusFilter
    );
  }

  async getSessionById(
    sessionId: string,
    options?: { includeDeleted?: boolean }
  ): Promise<Session | undefined> {
    const includeDeleted = options?.includeDeleted ?? false;
    const memoryValue = this.sessions.get(sessionId);
    if (memoryValue) {
      if (!includeDeleted && memoryValue.deletedAt) {
        return undefined;
      }
      return memoryValue;
    }

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return undefined;
    }

    const row = (await this.tryPrismaRead(async () =>
      this.prisma?.session.findUnique({
        where: { id: sessionId }
      })
    )) as SessionRow | null;

    if (!row) {
      return undefined;
    }

    const session = this.fromSessionRow(row);
    this.sessions.set(session.id, session);
    if (!includeDeleted && session.deletedAt) {
      return undefined;
    }
    return session;
  }

  async renameSession(sessionId: string, title: string): Promise<Session | undefined> {
    return this.patchSession(sessionId, {
      title
    });
  }

  async updateSession(
    sessionId: string,
    patch: Pick<
      SessionPatch,
      "title" | "debugEnabled" | "modelCatalogId" | "modelProvider" | "modelName"
    >
  ): Promise<Session | undefined> {
    return this.patchSession(sessionId, patch);
  }

  async ensureSessionTitleFromFirstMessage(
    sessionId: string,
    message: string
  ): Promise<Session | undefined> {
    const session = await this.getSessionById(sessionId);
    if (!session) {
      return undefined;
    }
    const current = (session.title ?? "").trim();
    if (current && current !== "新会话") {
      return session;
    }
    return this.patchSession(sessionId, {
      title: this.generateSessionTitle(message)
    });
  }

  async markSessionMessageActivity(
    sessionId: string,
    messageAt: string
  ): Promise<Session | undefined> {
    const existing = await this.getSessionById(sessionId);
    if (!existing) {
      return undefined;
    }

    const current = existing.lastMessageAt;
    const nextLastMessageAt =
      !current || current < messageAt ? messageAt : current;

    return this.patchSession(sessionId, {
      lastMessageAt: nextLastMessageAt
    });
  }

  async markSessionSyncPending(sessionId: string, failedAt: string): Promise<void> {
    const session = await this.getSessionById(sessionId);
    if (!session) {
      return;
    }
    const firstFailureAt = session.lastSyncFailureAt ?? failedAt;
    const failedCount = (session.syncFailedCount ?? 0) + 1;
    const degraded =
      failedCount >= 5 &&
      Date.parse(failedAt) - Date.parse(firstFailureAt) >= 5 * 60 * 1000;

    await this.patchSession(sessionId, {
      syncStatus: degraded ? "degraded" : "pending",
      syncFailedCount: failedCount,
      lastSyncFailureAt: firstFailureAt
    });
  }

  async markSessionSyncHealthy(sessionId: string): Promise<void> {
    const session = await this.getSessionById(sessionId);
    if (!session) {
      return;
    }
    await this.patchSession(sessionId, {
      syncStatus: "healthy",
      syncFailedCount: 0,
      lastSyncFailureAt: null
    });
  }

  async softDeleteSession(sessionId: string): Promise<Session | undefined> {
    const session = await this.getSessionById(sessionId);
    if (!session) {
      return undefined;
    }
    return this.patchSession(sessionId, {
      deletedAt: new Date().toISOString()
    });
  }

  async getSessionSyncStats(): Promise<{
    total: number;
    healthy: number;
    pending: number;
    degraded: number;
  }> {
    const sessions = await this.listSessions();
    let healthy = 0;
    let pending = 0;
    let degraded = 0;
    for (const session of sessions) {
      const status = session.syncStatus ?? "healthy";
      if (status === "healthy") {
        healthy += 1;
      } else if (status === "pending") {
        pending += 1;
      } else if (status === "degraded") {
        degraded += 1;
      }
    }
    return {
      total: sessions.length,
      healthy,
      pending,
      degraded
    };
  }

  async persistMessage(
    message: ChatMessage
  ): Promise<{ primaryPersisted: boolean }> {
    const list = this.messages.get(message.sessionId) ?? [];
    if (!list.some((item) => item.id === message.id)) {
      list.push(message);
      this.messages.set(message.sessionId, list);
    }

    await this.markSessionMessageActivity(message.sessionId, message.createdAt);

    if (!this.isPrimaryPersistenceConfigured()) {
      return { primaryPersisted: true };
    }
    if (!this.prisma) {
      return { primaryPersisted: false };
    }

    const persisted = await this.tryPrismaWrite(async () => {
      await this.prisma?.message.upsert({
        where: { id: message.id },
        update: {
          role: message.role,
          content: message.content,
          metadata: message.metadata ? JSON.stringify(message.metadata) : null,
          createdAt: new Date(message.createdAt)
        },
        create: {
          id: message.id,
          sessionId: message.sessionId,
          role: message.role,
          content: message.content,
          metadata: message.metadata ? JSON.stringify(message.metadata) : null,
          createdAt: new Date(message.createdAt)
        }
      });
      await this.prisma?.session.update({
        where: { id: message.sessionId },
        data: {
          lastMessageAt: new Date(message.createdAt)
        }
      });
    });

    return { primaryPersisted: persisted };
  }

  async getMessages(
    sessionId: string,
    page = 1,
    pageSize = 0
  ): Promise<ChatMessage[]> {
    const inMemory = this.messages.get(sessionId) ?? [];
    if (inMemory.length > 0 || !this.prisma) {
      return this.paginate(inMemory, page, pageSize);
    }

    const query: {
      where: { sessionId: string };
      orderBy: { createdAt: "asc" };
      skip?: number;
      take?: number;
    } = {
      where: { sessionId },
      orderBy: { createdAt: "asc" }
    };
    if (pageSize > 0) {
      query.skip = (page - 1) * pageSize;
      query.take = pageSize;
    }

    const rows = (await this.tryPrismaRead(async () =>
      this.prisma?.message.findMany(query)
    )) as Array<{
      id: string;
      sessionId: string;
      role: "user" | "assistant" | "system";
      content: string;
      metadata: string | null;
      createdAt: Date;
    }> | null;

    if (!rows) {
      return this.paginate(inMemory, page, pageSize);
    }

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      role: row.role,
      content: row.content,
      metadata: row.metadata
        ? (JSON.parse(row.metadata) as Record<string, unknown>)
        : undefined,
      createdAt: row.createdAt.toISOString()
    }));
  }

  async persistRun(run: SqlRun): Promise<void> {
    this.runs.set(run.runId, run);
    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return;
    }
    await this.tryPrismaWrite(async () => {
      await this.prisma?.sqlRun.upsert({
        where: { runId: run.runId },
        update: {
          status: run.status,
          provider: run.provider,
          model: run.model ?? null,
          question: run.question,
          sql: run.sql ?? null,
          explanation: run.explanation ?? null,
          answer: run.answer ?? null,
          columns: run.columns ? JSON.stringify(run.columns) : null,
          rows: run.rows ? JSON.stringify(run.rows) : null,
          error: run.error ?? null,
          clarification: run.clarification ? JSON.stringify(run.clarification) : null,
          trace: JSON.stringify(run.trace),
          llmRaw: run.llmRaw ? JSON.stringify(run.llmRaw) : null,
          createdAt: new Date(run.createdAt)
        },
        create: {
          runId: run.runId,
          sessionId: run.sessionId,
          status: run.status,
          provider: run.provider,
          model: run.model ?? null,
          question: run.question,
          sql: run.sql ?? null,
          explanation: run.explanation ?? null,
          answer: run.answer ?? null,
          columns: run.columns ? JSON.stringify(run.columns) : null,
          rows: run.rows ? JSON.stringify(run.rows) : null,
          error: run.error ?? null,
          clarification: run.clarification ? JSON.stringify(run.clarification) : null,
          trace: JSON.stringify(run.trace),
          llmRaw: run.llmRaw ? JSON.stringify(run.llmRaw) : null,
          createdAt: new Date(run.createdAt)
        }
      });
    });
  }

  async getRunById(runId: string): Promise<SqlRun | undefined> {
    const memory = this.runs.get(runId);
    if (memory) {
      return memory;
    }
    if (!this.prisma) {
      return undefined;
    }
    const row = (await this.tryPrismaRead(async () =>
      this.prisma?.sqlRun.findUnique({
        where: { runId }
      })
    )) as SqlRunRow | null;
    if (!row) {
      return undefined;
    }
    const run = this.fromSqlRunRow(row);
    this.runs.set(run.runId, run);
    return run;
  }

  async getLatestRunBySessionId(sessionId: string): Promise<SqlRun | undefined> {
    const inMemory = Array.from(this.runs.values())
      .filter((run) => run.sessionId === sessionId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

    if (inMemory.length > 0 || !this.prisma) {
      return inMemory[0];
    }

    const rows = (await this.tryPrismaRead(async () =>
      this.prisma?.sqlRun.findMany({
        where: { sessionId },
        orderBy: { createdAt: "desc" },
        take: 1
      })
    )) as SqlRunRow[] | null;

    const row = rows?.[0];
    if (!row) {
      return undefined;
    }
    const run = this.fromSqlRunRow(row);
    this.runs.set(run.runId, run);
    return run;
  }

  async persistEvaluationReport(report: EvaluationReport): Promise<void> {
    this.reports.set(report.jobId, report);
    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return;
    }
    await this.tryPrismaWrite(async () => {
      await this.prisma?.evaluationReport.upsert({
        where: { jobId: report.jobId },
        update: {
          provider: report.provider,
          total: report.total,
          passed: report.passed,
          passRate: report.passRate,
          payload: JSON.stringify(report),
          createdAt: new Date(report.createdAt)
        },
        create: {
          jobId: report.jobId,
          provider: report.provider,
          total: report.total,
          passed: report.passed,
          passRate: report.passRate,
          payload: JSON.stringify(report),
          createdAt: new Date(report.createdAt)
        }
      });
    });
  }

  async getEvaluationReport(jobId: string): Promise<EvaluationReport | undefined> {
    const memory = this.reports.get(jobId);
    if (memory) {
      return memory;
    }
    if (!this.prisma) {
      return undefined;
    }
    const row = (await this.tryPrismaRead(async () =>
      this.prisma?.evaluationReport.findUnique({
        where: { jobId }
      })
    )) as { payload: string } | null;
    if (!row) {
      return undefined;
    }
    const report = JSON.parse(row.payload) as EvaluationReport;
    this.reports.set(jobId, report);
    return report;
  }

  private async patchSession(
    sessionId: string,
    patch: SessionPatch
  ): Promise<Session | undefined> {
    const existing = await this.getSessionById(sessionId, { includeDeleted: true });
    if (!existing) {
      return undefined;
    }
    const next = this.withSessionDefaults({
      ...existing,
      ...patch
    });
    this.sessions.set(next.id, next);

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return next;
    }

    await this.tryPrismaWrite(async () => {
      await this.prisma?.session.update({
        where: { id: sessionId },
        data: this.toSessionWriteData(next)
      });
    });

    return next;
  }

  private withSessionDefaults(session: Session): Session {
    return {
      ...session,
      title: session.title ?? "新会话",
      modelCatalogId: session.modelCatalogId ?? null,
      modelProvider: session.modelProvider ?? null,
      modelName: session.modelName ?? null,
      debugEnabled: session.debugEnabled ?? false,
      syncStatus: session.syncStatus ?? "healthy",
      syncFailedCount: session.syncFailedCount ?? 0,
      lastSyncFailureAt: session.lastSyncFailureAt ?? null,
      deletedAt: session.deletedAt ?? null
    };
  }

  private fromSessionRow(row: SessionRow): Session {
    return {
      id: row.id,
      datasource: row.datasource,
      title: row.title,
      modelCatalogId: row.modelCatalogId,
      modelProvider: row.modelProvider,
      modelName: row.modelName,
      debugEnabled: row.debugEnabled,
      syncStatus: this.toSyncStatus(row.syncStatus),
      syncFailedCount: row.syncFailedCount,
      lastMessageAt: row.lastMessageAt ? row.lastMessageAt.toISOString() : undefined,
      lastSyncFailureAt: row.lastSyncFailureAt
        ? row.lastSyncFailureAt.toISOString()
        : null,
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString()
    };
  }

  private toSessionWriteData(session: Session): Record<string, unknown> {
    return {
      datasource: session.datasource,
      title: session.title ?? "新会话",
      modelCatalogId: session.modelCatalogId ?? null,
      modelProvider: session.modelProvider ?? null,
      modelName: session.modelName ?? null,
      debugEnabled: session.debugEnabled ?? false,
      syncStatus: session.syncStatus ?? "healthy",
      syncFailedCount: session.syncFailedCount ?? 0,
      lastMessageAt: session.lastMessageAt ? new Date(session.lastMessageAt) : null,
      lastSyncFailureAt: session.lastSyncFailureAt
        ? new Date(session.lastSyncFailureAt)
        : null,
      deletedAt: session.deletedAt ? new Date(session.deletedAt) : null,
      createdAt: new Date(session.createdAt)
    };
  }

  private fromSqlRunRow(row: SqlRunRow): SqlRun {
    return {
      runId: row.runId,
      sessionId: row.sessionId,
      status: row.status,
      provider: row.provider,
      model: row.model ?? undefined,
      question: row.question,
      sql: row.sql ?? undefined,
      explanation: row.explanation ?? undefined,
      answer: row.answer ?? undefined,
      columns: this.parseJsonSafely<string[]>(row.columns),
      rows: this.parseJsonSafely<Array<Record<string, unknown>>>(row.rows),
      error: row.error ?? undefined,
      clarification: this.parseJsonSafely<SqlRun["clarification"]>(
        row.clarification
      ),
      trace: (this.parseJsonSafely<SqlRun["trace"]>(row.trace) ?? {
        runId: row.runId,
        provider: row.provider,
        retryCount: 0,
        steps: []
      }) as SqlRun["trace"],
      llmRaw: this.parseJsonSafely<SqlRun["llmRaw"]>(row.llmRaw) ?? null,
      createdAt: row.createdAt.toISOString()
    };
  }

  private toSyncStatus(value: string): SessionSyncStatus {
    if (value === "pending" || value === "degraded") {
      return value;
    }
    return "healthy";
  }

  private filterAndSortSessions(
    sessions: Session[],
    includeDeleted: boolean,
    statuses?: SessionSyncStatus[]
  ): Session[] {
    const filtered = sessions.filter((session) => {
      if (!includeDeleted && session.deletedAt) {
        return false;
      }
      if (!statuses || statuses.length === 0) {
        return true;
      }
      return statuses.includes(session.syncStatus ?? "healthy");
    });

    return filtered.sort((left, right) => {
      const leftTime = left.lastMessageAt ?? left.createdAt;
      const rightTime = right.lastMessageAt ?? right.createdAt;
      if (leftTime === rightTime) {
        return right.createdAt.localeCompare(left.createdAt);
      }
      return rightTime.localeCompare(leftTime);
    });
  }

  private generateSessionTitle(message: string): string {
    const compact = message.replace(/\s+/g, " ").trim();
    if (!compact) {
      return "新会话";
    }
    const maxLength = 32;
    if (compact.length <= maxLength) {
      return compact;
    }
    return `${compact.slice(0, maxLength)}…`;
  }

  private isPrimaryPersistenceConfigured(): boolean {
    return Boolean(this.appConfig.databaseUrl);
  }

  private paginate<T>(items: T[], page: number, pageSize: number): T[] {
    if (pageSize <= 0) {
      return [...items];
    }
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    return items.slice(start, end);
  }

  private parseJsonSafely<T>(value: string | null): T | undefined {
    if (!value) {
      return undefined;
    }
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      this.logger.warn(
        `JSON 反序列化失败，已回退默认值: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return undefined;
    }
  }

  private async tryPrismaWrite(operation: () => Promise<void>): Promise<boolean> {
    try {
      await operation();
      return true;
    } catch (error) {
      this.disablePrisma(error);
      return false;
    }
  }

  private async tryPrismaRead<T>(
    operation: () => Promise<T | undefined>
  ): Promise<T | null> {
    try {
      const value = await operation();
      return value ?? null;
    } catch (error) {
      this.disablePrisma(error);
      return null;
    }
  }

  private disablePrisma(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(`PostgreSQL 持久化失败，已降级为内存模式: ${message}`);
    this.prisma = undefined;
  }
}
