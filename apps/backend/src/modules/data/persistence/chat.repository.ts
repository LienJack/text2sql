import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type {
  ChatMessage,
  EvaluationReport,
  Session,
  SqlRun
} from "@text2sql/shared-types";
import { AppConfigService } from "../../config/app-config.service";

type PrismaClientLike = {
  session: {
    create: (args: Record<string, unknown>) => Promise<unknown>;
    findUnique: (args: Record<string, unknown>) => Promise<unknown>;
  };
  message: {
    create: (args: Record<string, unknown>) => Promise<unknown>;
    findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
  };
  sqlRun: {
    create: (args: Record<string, unknown>) => Promise<unknown>;
    findUnique: (args: Record<string, unknown>) => Promise<unknown>;
  };
  evaluationReport: {
    create: (args: Record<string, unknown>) => Promise<unknown>;
    findUnique: (args: Record<string, unknown>) => Promise<unknown>;
  };
  $disconnect: () => Promise<void>;
};

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
    if (!this.appConfig.databaseUrl) {
      return;
    }
    try {
      const prismaModule = (await import("@prisma/client")) as unknown as {
        PrismaClient?: new (...args: unknown[]) => PrismaClientLike;
        default?: {
          PrismaClient?: new (...args: unknown[]) => PrismaClientLike;
        };
      };
      const PrismaCtor =
        prismaModule.PrismaClient ?? prismaModule.default?.PrismaClient;
      if (!PrismaCtor) {
        throw new Error("PrismaClient 未生成，请先执行 prisma generate");
      }
      this.prisma = new PrismaCtor({
        datasources: {
          db: {
            url: this.appConfig.databaseUrl
          }
        }
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
    this.sessions.set(session.id, session);
    if (!this.prisma) {
      return;
    }
    await this.prisma.session.create({
      data: {
        id: session.id,
        datasource: session.datasource,
        createdAt: new Date(session.createdAt)
      }
    });
  }

  async getSessionById(sessionId: string): Promise<Session | undefined> {
    const memoryValue = this.sessions.get(sessionId);
    if (memoryValue) {
      return memoryValue;
    }
    if (!this.prisma) {
      return undefined;
    }
    const row = (await this.prisma.session.findUnique({
      where: { id: sessionId }
    })) as { id: string; datasource: string; createdAt: Date } | null;
    if (!row) {
      return undefined;
    }
    const session: Session = {
      id: row.id,
      datasource: row.datasource,
      createdAt: row.createdAt.toISOString()
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async persistMessage(message: ChatMessage): Promise<void> {
    const list = this.messages.get(message.sessionId) ?? [];
    list.push(message);
    this.messages.set(message.sessionId, list);
    if (!this.prisma) {
      return;
    }
    await this.prisma.message.create({
      data: {
        id: message.id,
        sessionId: message.sessionId,
        role: message.role,
        content: message.content,
        metadata: message.metadata ? JSON.stringify(message.metadata) : null,
        createdAt: new Date(message.createdAt)
      }
    });
  }

  async getMessages(
    sessionId: string,
    page = 1,
    pageSize = 50
  ): Promise<ChatMessage[]> {
    const inMemory = this.messages.get(sessionId) ?? [];
    if (inMemory.length > 0 || !this.prisma) {
      return this.paginate(inMemory, page, pageSize);
    }
    const rows = (await this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize
    })) as Array<{
      id: string;
      sessionId: string;
      role: "user" | "assistant" | "system";
      content: string;
      metadata: string | null;
      createdAt: Date;
    }>;
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      role: row.role,
      content: row.content,
      metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : undefined,
      createdAt: row.createdAt.toISOString()
    }));
  }

  async persistRun(run: SqlRun): Promise<void> {
    this.runs.set(run.runId, run);
    if (!this.prisma) {
      return;
    }
    await this.prisma.sqlRun.create({
      data: {
        runId: run.runId,
        sessionId: run.sessionId,
        status: run.status,
        provider: run.provider,
        question: run.question,
        sql: run.sql ?? null,
        explanation: run.explanation ?? null,
        answer: run.answer ?? null,
        columns: run.columns ? JSON.stringify(run.columns) : null,
        rows: run.rows ? JSON.stringify(run.rows) : null,
        error: run.error ?? null,
        clarification: run.clarification ? JSON.stringify(run.clarification) : null,
        trace: JSON.stringify(run.trace),
        createdAt: new Date(run.createdAt)
      }
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
    const row = (await this.prisma.sqlRun.findUnique({
      where: { runId }
    })) as
      | {
          runId: string;
          sessionId: string;
          status: SqlRun["status"];
          provider: string;
          question: string;
          sql: string | null;
          explanation: string | null;
          answer: string | null;
          columns: string | null;
          rows: string | null;
          error: string | null;
          clarification: string | null;
          trace: string;
          createdAt: Date;
        }
      | null;
    if (!row) {
      return undefined;
    }
    const run: SqlRun = {
      runId: row.runId,
      sessionId: row.sessionId,
      status: row.status,
      provider: row.provider,
      question: row.question,
      sql: row.sql ?? undefined,
      explanation: row.explanation ?? undefined,
      answer: row.answer ?? undefined,
      columns: row.columns ? (JSON.parse(row.columns) as string[]) : undefined,
      rows: row.rows
        ? (JSON.parse(row.rows) as Array<Record<string, unknown>>)
        : undefined,
      error: row.error ?? undefined,
      clarification: row.clarification
        ? (JSON.parse(row.clarification) as SqlRun["clarification"])
        : undefined,
      trace: JSON.parse(row.trace) as SqlRun["trace"],
      createdAt: row.createdAt.toISOString()
    };
    this.runs.set(run.runId, run);
    return run;
  }

  async persistEvaluationReport(report: EvaluationReport): Promise<void> {
    this.reports.set(report.jobId, report);
    if (!this.prisma) {
      return;
    }
    await this.prisma.evaluationReport.create({
      data: {
        jobId: report.jobId,
        provider: report.provider,
        total: report.total,
        passed: report.passed,
        passRate: report.passRate,
        payload: JSON.stringify(report),
        createdAt: new Date(report.createdAt)
      }
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
    const row = (await this.prisma.evaluationReport.findUnique({
      where: { jobId }
    })) as { payload: string } | null;
    if (!row) {
      return undefined;
    }
    const report = JSON.parse(row.payload) as EvaluationReport;
    this.reports.set(jobId, report);
    return report;
  }

  private paginate<T>(items: T[], page: number, pageSize: number): T[] {
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    return items.slice(start, end);
  }
}
