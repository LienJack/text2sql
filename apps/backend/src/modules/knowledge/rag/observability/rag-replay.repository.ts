import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { AppConfigService } from "../../../config/app-config.service";

export interface RagReplayRecord {
  runId: string;
  replayKey: string;
  datasourceId: string;
  stage: string;
  indexVersionId?: string;
  documentId?: string;
  chunkId?: string;
  payload: string;
  createdAt: string;
}

export interface WriteRagReplayInput {
  runId: string;
  replayKey: string;
  datasourceId: string;
  stage: string;
  indexVersionId?: string;
  documentId?: string;
  chunkId?: string;
  payload: unknown;
  createdAt?: string;
}

type PrismaClientLike = {
  ragRunReplay?: {
    upsert?: (args: Record<string, unknown>) => Promise<unknown>;
    findMany?: (args: Record<string, unknown>) => Promise<unknown[]>;
    findUnique?: (args: Record<string, unknown>) => Promise<unknown>;
  };
  $disconnect: () => Promise<void>;
};

type RagRunReplayRow = {
  runId: string;
  replayKey: string;
  datasourceId: string;
  stage: string;
  indexVersionId: string | null;
  documentId: string | null;
  chunkId: string | null;
  payload: string;
  createdAt: Date;
};

@Injectable()
export class RagReplayRepository implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RagReplayRepository.name);
  private prisma?: PrismaClientLike;
  private readonly replays = new Map<string, RagReplayRecord>();

  constructor(private readonly appConfig: AppConfigService) {}

  async onModuleInit(): Promise<void> {
    if (!this.isPrimaryPersistenceConfigured()) {
      return;
    }

    try {
      const prismaClientModulePath = "../../../../generated/prisma/client";
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
      this.logger.log("RAG replay 仓储已启用 PostgreSQL 持久化。");
    } catch (error) {
      this.logger.warn(
        `RAG replay 仓储初始化失败，降级为内存模式: ${
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

  async writeReplay(input: WriteRagReplayInput): Promise<RagReplayRecord> {
    const replay = this.normalizeInput(input);
    this.replays.set(this.buildMapKey(replay.runId, replay.replayKey), replay);

    const replayModel = this.prisma?.ragRunReplay;
    if (
      !this.isPrimaryPersistenceConfigured() ||
      !this.prisma ||
      !replayModel?.upsert
    ) {
      return { ...replay };
    }

    await this.tryPrismaWrite(async () => {
      await replayModel.upsert?.({
        where: {
          runId_replayKey: {
            runId: replay.runId,
            replayKey: replay.replayKey
          }
        },
        update: {
          datasourceId: replay.datasourceId,
          stage: replay.stage,
          indexVersionId: replay.indexVersionId ?? null,
          documentId: replay.documentId ?? null,
          chunkId: replay.chunkId ?? null,
          payload: replay.payload,
          createdAt: new Date(replay.createdAt)
        },
        create: {
          runId: replay.runId,
          replayKey: replay.replayKey,
          datasourceId: replay.datasourceId,
          stage: replay.stage,
          indexVersionId: replay.indexVersionId ?? null,
          documentId: replay.documentId ?? null,
          chunkId: replay.chunkId ?? null,
          payload: replay.payload,
          createdAt: new Date(replay.createdAt)
        }
      });
    });

    return { ...replay };
  }

  async getReplay(runId: string, replayKey: string): Promise<RagReplayRecord | undefined> {
    const normalizedRunId = runId.trim();
    const normalizedReplayKey = replayKey.trim();
    if (!normalizedRunId || !normalizedReplayKey) {
      return undefined;
    }

    const key = this.buildMapKey(normalizedRunId, normalizedReplayKey);
    const memory = this.replays.get(key);
    if (memory) {
      return { ...memory };
    }

    const replayModel = this.prisma?.ragRunReplay;
    if (
      !this.isPrimaryPersistenceConfigured() ||
      !this.prisma ||
      !replayModel?.findUnique
    ) {
      return undefined;
    }

    const row = (await this.tryPrismaRead(async () =>
      replayModel.findUnique?.({
        where: {
          runId_replayKey: {
            runId: normalizedRunId,
            replayKey: normalizedReplayKey
          }
        }
      })
    )) as RagRunReplayRow | null;

    if (!row) {
      return undefined;
    }

    const replay = this.fromRow(row);
    this.replays.set(key, replay);
    return { ...replay };
  }

  async listByRunId(runId: string): Promise<RagReplayRecord[]> {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) {
      return [];
    }

    const fromMemory = this.sortByCreatedAt(
      Array.from(this.replays.values()).filter((item) => item.runId === normalizedRunId)
    );

    const replayModel = this.prisma?.ragRunReplay;
    if (
      !this.isPrimaryPersistenceConfigured() ||
      !this.prisma ||
      !replayModel?.findMany
    ) {
      return fromMemory.map((item) => ({ ...item }));
    }

    const rows = (await this.tryPrismaRead(async () =>
      replayModel.findMany?.({
        where: { runId: normalizedRunId },
        orderBy: [{ createdAt: "asc" }, { replayKey: "asc" }]
      })
    )) as RagRunReplayRow[] | null;

    if (!rows) {
      return fromMemory.map((item) => ({ ...item }));
    }

    const merged = new Map<string, RagReplayRecord>();
    for (const row of rows) {
      const replay = this.fromRow(row);
      const key = this.buildMapKey(replay.runId, replay.replayKey);
      merged.set(key, replay);
      this.replays.set(key, replay);
    }
    for (const item of fromMemory) {
      merged.set(this.buildMapKey(item.runId, item.replayKey), item);
    }

    return this.sortByCreatedAt(Array.from(merged.values()));
  }

  private normalizeInput(input: WriteRagReplayInput): RagReplayRecord {
    const runId = input.runId?.trim();
    if (!runId) {
      throw new Error("rag replay runId 不能为空");
    }
    const replayKey = input.replayKey?.trim();
    if (!replayKey) {
      throw new Error("rag replay replayKey 不能为空");
    }
    const datasourceId = input.datasourceId?.trim();
    if (!datasourceId) {
      throw new Error("rag replay datasourceId 不能为空");
    }
    const stage = input.stage?.trim();
    if (!stage) {
      throw new Error("rag replay stage 不能为空");
    }

    return {
      runId,
      replayKey,
      datasourceId,
      stage,
      indexVersionId: input.indexVersionId?.trim() || undefined,
      documentId: input.documentId?.trim() || undefined,
      chunkId: input.chunkId?.trim() || undefined,
      payload: this.stringifyPayload(input.payload),
      createdAt: this.toIso(input.createdAt)
    };
  }

  private fromRow(row: RagRunReplayRow): RagReplayRecord {
    return {
      runId: row.runId,
      replayKey: row.replayKey,
      datasourceId: row.datasourceId,
      stage: row.stage,
      indexVersionId: row.indexVersionId ?? undefined,
      documentId: row.documentId ?? undefined,
      chunkId: row.chunkId ?? undefined,
      payload: row.payload,
      createdAt: row.createdAt.toISOString()
    };
  }

  private stringifyPayload(payload: unknown): string {
    if (typeof payload === "string") {
      const text = payload.trim();
      if (!text) {
        throw new Error("rag replay payload 不能为空字符串");
      }
      return text;
    }

    try {
      const serialized = JSON.stringify(payload);
      if (!serialized) {
        throw new Error("rag replay payload 无法序列化");
      }
      return serialized;
    } catch {
      return JSON.stringify({
        raw: String(payload)
      });
    }
  }

  private toIso(input?: string): string {
    if (!input) {
      return new Date().toISOString();
    }
    const timestamp = Date.parse(input);
    if (Number.isNaN(timestamp)) {
      throw new Error(`rag replay createdAt 非法时间格式: ${input}`);
    }
    return new Date(timestamp).toISOString();
  }

  private sortByCreatedAt(items: RagReplayRecord[]): RagReplayRecord[] {
    return items
      .map((item) => ({ ...item }))
      .sort((left, right) => {
        const leftTime = Date.parse(left.createdAt);
        const rightTime = Date.parse(right.createdAt);
        if (leftTime === rightTime) {
          return left.replayKey.localeCompare(right.replayKey);
        }
        return leftTime - rightTime;
      });
  }

  private buildMapKey(runId: string, replayKey: string): string {
    return `${runId}::${replayKey}`;
  }

  private isPrimaryPersistenceConfigured(): boolean {
    return Boolean(this.appConfig.databaseUrl);
  }

  private async tryPrismaWrite<T>(op: () => Promise<T | undefined>): Promise<T | undefined> {
    try {
      return await op();
    } catch (error) {
      this.logger.warn(
        `RAG replay Prisma 写入失败，保持内存数据可读: ${
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
        `RAG replay Prisma 读取失败，回退内存缓存: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }
}
