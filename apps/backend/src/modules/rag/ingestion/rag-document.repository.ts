import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { AppConfigService } from "../../config/app-config.service";
import type {
  RagChunkRecordDraft,
  RagDocumentDraft
} from "./rag-document.factory";

type PrismaClientLike = {
  ragDocument: {
    upsert: (args: Record<string, unknown>) => Promise<unknown>;
  };
  ragChunk: {
    upsert: (args: Record<string, unknown>) => Promise<unknown>;
  };
  $transaction: <T>(fn: (tx: PrismaTransactionClientLike) => Promise<T>) => Promise<T>;
  $disconnect: () => Promise<void>;
};

type PrismaTransactionClientLike = Omit<PrismaClientLike, "$disconnect" | "$transaction">;

interface RagDocumentMemoryState {
  documentsById: Map<string, RagDocumentDraft>;
  chunksById: Map<string, RagChunkRecordDraft>;
}

export interface RagDocumentUpsertInput {
  document: RagDocumentDraft;
  chunks: RagChunkRecordDraft[];
}

export interface RagDocumentUpsertResult {
  documentId: string;
  insertedDocument: boolean;
  insertedChunkCount: number;
}

@Injectable()
export class RagDocumentRepository implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RagDocumentRepository.name);
  private prisma?: PrismaClientLike;
  private readonly memoryByDatasource = new Map<string, RagDocumentMemoryState>();

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
      if (!PrismaCtor || !PrismaPgCtor) {
        throw new Error("Prisma client or pg adapter unavailable");
      }
      const adapter = new PrismaPgCtor({
        connectionString: this.appConfig.databaseUrl
      });
      this.prisma = new PrismaCtor({ adapter }) as PrismaClientLike;
      this.logger.log("RAG Document 仓储已启用 PostgreSQL 持久化。");
    } catch (error) {
      this.logger.warn(
        `RAG Document 仓储初始化失败，降级为内存模式: ${
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

  async upsertDocumentWithChunks(
    input: RagDocumentUpsertInput
  ): Promise<RagDocumentUpsertResult> {
    const datasourceState = this.ensureMemoryState(input.document.datasourceId);
    const insertedDocument = !datasourceState.documentsById.has(input.document.id);
    datasourceState.documentsById.set(input.document.id, { ...input.document });
    let insertedChunkCount = 0;
    for (const chunk of input.chunks) {
      if (!datasourceState.chunksById.has(chunk.id)) {
        insertedChunkCount += 1;
      }
      datasourceState.chunksById.set(chunk.id, { ...chunk });
    }

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return {
        documentId: input.document.id,
        insertedDocument,
        insertedChunkCount
      };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.ragDocument.upsert({
        where: { id: input.document.id },
        create: this.toPrismaDocument(input.document),
        update: this.toPrismaDocumentUpdate(input.document)
      });
      for (const chunk of input.chunks) {
        await tx.ragChunk.upsert({
          where: { id: chunk.id },
          create: this.toPrismaChunk(chunk),
          update: this.toPrismaChunkUpdate(chunk)
        });
      }
    });

    return {
      documentId: input.document.id,
      insertedDocument,
      insertedChunkCount
    };
  }

  private ensureMemoryState(datasourceId: string): RagDocumentMemoryState {
    const normalized = datasourceId.trim();
    const existing = this.memoryByDatasource.get(normalized);
    if (existing) {
      return existing;
    }
    const created: RagDocumentMemoryState = {
      documentsById: new Map<string, RagDocumentDraft>(),
      chunksById: new Map<string, RagChunkRecordDraft>()
    };
    this.memoryByDatasource.set(normalized, created);
    return created;
  }

  private toPrismaDocument(input: RagDocumentDraft): Record<string, unknown> {
    return {
      id: input.id,
      datasourceId: input.datasourceId,
      domain: input.domain,
      sourceType: input.sourceType,
      sourceRef: input.sourceRef ?? null,
      sourceVersion: input.sourceVersion,
      contentChecksum: input.contentChecksum,
      title: input.title ?? null,
      content: input.content,
      tableNames: input.tableNames,
      columnNames: input.columnNames,
      metadata: input.metadata ?? null
    };
  }

  private toPrismaDocumentUpdate(input: RagDocumentDraft): Record<string, unknown> {
    return {
      domain: input.domain,
      sourceType: input.sourceType,
      sourceRef: input.sourceRef ?? null,
      sourceVersion: input.sourceVersion,
      contentChecksum: input.contentChecksum,
      title: input.title ?? null,
      content: input.content,
      tableNames: input.tableNames,
      columnNames: input.columnNames,
      metadata: input.metadata ?? null
    };
  }

  private toPrismaChunk(input: RagChunkRecordDraft): Record<string, unknown> {
    return {
      id: input.id,
      documentId: input.documentId,
      datasourceId: input.datasourceId,
      domain: input.domain,
      chunkProfile: input.chunkProfile,
      chunkOrder: input.chunkOrder,
      content: input.content,
      contentChecksum: input.contentChecksum,
      tableNames: input.tableNames,
      columnNames: input.columnNames,
      metadata: input.metadata ?? null
    };
  }

  private toPrismaChunkUpdate(input: RagChunkRecordDraft): Record<string, unknown> {
    return {
      documentId: input.documentId,
      datasourceId: input.datasourceId,
      domain: input.domain,
      chunkProfile: input.chunkProfile,
      chunkOrder: input.chunkOrder,
      content: input.content,
      contentChecksum: input.contentChecksum,
      tableNames: input.tableNames,
      columnNames: input.columnNames,
      metadata: input.metadata ?? null
    };
  }

  private isPrimaryPersistenceConfigured(): boolean {
    return this.appConfig.databaseUrl.trim().length > 0;
  }
}
