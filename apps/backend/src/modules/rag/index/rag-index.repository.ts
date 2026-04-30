import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { v4 as uuidv4 } from "uuid";
import { AppConfigService } from "../../config/app-config.service";
import { DomainError } from "../../../common/domain-error";

export type RagIndexStatus = "building" | "ready" | "active" | "deprecated";

export interface RagIndexVersionRecord {
  id: string;
  datasourceId: string;
  status: RagIndexStatus;
  sourceVersion: string;
  buildReason?: string;
  createdByRunId?: string;
  activatedByRunId?: string;
  activatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RagChunkBuildInput {
  id: string;
  datasourceId: string;
  domain: string;
  content: string;
  metadata?: string;
}

export interface RagChunkIndexEntryRecord {
  id: string;
  indexVersionId: string;
  chunkId: string;
  datasourceId: string;
  domain: string;
  lexicalContent: string;
  denseVector?: string;
  metadata?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBuildingVersionInput {
  datasourceId: string;
  sourceVersion: string;
  buildReason?: string;
  createdByRunId?: string;
}

export interface ActivateVersionInput {
  datasourceId: string;
  indexVersionId: string;
  activatedByRunId?: string;
  simulateFailure?: "after_deprecating_current_active";
}

export interface RagIndexActivationResult {
  activated: RagIndexVersionRecord;
  replacedVersions: RagIndexVersionRecord[];
}

type PrismaClientLike = {
  ragChunk: {
    findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
  };
  ragIndexVersion: {
    create: (args: Record<string, unknown>) => Promise<unknown>;
    update: (args: Record<string, unknown>) => Promise<unknown>;
    updateMany: (args: Record<string, unknown>) => Promise<{ count: number }>;
    findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
    findUnique: (args: Record<string, unknown>) => Promise<unknown>;
  };
  ragChunkIndexEntry: {
    deleteMany: (args: Record<string, unknown>) => Promise<{ count: number }>;
    createMany: (args: Record<string, unknown>) => Promise<{ count: number }>;
    findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
  };
  $transaction: <T>(fn: (tx: PrismaTransactionClientLike) => Promise<T>) => Promise<T>;
  $disconnect: () => Promise<void>;
};

type PrismaTransactionClientLike = Omit<PrismaClientLike, "$disconnect" | "$transaction">;

type RagChunkRow = {
  id: string;
  datasourceId: string;
  domain: string;
  content: string;
  metadata: string | null;
  chunkOrder: number;
};

type RagIndexVersionRow = {
  id: string;
  datasourceId: string;
  status: string;
  sourceVersion: string;
  buildReason: string | null;
  createdByRunId: string | null;
  activatedByRunId: string | null;
  activatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type RagChunkIndexEntryRow = {
  id: string;
  indexVersionId: string;
  chunkId: string;
  datasourceId: string;
  domain: string;
  lexicalContent: string;
  denseVector: string | null;
  metadata: string | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class RagIndexRepository implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RagIndexRepository.name);
  private prisma?: PrismaClientLike;
  private readonly indexVersions = new Map<string, RagIndexVersionRecord>();
  private readonly entriesByVersionId = new Map<string, RagChunkIndexEntryRecord[]>();
  private readonly chunksByDatasource = new Map<string, RagChunkBuildInput[]>();
  private readonly activationLocks = new Map<string, Promise<void>>();

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
      this.logger.log("RAG Index 仓储已启用 PostgreSQL 持久化。");
    } catch (error) {
      this.logger.warn(
        `RAG Index 仓储初始化失败，降级为内存模式: ${
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

  seedChunksForDatasource(datasourceId: string, chunks: RagChunkBuildInput[]): void {
    this.chunksByDatasource.set(
      datasourceId,
      chunks.map((chunk) => ({
        id: chunk.id,
        datasourceId: chunk.datasourceId,
        domain: chunk.domain,
        content: chunk.content,
        metadata: chunk.metadata
      }))
    );
  }

  upsertChunksForDatasource(datasourceId: string, chunks: RagChunkBuildInput[]): void {
    if (chunks.length === 0) {
      return;
    }
    const existing = this.chunksByDatasource.get(datasourceId) ?? [];
    const merged = new Map<string, RagChunkBuildInput>();
    for (const chunk of existing) {
      merged.set(chunk.id, {
        ...chunk
      });
    }
    for (const chunk of chunks) {
      merged.set(chunk.id, {
        ...chunk
      });
    }
    this.chunksByDatasource.set(datasourceId, [...merged.values()]);
  }

  async listChunksForBuild(datasourceId: string): Promise<RagChunkBuildInput[]> {
    const memory = this.chunksByDatasource.get(datasourceId) ?? [];
    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return memory.map((item) => ({ ...item }));
    }

    const rows = (await this.tryPrismaRead(async () =>
      this.prisma?.ragChunk.findMany({
        where: { datasourceId },
        orderBy: [{ chunkOrder: "asc" }, { createdAt: "asc" }]
      })
    )) as RagChunkRow[] | null;

    if (!rows || rows.length === 0) {
      return memory.map((item) => ({ ...item }));
    }

    const fromDb = rows.map((row) => ({
      id: row.id,
      datasourceId: row.datasourceId,
      domain: row.domain,
      content: row.content,
      metadata: row.metadata ?? undefined
    }));
    this.chunksByDatasource.set(datasourceId, fromDb);
    return fromDb.map((item) => ({ ...item }));
  }

  async createBuildingVersion(
    input: CreateBuildingVersionInput
  ): Promise<RagIndexVersionRecord> {
    const now = new Date().toISOString();
    const next: RagIndexVersionRecord = {
      id: uuidv4(),
      datasourceId: input.datasourceId,
      status: "building",
      sourceVersion: input.sourceVersion,
      buildReason: input.buildReason,
      createdByRunId: input.createdByRunId,
      createdAt: now,
      updatedAt: now
    };

    this.indexVersions.set(next.id, next);

    if (this.isPrimaryPersistenceConfigured() && this.prisma) {
      await this.tryPrismaWrite(async () => {
        await this.prisma?.ragIndexVersion.create({
          data: {
            id: next.id,
            datasourceId: next.datasourceId,
            status: next.status,
            sourceVersion: next.sourceVersion,
            buildReason: next.buildReason ?? null,
            createdByRunId: next.createdByRunId ?? null,
            createdAt: new Date(next.createdAt),
            updatedAt: new Date(next.updatedAt)
          }
        });
      });
    }

    return { ...next };
  }

  async replaceEntriesForVersion(
    indexVersionId: string,
    entries: RagChunkIndexEntryRecord[]
  ): Promise<void> {
    const current = await this.getVersionById(indexVersionId);
    if (!current) {
      throw new DomainError(
        "RAG_INDEX_VERSION_NOT_FOUND",
        `索引版本不存在: ${indexVersionId}`,
        404,
        { indexVersionId }
      );
    }

    this.entriesByVersionId.set(
      indexVersionId,
      entries.map((entry) => ({ ...entry }))
    );

    if (this.isPrimaryPersistenceConfigured() && this.prisma) {
      await this.tryPrismaWrite(async () => {
        await this.prisma?.ragChunkIndexEntry.deleteMany({
          where: { indexVersionId }
        });
        if (entries.length === 0) {
          return;
        }
        await this.prisma?.ragChunkIndexEntry.createMany({
          data: entries.map((entry) => ({
            id: entry.id,
            indexVersionId: entry.indexVersionId,
            chunkId: entry.chunkId,
            datasourceId: entry.datasourceId,
            domain: entry.domain,
            lexicalContent: entry.lexicalContent,
            denseVector: entry.denseVector ?? null,
            metadata: entry.metadata ?? null,
            createdAt: new Date(entry.createdAt),
            updatedAt: new Date(entry.updatedAt)
          }))
        });
      });
    }
  }

  async markVersionReady(indexVersionId: string): Promise<RagIndexVersionRecord> {
    return this.updateVersionStatus(indexVersionId, "ready");
  }

  async markVersionDeprecated(indexVersionId: string): Promise<RagIndexVersionRecord> {
    return this.updateVersionStatus(indexVersionId, "deprecated");
  }

  async activateVersion(input: ActivateVersionInput): Promise<RagIndexVersionRecord> {
    const result = await this.activateVersionWithEvidence(input);
    return result.activated;
  }

  async activateVersionWithEvidence(
    input: ActivateVersionInput
  ): Promise<RagIndexActivationResult> {
    return this.withDatasourceActivationLock(input.datasourceId, async () => {
      if (this.isPrimaryPersistenceConfigured() && this.prisma) {
        return this.activateWithPrisma(input);
      }
      return this.activateInMemory(input);
    });
  }

  async getVersionById(indexVersionId: string): Promise<RagIndexVersionRecord | undefined> {
    const memory = this.indexVersions.get(indexVersionId);
    if (memory) {
      return { ...memory };
    }

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return undefined;
    }

    const row = (await this.tryPrismaRead(async () =>
      this.prisma?.ragIndexVersion.findUnique({
        where: { id: indexVersionId }
      })
    )) as RagIndexVersionRow | null;

    if (!row) {
      return undefined;
    }

    const version = this.fromRagIndexVersionRow(row);
    this.indexVersions.set(version.id, version);
    return { ...version };
  }

  async getActiveVersion(datasourceId: string): Promise<RagIndexVersionRecord | undefined> {
    const fromMemory = this.findActiveVersionFromMemory(datasourceId);
    if (fromMemory) {
      return fromMemory;
    }

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return undefined;
    }

    const rows = (await this.tryPrismaRead(async () =>
      this.prisma?.ragIndexVersion.findMany({
        where: { datasourceId, status: "active" },
        orderBy: [{ activatedAt: "desc" }, { updatedAt: "desc" }],
        take: 1
      })
    )) as RagIndexVersionRow[] | null;

    if (!rows || rows.length === 0) {
      return undefined;
    }

    const version = this.fromRagIndexVersionRow(rows[0]);
    this.indexVersions.set(version.id, version);
    return { ...version };
  }

  async listVersionsByDatasource(datasourceId: string): Promise<RagIndexVersionRecord[]> {
    const memory = Array.from(this.indexVersions.values())
      .filter((item) => item.datasourceId === datasourceId)
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
      .map((item) => ({ ...item }));

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return memory;
    }

    const rows = (await this.tryPrismaRead(async () =>
      this.prisma?.ragIndexVersion.findMany({
        where: { datasourceId },
        orderBy: [{ createdAt: "asc" }, { updatedAt: "asc" }]
      })
    )) as RagIndexVersionRow[] | null;

    if (!rows) {
      return memory;
    }

    const merged = new Map<string, RagIndexVersionRecord>();
    for (const row of rows) {
      const version = this.fromRagIndexVersionRow(row);
      merged.set(version.id, version);
      this.indexVersions.set(version.id, version);
    }
    for (const version of memory) {
      merged.set(version.id, version);
    }

    return Array.from(merged.values()).sort(
      (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt)
    );
  }

  async listEntriesByVersion(indexVersionId: string): Promise<RagChunkIndexEntryRecord[]> {
    const memory = this.entriesByVersionId.get(indexVersionId);
    if (memory) {
      return memory.map((entry) => ({ ...entry }));
    }

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return [];
    }

    const rows = (await this.tryPrismaRead(async () =>
      this.prisma?.ragChunkIndexEntry.findMany({
        where: { indexVersionId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      })
    )) as RagChunkIndexEntryRow[] | null;

    if (!rows) {
      return [];
    }

    const entries = rows.map((row) => this.fromRagChunkIndexEntryRow(row));
    this.entriesByVersionId.set(
      indexVersionId,
      entries.map((entry) => ({ ...entry }))
    );
    return entries;
  }

  private async activateInMemory(input: ActivateVersionInput): Promise<RagIndexActivationResult> {
    const target = this.indexVersions.get(input.indexVersionId);
    if (!target || target.datasourceId !== input.datasourceId) {
      throw new DomainError("RAG_INDEX_VERSION_NOT_FOUND", "待激活索引版本不存在。", 404, {
        indexVersionId: input.indexVersionId,
        datasourceId: input.datasourceId
      });
    }
    if (target.status !== "ready") {
      throw new DomainError(
        "RAG_INDEX_VERSION_INVALID_STATUS",
        "仅 ready 状态索引可激活。",
        409,
        {
          indexVersionId: input.indexVersionId,
          status: target.status
        }
      );
    }

    const snapshot = this.snapshotDatasourceVersions(input.datasourceId);
    try {
      const now = new Date().toISOString();
      const replacedVersions: RagIndexVersionRecord[] = [];
      for (const version of this.indexVersions.values()) {
        if (version.datasourceId === input.datasourceId && version.status === "active") {
          replacedVersions.push({ ...version });
          version.status = "deprecated";
          version.updatedAt = now;
          this.indexVersions.set(version.id, { ...version });
        }
      }

      if (input.simulateFailure === "after_deprecating_current_active") {
        throw new Error("simulated activation failure");
      }

      const next: RagIndexVersionRecord = {
        ...target,
        status: "active",
        activatedAt: now,
        activatedByRunId: input.activatedByRunId,
        updatedAt: now
      };
      this.indexVersions.set(next.id, next);
      return {
        activated: { ...next },
        replacedVersions
      };
    } catch (error) {
      this.restoreDatasourceVersions(input.datasourceId, snapshot);
      throw error;
    }
  }

  private async activateWithPrisma(
    input: ActivateVersionInput
  ): Promise<RagIndexActivationResult> {
    const result = await this.tryPrismaWrite(async () =>
      this.prisma?.$transaction(async (tx) => {
        const target = (await tx.ragIndexVersion.findUnique({
          where: { id: input.indexVersionId }
        })) as RagIndexVersionRow | null;
        if (!target || target.datasourceId !== input.datasourceId) {
          throw new DomainError("RAG_INDEX_VERSION_NOT_FOUND", "待激活索引版本不存在。", 404, {
            indexVersionId: input.indexVersionId,
            datasourceId: input.datasourceId
          });
        }
        if (target.status !== "ready") {
          throw new DomainError(
            "RAG_INDEX_VERSION_INVALID_STATUS",
            "仅 ready 状态索引可激活。",
            409,
            {
              indexVersionId: input.indexVersionId,
              status: target.status
            }
          );
        }

        const now = new Date();
        const replacedRows = (await tx.ragIndexVersion.findMany({
          where: {
            datasourceId: input.datasourceId,
            status: "active"
          },
          orderBy: [{ activatedAt: "desc" }, { updatedAt: "desc" }]
        })) as RagIndexVersionRow[];
        await tx.ragIndexVersion.updateMany({
          where: {
            datasourceId: input.datasourceId,
            status: "active"
          },
          data: {
            status: "deprecated",
            updatedAt: now
          }
        });

        if (input.simulateFailure === "after_deprecating_current_active") {
          throw new Error("simulated activation failure");
        }

        const activated = (await tx.ragIndexVersion.update({
          where: { id: input.indexVersionId },
          data: {
            status: "active",
            activatedAt: now,
            activatedByRunId: input.activatedByRunId ?? null,
            updatedAt: now
          }
        })) as RagIndexVersionRow;
        return {
          activated: this.fromRagIndexVersionRow(activated),
          replacedVersions: replacedRows.map((row) => this.fromRagIndexVersionRow(row))
        };
      })
    );

    if (!result) {
      throw new Error("RAG 激活事务返回空结果");
    }

    this.indexVersions.set(result.activated.id, result.activated);
    for (const replaced of result.replacedVersions) {
      this.indexVersions.set(replaced.id, {
        ...replaced,
        status: "deprecated"
      });
    }
    return {
      activated: { ...result.activated },
      replacedVersions: result.replacedVersions.map((item) => ({ ...item }))
    };
  }

  private async updateVersionStatus(
    indexVersionId: string,
    status: RagIndexStatus
  ): Promise<RagIndexVersionRecord> {
    const current = await this.getVersionById(indexVersionId);
    if (!current) {
      throw new DomainError(
        "RAG_INDEX_VERSION_NOT_FOUND",
        `索引版本不存在: ${indexVersionId}`,
        404,
        { indexVersionId }
      );
    }

    const next: RagIndexVersionRecord = {
      ...current,
      status,
      updatedAt: new Date().toISOString()
    };
    this.indexVersions.set(next.id, next);

    if (this.isPrimaryPersistenceConfigured() && this.prisma) {
      await this.tryPrismaWrite(async () => {
        await this.prisma?.ragIndexVersion.update({
          where: { id: next.id },
          data: {
            status: next.status,
            updatedAt: new Date(next.updatedAt)
          }
        });
      });
    }

    return { ...next };
  }

  private findActiveVersionFromMemory(
    datasourceId: string
  ): RagIndexVersionRecord | undefined {
    const active = Array.from(this.indexVersions.values())
      .filter((item) => item.datasourceId === datasourceId && item.status === "active")
      .sort((left, right) => {
        const rightTime = Date.parse(right.activatedAt ?? right.updatedAt);
        const leftTime = Date.parse(left.activatedAt ?? left.updatedAt);
        return rightTime - leftTime;
      })[0];

    return active ? { ...active } : undefined;
  }

  private snapshotDatasourceVersions(
    datasourceId: string
  ): Map<string, RagIndexVersionRecord> {
    const snapshot = new Map<string, RagIndexVersionRecord>();
    for (const [id, value] of this.indexVersions.entries()) {
      if (value.datasourceId === datasourceId) {
        snapshot.set(id, { ...value });
      }
    }
    return snapshot;
  }

  private restoreDatasourceVersions(
    datasourceId: string,
    snapshot: Map<string, RagIndexVersionRecord>
  ): void {
    for (const [id, value] of this.indexVersions.entries()) {
      if (value.datasourceId === datasourceId && !snapshot.has(id)) {
        this.indexVersions.delete(id);
      }
    }
    for (const [id, value] of snapshot.entries()) {
      this.indexVersions.set(id, { ...value });
    }
  }

  private async withDatasourceActivationLock<T>(
    datasourceId: string,
    task: () => Promise<T>
  ): Promise<T> {
    const previous = this.activationLocks.get(datasourceId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.activationLocks.set(datasourceId, current);

    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.activationLocks.get(datasourceId) === current) {
        this.activationLocks.delete(datasourceId);
      }
    }
  }

  private fromRagIndexVersionRow(row: RagIndexVersionRow): RagIndexVersionRecord {
    return {
      id: row.id,
      datasourceId: row.datasourceId,
      status: this.toRagIndexStatus(row.status),
      sourceVersion: row.sourceVersion,
      buildReason: row.buildReason ?? undefined,
      createdByRunId: row.createdByRunId ?? undefined,
      activatedByRunId: row.activatedByRunId ?? undefined,
      activatedAt: row.activatedAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private fromRagChunkIndexEntryRow(
    row: RagChunkIndexEntryRow
  ): RagChunkIndexEntryRecord {
    return {
      id: row.id,
      indexVersionId: row.indexVersionId,
      chunkId: row.chunkId,
      datasourceId: row.datasourceId,
      domain: row.domain,
      lexicalContent: row.lexicalContent,
      denseVector: row.denseVector ?? undefined,
      metadata: row.metadata ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private toRagIndexStatus(status: string): RagIndexStatus {
    switch (status) {
      case "building":
      case "ready":
      case "active":
      case "deprecated":
        return status;
      default:
        this.logger.warn(`未知 RAG 索引状态 ${status}，已回退为 deprecated`);
        return "deprecated";
    }
  }

  private isPrimaryPersistenceConfigured(): boolean {
    return Boolean(this.appConfig.databaseUrl);
  }

  private async tryPrismaWrite<T>(op: () => Promise<T | undefined>): Promise<T | undefined> {
    try {
      return await op();
    } catch (error) {
      this.logger.warn(
        `RAG Prisma 写入失败，保持内存数据可读: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return undefined;
    }
  }

  private async tryPrismaRead<T>(op: () => Promise<T | undefined>): Promise<T | null> {
    try {
      const result = await op();
      return result ?? null;
    } catch (error) {
      this.logger.warn(
        `RAG Prisma 读取失败，回退内存缓存: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }
}
