import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { v4 as uuidv4 } from "uuid";
import { AppConfigService } from "../../config/app-config.service";

export type GovernanceAuditSeverity = "info" | "warning" | "error";

export type GovernanceAuditLog = {
  id: string;
  runId?: string | null;
  sessionId?: string | null;
  requestId?: string | null;
  phase: string;
  severity: GovernanceAuditSeverity;
  eventType: string;
  eventCode?: string | null;
  message: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
};

export type GovernanceAuditLogInput = {
  id?: string;
  runId?: string | null;
  sessionId?: string | null;
  requestId?: string | null;
  phase: string;
  severity?: GovernanceAuditSeverity;
  eventType: string;
  eventCode?: string | null;
  message: string;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
};

type PrismaClientLike = {
  agentAuditLog?: {
    create?: (args: Record<string, unknown>) => Promise<unknown>;
    findMany?: (args: Record<string, unknown>) => Promise<unknown[]>;
  };
  $disconnect: () => Promise<void>;
};

type AgentAuditLogRow = {
  id: string;
  runId: string | null;
  sessionId: string | null;
  requestId?: string | null;
  phase: string;
  severity: string;
  eventType: string;
  eventCode: string | null;
  message: string;
  metadata: string | null;
  createdAt: Date;
};

const AUDIT_SEVERITIES: ReadonlySet<string> = new Set(["info", "warning", "error"]);

@Injectable()
export class AuditLogRepository implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditLogRepository.name);
  private prisma?: PrismaClientLike;
  private readonly logs = new Map<string, GovernanceAuditLog>();

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
      const PrismaCtor = prismaModule.PrismaClient ?? prismaModule.default?.PrismaClient;
      const PrismaPgCtor = adapterModule.PrismaPg ?? adapterModule.default?.PrismaPg;
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
      this.logger.log("Governance audit 仓储已启用 PostgreSQL 持久化。");
    } catch (error) {
      this.logger.warn(
        `Governance audit 仓储初始化失败，降级为内存模式: ${
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

  async appendEvent(input: GovernanceAuditLogInput): Promise<GovernanceAuditLog> {
    const event = this.normalizeInput(input);
    this.logs.set(event.id, event);

    const auditModel = this.prisma?.agentAuditLog;
    if (
      !this.isPrimaryPersistenceConfigured() ||
      !this.prisma ||
      !auditModel?.create
    ) {
      return event;
    }

    await this.tryPrismaWrite(async () => {
      await auditModel.create?.({
        data: {
          id: event.id,
          runId: event.runId ?? null,
          sessionId: event.sessionId ?? null,
          phase: event.phase,
          severity: event.severity,
          eventType: event.eventType,
          eventCode: event.eventCode ?? null,
          message: event.message,
          metadata: this.stringifyMetadata(event.metadata),
          createdAt: new Date(event.createdAt)
        }
      });
    });

    return event;
  }

  async listEvents(options?: {
    eventType?: string;
    runId?: string;
    sessionId?: string;
    requestId?: string;
    limit?: number;
  }): Promise<GovernanceAuditLog[]> {
    const eventType = options?.eventType?.trim() || undefined;
    const runId = options?.runId?.trim() || undefined;
    const sessionId = options?.sessionId?.trim() || undefined;
    const requestId = options?.requestId?.trim() || undefined;
    const limit = Math.max(options?.limit ?? 50, 1);
    const requestIdMetadataPattern = requestId
      ? this.buildRequestIdMetadataPattern(requestId)
      : undefined;

    const fromMemory = this.filterLogs(Array.from(this.logs.values()), {
      eventType,
      runId,
      sessionId,
      requestId
    });

    const auditModel = this.prisma?.agentAuditLog;
    if (
      !this.isPrimaryPersistenceConfigured() ||
      !this.prisma ||
      !auditModel?.findMany
    ) {
      return fromMemory.slice(0, limit);
    }

    const rows = (await this.tryPrismaRead(async () =>
      auditModel.findMany?.({
        where: {
          ...(eventType ? { eventType } : {}),
          ...(runId ? { runId } : {}),
          ...(sessionId ? { sessionId } : {}),
          ...(requestIdMetadataPattern
            ? { metadata: { contains: requestIdMetadataPattern } }
            : {})
        },
        orderBy: {
          createdAt: "desc"
        },
        take: limit
      })
    )) as AgentAuditLogRow[] | null;

    if (!rows) {
      return fromMemory.slice(0, limit);
    }

    const merged = new Map<string, GovernanceAuditLog>();
    for (const row of rows) {
      const mapped = this.fromRow(row);
      merged.set(mapped.id, mapped);
      this.logs.set(mapped.id, mapped);
    }
    for (const item of fromMemory) {
      merged.set(item.id, item);
    }

    const sorted = this.filterLogs(Array.from(merged.values()), {
      eventType,
      runId,
      sessionId,
      requestId
    });
    return sorted.slice(0, limit);
  }

  private normalizeInput(input: GovernanceAuditLogInput): GovernanceAuditLog {
    const phase = input.phase?.trim();
    if (!phase) {
      throw new Error("audit phase 不能为空");
    }
    const eventType = input.eventType?.trim();
    if (!eventType) {
      throw new Error("audit eventType 不能为空");
    }
    const message = input.message?.trim();
    if (!message) {
      throw new Error("audit message 不能为空");
    }
    const severity = this.normalizeSeverity(input.severity ?? "info");
    const createdAt = this.toIso(input.createdAt);
    const requestId = this.normalizeRequestId(input.requestId, input.metadata);
    const metadata = this.withRequestIdMetadata(input.metadata, requestId);

    return {
      id: input.id ?? uuidv4(),
      runId: input.runId?.trim() || null,
      sessionId: input.sessionId?.trim() || null,
      requestId,
      phase,
      severity,
      eventType,
      eventCode: input.eventCode?.trim() || null,
      message,
      metadata,
      createdAt
    };
  }

  private normalizeSeverity(value: string): GovernanceAuditSeverity {
    const normalized = value.trim().toLowerCase();
    if (!AUDIT_SEVERITIES.has(normalized)) {
      return "info";
    }
    return normalized as GovernanceAuditSeverity;
  }

  private filterLogs(
    logs: GovernanceAuditLog[],
    filter: {
      eventType?: string;
      runId?: string;
      sessionId?: string;
      requestId?: string;
    }
  ): GovernanceAuditLog[] {
    return [...logs]
      .filter((item) => {
        if (filter.eventType && item.eventType !== filter.eventType) {
          return false;
        }
        if (filter.runId && item.runId !== filter.runId) {
          return false;
        }
        if (filter.sessionId && item.sessionId !== filter.sessionId) {
          return false;
        }
        if (filter.requestId && item.requestId !== filter.requestId) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private fromRow(row: AgentAuditLogRow): GovernanceAuditLog {
    return {
      id: row.id,
      runId: row.runId,
      sessionId: row.sessionId,
      requestId:
        this.normalizeRequestId(row.requestId, this.parseMetadata(row.metadata)) ?? null,
      phase: row.phase,
      severity: this.normalizeSeverity(row.severity),
      eventType: row.eventType,
      eventCode: row.eventCode,
      message: row.message,
      metadata: this.parseMetadata(row.metadata),
      createdAt: row.createdAt.toISOString()
    };
  }

  private stringifyMetadata(metadata?: Record<string, unknown> | null): string | null {
    if (!metadata) {
      return null;
    }
    try {
      return JSON.stringify(metadata);
    } catch {
      return null;
    }
  }

  private parseMetadata(metadata: string | null): Record<string, unknown> | null {
    if (!metadata) {
      return null;
    }
    try {
      const parsed = JSON.parse(metadata) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private toIso(value?: string): string {
    if (!value) {
      return new Date().toISOString();
    }
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) {
      return new Date().toISOString();
    }
    return date.toISOString();
  }

  private normalizeRequestId(
    value: string | null | undefined,
    metadata?: Record<string, unknown> | null
  ): string | null {
    const direct = value?.trim();
    if (direct) {
      return direct;
    }
    const metadataRequestId = metadata?.requestId;
    if (typeof metadataRequestId === "string" && metadataRequestId.trim()) {
      return metadataRequestId.trim();
    }
    return null;
  }

  private withRequestIdMetadata(
    metadata: Record<string, unknown> | null | undefined,
    requestId: string | null
  ): Record<string, unknown> | null {
    if (!requestId) {
      return metadata ?? null;
    }
    const next = { ...(metadata ?? {}) };
    next.requestId = requestId;
    return next;
  }

  private buildRequestIdMetadataPattern(requestId: string): string {
    return `"requestId":${JSON.stringify(requestId)}`;
  }

  private isPrimaryPersistenceConfigured(): boolean {
    return Boolean(this.appConfig.databaseUrl);
  }

  private async tryPrismaRead<T>(read: () => Promise<T>): Promise<T | null> {
    try {
      return await read();
    } catch (error) {
      this.logger.warn(
        `Governance audit 仓储读取失败，已使用内存结果: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }

  private async tryPrismaWrite(write: () => Promise<void>): Promise<void> {
    try {
      await write();
    } catch (error) {
      this.logger.warn(
        `Governance audit 仓储写入失败，仅写入内存: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
