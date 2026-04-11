import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type {
  LlmProviderCode,
  ModelCatalogItem,
  ModelHealthStatus,
  ProviderConfig,
  ProviderSyncStatus
} from "@text2sql/shared-types";
import { v4 as uuidv4 } from "uuid";
import { AppConfigService } from "../../config/app-config.service";

type PrismaClientLike = {
  providerConfig: {
    upsert: (args: Record<string, unknown>) => Promise<unknown>;
    findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
    findUnique: (args: Record<string, unknown>) => Promise<unknown>;
    update: (args: Record<string, unknown>) => Promise<unknown>;
  };
  modelCatalog: {
    upsert: (args: Record<string, unknown>) => Promise<unknown>;
    findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
    findUnique: (args: Record<string, unknown>) => Promise<unknown>;
    update: (args: Record<string, unknown>) => Promise<unknown>;
  };
  $disconnect: () => Promise<void>;
};

type ProviderConfigRow = {
  id: string;
  provider: string;
  displayName: string;
  baseUrl: string | null;
  enabled: boolean;
  apiKeyMasked: string | null;
  apiKeyCiphertext: string | null;
  lastSyncAt: Date | null;
  lastSyncStatus: string;
  lastSyncError: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type ModelCatalogRow = {
  id: string;
  providerConfigId: string;
  provider: string;
  model: string;
  displayName: string;
  capabilities: string | null;
  contextWindow: number | null;
  enabled: boolean;
  healthStatus: string;
  lastHealthCheckAt: Date | null;
  lastSyncedAt: Date | null;
  metadata: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type ProviderUpsertInput = {
  id?: string;
  provider: LlmProviderCode;
  displayName: string;
  baseUrl?: string | null;
  enabled?: boolean;
  apiKeyCiphertext?: string | null;
  apiKeyMasked?: string | null;
  actorId?: string;
};

type ModelUpsertInput = {
  id?: string;
  provider: LlmProviderCode;
  model: string;
  displayName?: string;
  capabilities?: string[];
  contextWindow?: number | null;
  enabled?: boolean;
  healthStatus?: ModelHealthStatus;
  lastHealthCheckAt?: string | null;
  lastSyncedAt?: string | null;
  metadata?: Record<string, unknown>;
};

const SUPPORTED_PROVIDERS: ReadonlySet<string> = new Set([
  "openai",
  "gemini",
  "deepseek",
  "kimi",
  "volcengine",
  "siliconflow",
  "openrouter",
  "minimax",
  "tencent-hunyuan",
  "tongyi"
]);

const toProviderCode = (value: string): LlmProviderCode => {
  if (!SUPPORTED_PROVIDERS.has(value)) {
    return "openai";
  }
  return value as LlmProviderCode;
};

const toProviderSyncStatus = (value: string): ProviderSyncStatus => {
  if (value === "syncing" || value === "healthy" || value === "degraded" || value === "failed") {
    return value;
  }
  return "idle";
};

const toModelHealthStatus = (value: string): ModelHealthStatus => {
  if (value === "healthy" || value === "degraded" || value === "failed") {
    return value;
  }
  return "unknown";
};

@Injectable()
export class LlmConfigRepository implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LlmConfigRepository.name);
  private prisma?: PrismaClientLike;
  private readonly providers = new Map<string, ProviderConfig>();
  private readonly providerSecrets = new Map<string, string>();
  private readonly models = new Map<string, ModelCatalogItem>();

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
      this.logger.log("LLM 配置仓储已启用 PostgreSQL 持久化。");
    } catch (error) {
      this.logger.warn(
        `LLM 配置仓储初始化失败，降级为内存模式: ${
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

  async upsertProvider(input: ProviderUpsertInput): Promise<ProviderConfig> {
    const now = new Date().toISOString();
    const nextId = input.id ?? uuidv4();
    const current = await this.getProviderById(nextId, { includeDeleted: true });
    const provider: ProviderConfig = {
      id: nextId,
      provider: input.provider,
      displayName: input.displayName.trim() || input.provider,
      baseUrl: input.baseUrl?.trim() || null,
      enabled: input.enabled ?? current?.enabled ?? true,
      hasApiKey: Boolean(input.apiKeyCiphertext || current?.hasApiKey),
      apiKeyMasked: input.apiKeyMasked ?? current?.apiKeyMasked ?? null,
      lastSyncAt: current?.lastSyncAt ?? null,
      lastSyncStatus: current?.lastSyncStatus ?? "idle",
      lastSyncError: current?.lastSyncError ?? null,
      modelCount: current?.modelCount ?? 0,
      createdAt: current?.createdAt ?? now,
      updatedAt: now
    };
    this.providers.set(provider.id, provider);
    if (input.apiKeyCiphertext !== undefined) {
      if (input.apiKeyCiphertext) {
        this.providerSecrets.set(provider.id, input.apiKeyCiphertext);
      } else {
        this.providerSecrets.delete(provider.id);
      }
    }

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return provider;
    }

    await this.tryPrismaWrite(async () => {
      await this.prisma?.providerConfig.upsert({
        where: { id: provider.id },
        update: {
          provider: provider.provider,
          displayName: provider.displayName,
          baseUrl: provider.baseUrl,
          enabled: provider.enabled,
          apiKeyCiphertext: input.apiKeyCiphertext ?? undefined,
          apiKeyMasked: provider.apiKeyMasked,
          updatedBy: input.actorId ?? null,
          updatedAt: new Date(provider.updatedAt),
          deletedAt: null
        },
        create: {
          id: provider.id,
          provider: provider.provider,
          displayName: provider.displayName,
          baseUrl: provider.baseUrl,
          enabled: provider.enabled,
          apiKeyCiphertext: input.apiKeyCiphertext ?? null,
          apiKeyMasked: provider.apiKeyMasked,
          createdBy: input.actorId ?? null,
          updatedBy: input.actorId ?? null,
          createdAt: new Date(provider.createdAt),
          updatedAt: new Date(provider.updatedAt)
        }
      });
    });

    return provider;
  }

  async listProviders(options?: {
    includeDeleted?: boolean;
  }): Promise<ProviderConfig[]> {
    const includeDeleted = options?.includeDeleted ?? false;
    const memory = Array.from(this.providers.values());
    const fromMemory = memory;

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return this.attachModelCount(fromMemory);
    }

    const rows = (await this.tryPrismaRead(async () =>
      this.prisma?.providerConfig.findMany({
        where: includeDeleted ? {} : { deletedAt: null },
        orderBy: {
          updatedAt: "desc"
        }
      })
    )) as ProviderConfigRow[] | null;

    if (!rows) {
      return this.attachModelCount(fromMemory);
    }

    const merged = new Map<string, ProviderConfig>();
    for (const row of rows) {
      const mapped = this.fromProviderRow(row);
      this.providers.set(mapped.id, mapped);
      merged.set(mapped.id, mapped);
    }
    for (const item of fromMemory) {
      merged.set(item.id, item);
    }
    return this.attachModelCount(Array.from(merged.values()));
  }

  async getProviderById(
    id: string,
    options?: { includeDeleted?: boolean }
  ): Promise<ProviderConfig | undefined> {
    const includeDeleted = options?.includeDeleted ?? false;
    const memory = this.providers.get(id);
    if (memory) {
      return memory;
    }

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return undefined;
    }

    const row = (await this.tryPrismaRead(async () =>
      this.prisma?.providerConfig.findUnique({
        where: { id }
      })
    )) as ProviderConfigRow | null;

    if (!row) {
      return undefined;
    }
    const provider = this.fromProviderRow(row);
    this.providers.set(provider.id, provider);
    if (row.apiKeyCiphertext) {
      this.providerSecrets.set(provider.id, row.apiKeyCiphertext);
    }
    if (!includeDeleted && row.deletedAt) {
      return undefined;
    }
    return provider;
  }

  async updateProviderSync(
    providerConfigId: string,
    patch: {
      status: ProviderSyncStatus;
      error?: string | null;
      syncedAt?: string | null;
    }
  ): Promise<ProviderConfig | undefined> {
    const current = await this.getProviderById(providerConfigId, {
      includeDeleted: true
    });
    if (!current) {
      return undefined;
    }
    const next: ProviderConfig = {
      ...current,
      lastSyncStatus: patch.status,
      lastSyncError: patch.error ?? null,
      lastSyncAt: patch.syncedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.providers.set(next.id, next);

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return next;
    }

    await this.tryPrismaWrite(async () => {
      await this.prisma?.providerConfig.update({
        where: { id: providerConfigId },
        data: {
          lastSyncStatus: next.lastSyncStatus,
          lastSyncError: next.lastSyncError,
          lastSyncAt: next.lastSyncAt ? new Date(next.lastSyncAt) : null,
          updatedAt: new Date(next.updatedAt)
        }
      });
    });

    return next;
  }

  async softDeleteProvider(providerConfigId: string): Promise<boolean> {
    const current = await this.getProviderById(providerConfigId, {
      includeDeleted: true
    });
    if (!current) {
      return false;
    }
    this.providers.delete(providerConfigId);
    this.providerSecrets.delete(providerConfigId);

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      for (const model of Array.from(this.models.values())) {
        if (model.providerConfigId === providerConfigId) {
          this.models.delete(model.id);
        }
      }
      return true;
    }

    await this.tryPrismaWrite(async () => {
      const now = new Date();
      await this.prisma?.providerConfig.update({
        where: { id: providerConfigId },
        data: {
          deletedAt: now
        }
      });
      const modelRows = await this.prisma?.modelCatalog.findMany({
        where: { providerConfigId }
      });
      for (const row of (modelRows ?? []) as ModelCatalogRow[]) {
        await this.prisma?.modelCatalog.update({
          where: { id: row.id },
          data: {
            deletedAt: now,
            enabled: false
          }
        });
      }
    });
    return true;
  }

  async getProviderRuntimeConfig(providerConfigId: string): Promise<{
    provider: LlmProviderCode;
    baseUrl?: string | null;
    apiKey?: string;
    enabled: boolean;
  } | null> {
    const provider = await this.getProviderById(providerConfigId);
    if (!provider) {
      return null;
    }
    let apiKey = this.providerSecrets.get(providerConfigId);
    if (!apiKey && this.isPrimaryPersistenceConfigured() && this.prisma) {
      const row = (await this.tryPrismaRead(async () =>
        this.prisma?.providerConfig.findUnique({
          where: { id: providerConfigId }
        })
      )) as ProviderConfigRow | null;
      if (!row) {
        return null;
      }
      if (row.apiKeyCiphertext) {
        apiKey = row.apiKeyCiphertext;
        this.providerSecrets.set(providerConfigId, row.apiKeyCiphertext);
      }
    }

    return {
      provider: provider.provider,
      baseUrl: provider.baseUrl,
      apiKey,
      enabled: provider.enabled
    };
  }

  async upsertModels(
    providerConfigId: string,
    models: ModelUpsertInput[]
  ): Promise<ModelCatalogItem[]> {
    const now = new Date().toISOString();
    const existed = await this.listModels({
      includeDisabled: true
    });
    const statusByProviderModel = new Map(
      existed.map((item) => [`${item.provider}:${item.model}`, item.enabled])
    );

    const nextModels: ModelCatalogItem[] = [];
    for (const model of models) {
      const identifier =
        model.id ?? `${providerConfigId}:${model.provider}:${model.model}`;
      const key = `${model.provider}:${model.model}`;
      const keepEnabled = statusByProviderModel.get(key);
      const next: ModelCatalogItem = {
        id: identifier,
        providerConfigId,
        provider: model.provider,
        model: model.model,
        displayName: model.displayName?.trim() || model.model,
        capabilities: model.capabilities ?? [],
        contextWindow: model.contextWindow ?? null,
        enabled: model.enabled ?? keepEnabled ?? true,
        healthStatus: model.healthStatus ?? "unknown",
        lastHealthCheckAt: model.lastHealthCheckAt ?? null,
        lastSyncedAt: model.lastSyncedAt ?? now,
        metadata: model.metadata,
        createdAt: now,
        updatedAt: now
      };
      this.models.set(next.id, next);
      nextModels.push(next);

      if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
        continue;
      }

      await this.tryPrismaWrite(async () => {
        await this.prisma?.modelCatalog.upsert({
          where: {
            provider_model: {
              provider: model.provider,
              model: model.model
            }
          },
          update: {
            providerConfigId: next.providerConfigId,
            displayName: next.displayName,
            capabilities: JSON.stringify(next.capabilities ?? []),
            contextWindow: next.contextWindow,
            enabled: next.enabled,
            healthStatus: next.healthStatus,
            lastHealthCheckAt: next.lastHealthCheckAt
              ? new Date(next.lastHealthCheckAt)
              : null,
            lastSyncedAt: next.lastSyncedAt ? new Date(next.lastSyncedAt) : null,
            metadata: next.metadata ? JSON.stringify(next.metadata) : null,
            deletedAt: null,
            updatedAt: new Date(next.updatedAt)
          },
          create: {
            id: next.id,
            providerConfigId: next.providerConfigId,
            provider: next.provider,
            model: next.model,
            displayName: next.displayName,
            capabilities: JSON.stringify(next.capabilities ?? []),
            contextWindow: next.contextWindow,
            enabled: next.enabled,
            healthStatus: next.healthStatus,
            lastHealthCheckAt: next.lastHealthCheckAt
              ? new Date(next.lastHealthCheckAt)
              : null,
            lastSyncedAt: next.lastSyncedAt ? new Date(next.lastSyncedAt) : null,
            metadata: next.metadata ? JSON.stringify(next.metadata) : null,
            createdAt: new Date(next.createdAt),
            updatedAt: new Date(next.updatedAt)
          }
        });
      });
    }

    return nextModels;
  }

  async listModels(options?: {
    enabledOnly?: boolean;
    includeDisabled?: boolean;
    provider?: LlmProviderCode;
  }): Promise<ModelCatalogItem[]> {
    const enabledOnly = options?.enabledOnly ?? false;
    const includeDisabled = options?.includeDisabled ?? false;
    const provider = options?.provider;

    const fromMemory = Array.from(this.models.values()).filter((item) => {
      if (provider && item.provider !== provider) {
        return false;
      }
      if (enabledOnly) {
        return item.enabled;
      }
      if (!includeDisabled) {
        return item.enabled;
      }
      return true;
    });

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return fromMemory.sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt)
      );
    }

    const rows = (await this.tryPrismaRead(async () =>
      this.prisma?.modelCatalog.findMany({
        where: {
          deletedAt: null,
          provider: provider ?? undefined,
          ...(enabledOnly || !includeDisabled ? { enabled: true } : {})
        },
        orderBy: {
          updatedAt: "desc"
        }
      })
    )) as ModelCatalogRow[] | null;

    if (!rows) {
      return fromMemory.sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt)
      );
    }

    const merged = new Map<string, ModelCatalogItem>();
    for (const row of rows) {
      const item = this.fromModelRow(row);
      this.models.set(item.id, item);
      merged.set(item.id, item);
    }
    for (const item of fromMemory) {
      merged.set(item.id, item);
    }
    return Array.from(merged.values()).sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    );
  }

  async getModelById(modelId: string): Promise<ModelCatalogItem | undefined> {
    const memory = this.models.get(modelId);
    if (memory) {
      return memory;
    }
    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return undefined;
    }
    const row = (await this.tryPrismaRead(async () =>
      this.prisma?.modelCatalog.findUnique({
        where: { id: modelId }
      })
    )) as ModelCatalogRow | null;
    if (!row || row.deletedAt) {
      return undefined;
    }
    const mapped = this.fromModelRow(row);
    this.models.set(mapped.id, mapped);
    return mapped;
  }

  async setModelEnabled(
    modelId: string,
    enabled: boolean
  ): Promise<ModelCatalogItem | undefined> {
    const current = await this.getModelById(modelId);
    if (!current) {
      return undefined;
    }
    const next: ModelCatalogItem = {
      ...current,
      enabled,
      updatedAt: new Date().toISOString()
    };
    this.models.set(next.id, next);

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return next;
    }

    await this.tryPrismaWrite(async () => {
      await this.prisma?.modelCatalog.update({
        where: { id: modelId },
        data: {
          enabled,
          updatedAt: new Date(next.updatedAt)
        }
      });
    });

    return next;
  }

  async resolveDefaultModel(): Promise<ModelCatalogItem | undefined> {
    const enabled = await this.listModels({ enabledOnly: true });
    if (enabled.length > 0) {
      return enabled[0];
    }
    return undefined;
  }

  private attachModelCount(providers: ProviderConfig[]): ProviderConfig[] {
    const models = Array.from(this.models.values());
    const countMap = new Map<string, number>();
    for (const model of models) {
      const next = (countMap.get(model.providerConfigId) ?? 0) + 1;
      countMap.set(model.providerConfigId, next);
    }
    return providers
      .map((provider) => ({
        ...provider,
        modelCount: countMap.get(provider.id) ?? provider.modelCount ?? 0
      }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private fromProviderRow(row: ProviderConfigRow): ProviderConfig {
    return {
      id: row.id,
      provider: toProviderCode(row.provider),
      displayName: row.displayName,
      baseUrl: row.baseUrl,
      enabled: row.enabled,
      hasApiKey: Boolean(row.apiKeyCiphertext),
      apiKeyMasked: row.apiKeyMasked,
      lastSyncAt: row.lastSyncAt ? row.lastSyncAt.toISOString() : null,
      lastSyncStatus: toProviderSyncStatus(row.lastSyncStatus),
      lastSyncError: row.lastSyncError,
      modelCount: 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private fromModelRow(row: ModelCatalogRow): ModelCatalogItem {
    return {
      id: row.id,
      providerConfigId: row.providerConfigId,
      provider: toProviderCode(row.provider),
      model: row.model,
      displayName: row.displayName,
      capabilities: this.parseJsonSafely<string[]>(row.capabilities) ?? [],
      contextWindow: row.contextWindow,
      enabled: row.enabled,
      healthStatus: toModelHealthStatus(row.healthStatus),
      lastHealthCheckAt: row.lastHealthCheckAt
        ? row.lastHealthCheckAt.toISOString()
        : null,
      lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
      metadata: this.parseJsonSafely<Record<string, unknown>>(row.metadata),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
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

  private isPrimaryPersistenceConfigured(): boolean {
    return Boolean(this.appConfig.databaseUrl);
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
    this.logger.warn(`LLM 配置持久化失败，已降级为内存模式: ${message}`);
    this.prisma = undefined;
  }
}
