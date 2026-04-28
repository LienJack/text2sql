import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type {
  RagConfigHealthStatus,
  RagTaskConfig,
  RagTaskType
} from "@text2sql/shared-types";
import { v4 as uuidv4 } from "uuid";
import { AppConfigService } from "../../config/app-config.service";

type PrismaClientLike = {
  ragTaskConfig: {
    upsert: (args: Record<string, unknown>) => Promise<unknown>;
    findMany: (args?: Record<string, unknown>) => Promise<unknown[]>;
    findUnique: (args: Record<string, unknown>) => Promise<unknown>;
    update: (args: Record<string, unknown>) => Promise<unknown>;
  };
  $disconnect: () => Promise<void>;
};

type RagTaskConfigRow = {
  id: string;
  taskType: string;
  provider: string;
  model: string;
  baseUrl: string | null;
  apiKeyCiphertext: string | null;
  apiKeyMasked: string | null;
  enabled: boolean;
  dimensions: number | null;
  vectorVersion: string | null;
  timeoutMs: number | null;
  note: string | null;
  healthStatus: string;
  lastCheckedAt: Date | null;
  lastHealthLatencyMs: number | null;
  lastHealthMessage: string | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type RagTaskConfigUpsertInput = {
  taskType: RagTaskType;
  provider: string;
  model: string;
  baseUrl?: string | null;
  apiKeyCiphertext?: string | null;
  apiKeyMasked?: string | null;
  enabled?: boolean;
  dimensions?: number | null;
  vectorVersion?: string | null;
  timeoutMs?: number | null;
  note?: string | null;
  actorId?: string;
};

type RagTaskConfigHealthPatch = {
  healthStatus?: RagConfigHealthStatus;
  lastCheckedAt?: string | null;
  lastHealthLatencyMs?: number | null;
  lastHealthMessage?: string | null;
  lastError?: string | null;
};

@Injectable()
export class RagTaskConfigRepository implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RagTaskConfigRepository.name);
  private prisma?: PrismaClientLike;
  private readonly configs = new Map<RagTaskType, RagTaskConfig>();
  private readonly apiKeys = new Map<RagTaskType, string>();

  constructor(private readonly appConfig: AppConfigService) {}

  async onModuleInit(): Promise<void> {
    if (!this.appConfig.databaseUrl) {
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
      this.logger.log("RAG task config 仓储已启用 PostgreSQL 持久化。");
    } catch (error) {
      this.logger.warn(
        `RAG task config 仓储初始化失败，降级为内存模式: ${
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

  async upsertConfig(input: RagTaskConfigUpsertInput): Promise<RagTaskConfig> {
    const current = await this.getConfig(input.taskType);
    const nextProvider = input.provider.trim();
    const nextModel = input.model.trim();
    const nextBaseUrl = input.baseUrl?.trim() || null;
    const shouldPreserveApiKey =
      input.apiKeyCiphertext === undefined &&
      this.hasSameRuntimeTarget(current, {
        provider: nextProvider,
        model: nextModel,
        baseUrl: nextBaseUrl
      });
    const nextApiKeyCiphertext =
      input.apiKeyCiphertext !== undefined
        ? input.apiKeyCiphertext
        : shouldPreserveApiKey
          ? (this.apiKeys.get(input.taskType) ?? null)
          : null;
    const now = new Date().toISOString();
    const id = current?.id ?? uuidv4();
    const config: RagTaskConfig = {
      id,
      taskType: input.taskType,
      provider: nextProvider,
      model: nextModel,
      baseUrl: nextBaseUrl,
      enabled: input.enabled ?? current?.enabled ?? true,
      hasApiKey: Boolean(nextApiKeyCiphertext),
      apiKeyMasked: input.apiKeyMasked ?? (shouldPreserveApiKey ? current?.apiKeyMasked : null),
      dimensions: input.dimensions ?? current?.dimensions ?? null,
      vectorVersion: input.vectorVersion ?? current?.vectorVersion ?? null,
      timeoutMs: input.timeoutMs ?? current?.timeoutMs ?? null,
      note: input.note ?? current?.note ?? null,
      healthStatus: current?.healthStatus ?? "unknown",
      lastCheckedAt: current?.lastCheckedAt ?? null,
      lastHealthLatencyMs: current?.lastHealthLatencyMs ?? null,
      lastHealthMessage: current?.lastHealthMessage ?? null,
      lastError: current?.lastError ?? null,
      configSource: "settings",
      configSourceNote: null,
      createdAt: current?.createdAt ?? now,
      updatedAt: now
    };
    this.configs.set(input.taskType, config);
    if (nextApiKeyCiphertext) {
      this.apiKeys.set(input.taskType, nextApiKeyCiphertext);
    } else {
      this.apiKeys.delete(input.taskType);
    }

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return config;
    }

    await this.tryPrismaWrite(async () => {
      await this.prisma?.ragTaskConfig.upsert({
        where: {
          taskType: input.taskType
        },
        update: {
          provider: config.provider,
          model: config.model,
          baseUrl: config.baseUrl,
          apiKeyCiphertext: nextApiKeyCiphertext,
          apiKeyMasked: config.apiKeyMasked,
          enabled: config.enabled,
          dimensions: config.dimensions,
          vectorVersion: config.vectorVersion,
          timeoutMs: config.timeoutMs,
          note: config.note,
          updatedBy: input.actorId ?? null,
          updatedAt: new Date(config.updatedAt)
        },
        create: {
          id: config.id,
          taskType: input.taskType,
          provider: config.provider,
          model: config.model,
          baseUrl: config.baseUrl,
          apiKeyCiphertext: nextApiKeyCiphertext,
          apiKeyMasked: config.apiKeyMasked,
          enabled: config.enabled,
          dimensions: config.dimensions,
          vectorVersion: config.vectorVersion,
          timeoutMs: config.timeoutMs,
          note: config.note,
          healthStatus: config.healthStatus,
          createdBy: input.actorId ?? null,
          updatedBy: input.actorId ?? null,
          createdAt: new Date(config.createdAt),
          updatedAt: new Date(config.updatedAt)
        }
      });
    });

    return config;
  }

  async updateHealth(
    taskType: RagTaskType,
    patch: RagTaskConfigHealthPatch
  ): Promise<RagTaskConfig | undefined> {
    const current = await this.getConfig(taskType);
    if (!current) {
      return undefined;
    }
    const next: RagTaskConfig = {
      ...current,
      healthStatus: patch.healthStatus ?? current.healthStatus,
      lastCheckedAt:
        patch.lastCheckedAt !== undefined ? patch.lastCheckedAt : current.lastCheckedAt,
      lastHealthLatencyMs:
        patch.lastHealthLatencyMs !== undefined
          ? patch.lastHealthLatencyMs
          : current.lastHealthLatencyMs,
      lastHealthMessage:
        patch.lastHealthMessage !== undefined
          ? patch.lastHealthMessage
          : current.lastHealthMessage,
      lastError: patch.lastError !== undefined ? patch.lastError : current.lastError,
      updatedAt: new Date().toISOString()
    };
    this.configs.set(taskType, next);

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return next;
    }
    await this.tryPrismaWrite(async () => {
      await this.prisma?.ragTaskConfig.update({
        where: { taskType },
        data: {
          healthStatus: next.healthStatus,
          lastCheckedAt: next.lastCheckedAt ? new Date(next.lastCheckedAt) : null,
          lastHealthLatencyMs: next.lastHealthLatencyMs,
          lastHealthMessage: next.lastHealthMessage,
          lastError: next.lastError,
          updatedAt: new Date(next.updatedAt)
        }
      });
    });
    return next;
  }

  async listConfigs(): Promise<RagTaskConfig[]> {
    const fromMemory = Array.from(this.configs.values());
    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return this.sortByTaskType(fromMemory);
    }
    const rows = (await this.tryPrismaRead(async () =>
      this.prisma?.ragTaskConfig.findMany({
        orderBy: {
          updatedAt: "desc"
        }
      })
    )) as RagTaskConfigRow[] | null;
    if (!rows) {
      return this.sortByTaskType(fromMemory);
    }

    const merged = new Map<RagTaskType, RagTaskConfig>();
    for (const row of rows) {
      const mapped = this.fromRow(row);
      this.configs.set(mapped.taskType, mapped);
      merged.set(mapped.taskType, mapped);
      if (row.apiKeyCiphertext) {
        this.apiKeys.set(mapped.taskType, row.apiKeyCiphertext);
      }
    }
    for (const item of fromMemory) {
      merged.set(item.taskType, item);
    }
    return this.sortByTaskType(Array.from(merged.values()));
  }

  async getConfig(taskType: RagTaskType): Promise<RagTaskConfig | undefined> {
    const cached = this.configs.get(taskType);
    if (cached) {
      return cached;
    }

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return undefined;
    }
    const row = (await this.tryPrismaRead(async () =>
      this.prisma?.ragTaskConfig.findUnique({
        where: { taskType }
      })
    )) as RagTaskConfigRow | null;
    if (!row) {
      return undefined;
    }
    const mapped = this.fromRow(row);
    this.configs.set(taskType, mapped);
    if (row.apiKeyCiphertext) {
      this.apiKeys.set(taskType, row.apiKeyCiphertext);
    }
    return mapped;
  }

  async getApiKey(taskType: RagTaskType): Promise<string | undefined> {
    const cached = this.apiKeys.get(taskType);
    if (cached) {
      return cached;
    }
    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return undefined;
    }
    const row = (await this.tryPrismaRead(async () =>
      this.prisma?.ragTaskConfig.findUnique({
        where: { taskType }
      })
    )) as RagTaskConfigRow | null;
    if (!row?.apiKeyCiphertext) {
      return undefined;
    }
    this.apiKeys.set(taskType, row.apiKeyCiphertext);
    return row.apiKeyCiphertext;
  }

  private fromRow(row: RagTaskConfigRow): RagTaskConfig {
    const taskType = this.toTaskType(row.taskType);
    return {
      id: row.id,
      taskType,
      provider: row.provider,
      model: row.model,
      baseUrl: row.baseUrl,
      enabled: row.enabled,
      hasApiKey: Boolean(row.apiKeyCiphertext),
      apiKeyMasked: row.apiKeyMasked,
      dimensions: row.dimensions,
      vectorVersion: row.vectorVersion,
      timeoutMs: row.timeoutMs,
      note: row.note,
      healthStatus: this.toHealthStatus(row.healthStatus),
      lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
      lastHealthLatencyMs: row.lastHealthLatencyMs,
      lastHealthMessage: row.lastHealthMessage,
      lastError: row.lastError,
      configSource: "settings",
      configSourceNote: null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private toTaskType(value: string): RagTaskType {
    return value === "rerank" ? "rerank" : "embedding";
  }

  private toHealthStatus(value: string): RagConfigHealthStatus {
    if (value === "healthy" || value === "degraded" || value === "failed") {
      return value;
    }
    return "unknown";
  }

  private sortByTaskType(configs: RagTaskConfig[]): RagTaskConfig[] {
    return [...configs].sort((left, right) =>
      left.taskType.localeCompare(right.taskType)
    );
  }

  private hasSameRuntimeTarget(
    current: Pick<RagTaskConfig, "provider" | "model" | "baseUrl"> | undefined,
    next: {
      provider: string;
      model: string;
      baseUrl: string | null;
    }
  ): boolean {
    if (!current) {
      return false;
    }
    return (
      current.provider.trim() === next.provider &&
      current.model.trim() === next.model &&
      (current.baseUrl?.trim() || null) === next.baseUrl
    );
  }

  private isPrimaryPersistenceConfigured(): boolean {
    return Boolean(this.appConfig.databaseUrl.trim().length > 0);
  }

  private async tryPrismaWrite(operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
    } catch (error) {
      this.logger.warn(
        `RAG task config 写入数据库失败，已保留内存态: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async tryPrismaRead<T>(
    operation: () => Promise<T | undefined>
  ): Promise<T | null> {
    try {
      const value = await operation();
      return (value ?? null) as T | null;
    } catch (error) {
      this.logger.warn(
        `RAG task config 读取数据库失败，回退内存态: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }
}
