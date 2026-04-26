import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { DomainError } from "../../../common/domain-error";
import { EmbeddingRouterService } from "../../llm/embedding-router.service";
import {
  type RagChunkBuildInput,
  type RagChunkIndexEntryRecord,
  RagIndexRepository
} from "./rag-index.repository";

export interface RagIndexBuildRequest {
  datasourceId: string;
  sourceVersion: string;
  buildReason?: string;
  createdByRunId?: string;
  activatedByRunId?: string;
  chunks?: RagChunkBuildInput[];
}

export interface RagIndexBuildResult {
  indexVersionId: string;
  datasourceId: string;
  status: "active";
  entryCount: number;
  archivedChannels: Array<"lexical" | "dense">;
  denseMode: "external_provider" | "mock_provider" | "dense_unavailable";
  denseUnavailableReason?: string;
  denseProvider?: string;
  denseModel?: string;
  denseDimensions?: number;
  vectorVersion?: string;
  indexVersion?: string;
}

@Injectable()
export class RagIndexBuilderService {
  constructor(
    private readonly repository: RagIndexRepository,
    private readonly embeddingRouter: EmbeddingRouterService
  ) {}

  async buildAndActivate(input: RagIndexBuildRequest): Promise<RagIndexBuildResult> {
    const chunks =
      input.chunks ?? (await this.repository.listChunksForBuild(input.datasourceId));
    if (chunks.length === 0) {
      throw new DomainError(
        "RAG_INDEX_BUILD_EMPTY_INPUT",
        "索引构建输入为空，无法生成新版本。",
        400,
        {
          datasourceId: input.datasourceId
        }
      );
    }

    const version = await this.repository.createBuildingVersion({
      datasourceId: input.datasourceId,
      sourceVersion: input.sourceVersion,
      buildReason: input.buildReason,
      createdByRunId: input.createdByRunId
    });

    try {
      const now = new Date().toISOString();
      const denseEmbedding = await this.resolveDenseEmbedding({
        chunks,
        indexVersionId: version.id
      });
      const entries = chunks.map((chunk) =>
        this.toIndexEntry({
          chunk,
          indexVersionId: version.id,
          timestamp: now,
          denseEmbedding
        })
      );

      await this.repository.replaceEntriesForVersion(version.id, entries);
      await this.repository.markVersionReady(version.id);
      const active = await this.repository.activateVersion({
        datasourceId: input.datasourceId,
        indexVersionId: version.id,
        activatedByRunId: input.activatedByRunId
      });
      const archived = await this.repository.listEntriesByVersion(version.id);

      return {
        indexVersionId: active.id,
        datasourceId: active.datasourceId,
        status: "active",
        entryCount: archived.length,
        archivedChannels: ["lexical", "dense"],
        denseMode: denseEmbedding.mode,
        denseUnavailableReason: denseEmbedding.unavailableReason,
        denseProvider: denseEmbedding.metadata?.provider,
        denseModel: denseEmbedding.metadata?.model,
        denseDimensions: denseEmbedding.metadata?.dimensions,
        vectorVersion: denseEmbedding.metadata?.vectorVersion,
        indexVersion: denseEmbedding.metadata?.indexVersion
      };
    } catch (error) {
      await this.safeDeprecate(version.id);
      throw error;
    }
  }

  private toIndexEntry(input: {
    chunk: RagChunkBuildInput;
    indexVersionId: string;
    timestamp: string;
    denseEmbedding: DenseEmbeddingResolution;
  }): RagChunkIndexEntryRecord {
    const { chunk, indexVersionId, timestamp, denseEmbedding } = input;
    const lexicalContent = chunk.content.trim();
    if (!lexicalContent) {
      throw new DomainError("RAG_INDEX_EMPTY_CHUNK", "切块内容为空，无法构建索引条目。", 400, {
        chunkId: chunk.id,
        datasourceId: chunk.datasourceId
      });
    }

    return {
      id: this.buildEntryId(indexVersionId, chunk.id, lexicalContent),
      indexVersionId,
      chunkId: chunk.id,
      datasourceId: chunk.datasourceId,
      domain: chunk.domain,
      lexicalContent,
      denseVector: denseEmbedding.vectorsByChunkId.get(chunk.id),
      metadata: this.buildEntryMetadata({
        rawMetadata: chunk.metadata,
        denseEmbedding,
        chunkDomain: chunk.domain
      }),
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }

  private buildEntryId(indexVersionId: string, chunkId: string, content: string): string {
    return createHash("sha256")
      .update(`${indexVersionId}|${chunkId}|${content}`)
      .digest("hex");
  }

  private buildEntryMetadata(input: {
    rawMetadata?: string;
    denseEmbedding: DenseEmbeddingResolution;
    chunkDomain: string;
  }): string {
    const { rawMetadata, denseEmbedding, chunkDomain } = input;
    const sourceMetadata =
      rawMetadata && rawMetadata.trim().length > 0
        ? this.safeParseJson(rawMetadata)
        : undefined;

    const denseMetadata = {
      mode: denseEmbedding.mode,
      provider: denseEmbedding.metadata?.provider,
      model: denseEmbedding.metadata?.model,
      dimensions: denseEmbedding.metadata?.dimensions,
      vectorVersion: denseEmbedding.metadata?.vectorVersion,
      indexVersion: denseEmbedding.metadata?.indexVersion,
      scope: denseEmbedding.metadata?.scope ?? "datasource",
      assetType: chunkDomain,
      unavailableReason: denseEmbedding.unavailableReason
    };

    return JSON.stringify({
      denseMode: denseEmbedding.mode,
      lexicalMode: "plain_text",
      dense: denseMetadata,
      ...(sourceMetadata ? { sourceMetadata } : {})
    });
  }

  private safeParseJson(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return { raw: value };
    }
  }

  private async safeDeprecate(indexVersionId: string): Promise<void> {
    const version = await this.repository.getVersionById(indexVersionId);
    if (!version || version.status === "active") {
      return;
    }
    await this.repository.markVersionDeprecated(indexVersionId);
  }

  private async resolveDenseEmbedding(input: {
    chunks: RagChunkBuildInput[];
    indexVersionId: string;
  }): Promise<DenseEmbeddingResolution> {
    const texts = input.chunks.map((chunk) => chunk.content.trim());
    try {
      const embeddings = await this.embeddingRouter.embed({
        texts,
        indexVersion: input.indexVersionId,
        scope: "datasource",
        assetType: "rag_chunk"
      });
      if (embeddings.length !== input.chunks.length) {
        return {
          mode: "dense_unavailable",
          vectorsByChunkId: new Map<string, string>(),
          unavailableReason: "dense_unavailable_embedding_count_mismatch"
        };
      }

      const vectorsByChunkId = new Map<string, string>();
      for (let index = 0; index < input.chunks.length; index += 1) {
        const chunk = input.chunks[index];
        const vector = embeddings[index]?.vector;
        if (!Array.isArray(vector) || vector.length === 0) {
          continue;
        }
        vectorsByChunkId.set(chunk.id, JSON.stringify(vector));
      }
      const metadata = embeddings[0]?.metadata;
      const mode: DenseEmbeddingResolution["mode"] = metadata?.provider.endsWith(":mock")
        ? "mock_provider"
        : "external_provider";
      return {
        mode,
        vectorsByChunkId,
        metadata
      };
    } catch (error) {
      const unavailableReason =
        error instanceof DomainError
          ? error.code.toLowerCase()
          : "dense_unavailable_provider_error";
      return {
        mode: "dense_unavailable",
        vectorsByChunkId: new Map<string, string>(),
        unavailableReason
      };
    }
  }
}

interface DenseEmbeddingResolution {
  mode: "external_provider" | "mock_provider" | "dense_unavailable";
  vectorsByChunkId: Map<string, string>;
  unavailableReason?: string;
  metadata?: {
    provider: string;
    model: string;
    dimensions: number;
    vectorVersion: string;
    indexVersion?: string;
    scope?: string;
  };
}
