import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { DomainError } from "../../../common/domain-error";
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
  denseMode: "placeholder_vector_string";
}

@Injectable()
export class RagIndexBuilderService {
  constructor(private readonly repository: RagIndexRepository) {}

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
      const entries = chunks.map((chunk) => this.toIndexEntry(chunk, version.id, now));

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
        denseMode: "placeholder_vector_string"
      };
    } catch (error) {
      await this.safeDeprecate(version.id);
      throw error;
    }
  }

  private toIndexEntry(
    chunk: RagChunkBuildInput,
    indexVersionId: string,
    timestamp: string
  ): RagChunkIndexEntryRecord {
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
      denseVector: this.buildPlaceholderDenseVector(lexicalContent),
      metadata: this.buildEntryMetadata(chunk.metadata),
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }

  private buildEntryId(indexVersionId: string, chunkId: string, content: string): string {
    return createHash("sha256")
      .update(`${indexVersionId}|${chunkId}|${content}`)
      .digest("hex");
  }

  private buildPlaceholderDenseVector(content: string): string {
    const digest = createHash("sha256").update(content).digest();
    const dimensions = 8;
    const vector = Array.from({ length: dimensions }, (_, index) => {
      const byte = digest[index] ?? 0;
      const normalized = byte / 255;
      const scaled = normalized * 2 - 1;
      return Number(scaled.toFixed(6));
    });
    return JSON.stringify(vector);
  }

  private buildEntryMetadata(rawMetadata?: string): string {
    const sourceMetadata =
      rawMetadata && rawMetadata.trim().length > 0
        ? this.safeParseJson(rawMetadata)
        : undefined;

    return JSON.stringify({
      denseMode: "placeholder_vector_string",
      lexicalMode: "plain_text",
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
}
