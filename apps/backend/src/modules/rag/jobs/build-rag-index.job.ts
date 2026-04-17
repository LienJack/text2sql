import { Injectable } from "@nestjs/common";
import {
  RagIndexBuilderService,
  type RagIndexBuildResult
} from "../index/rag-index-builder.service";
import {
  RagIndexRepository,
  type RagChunkBuildInput
} from "../index/rag-index.repository";
import { RagIngestionMetricsService } from "../observability/rag-ingestion-metrics.service";
import { RagReplayRepository } from "../observability/rag-replay.repository";

export interface BuildRagIndexJobInput {
  datasourceId: string;
  sourceVersion: string;
  buildReason?: string;
  runId?: string;
  chunks?: RagChunkBuildInput[];
}

@Injectable()
export class BuildRagIndexJob {
  constructor(
    private readonly builder: RagIndexBuilderService,
    private readonly repository: RagIndexRepository,
    private readonly ingestionMetrics: RagIngestionMetricsService,
    private readonly replayRepository: RagReplayRepository
  ) {}

  async run(input: BuildRagIndexJobInput): Promise<RagIndexBuildResult> {
    const startedAt = Date.now();
    const replayRunId = this.resolveReplayRunId(input.runId, input.datasourceId, startedAt);
    const chunks =
      input.chunks ?? (await this.repository.listChunksForBuild(input.datasourceId));
    try {
      const result = await this.builder.buildAndActivate({
        datasourceId: input.datasourceId,
        sourceVersion: input.sourceVersion,
        buildReason: input.buildReason ?? "scheduled_build",
        createdByRunId: input.runId,
        activatedByRunId: input.runId,
        chunks
      });
      const activationLatencyMs = Date.now() - startedAt;
      this.ingestionMetrics.recordBuild({
        datasourceId: input.datasourceId,
        status: "success",
        indexVersionId: result.indexVersionId,
        sourceVersion: input.sourceVersion,
        activationLatencyMs
      });

      await this.replayRepository.writeReplay({
        runId: replayRunId,
        replayKey: `index:build:completed:${result.indexVersionId}`,
        datasourceId: input.datasourceId,
        stage: "index_build_completed",
        indexVersionId: result.indexVersionId,
        payload: {
          sourceVersion: input.sourceVersion,
          buildReason: input.buildReason ?? "scheduled_build",
          entryCount: result.entryCount,
          archivedChannels: result.archivedChannels,
          denseMode: result.denseMode,
          activationLatencyMs
        }
      });

      const indexedChunks = await this.repository.listEntriesByVersion(result.indexVersionId);
      for (const entry of indexedChunks) {
        await this.replayRepository.writeReplay({
          runId: replayRunId,
          replayKey: `chunk:indexed:${entry.chunkId}`,
          datasourceId: entry.datasourceId,
          stage: "chunk_indexed",
          indexVersionId: entry.indexVersionId,
          chunkId: entry.chunkId,
          payload: {
            domain: entry.domain,
            lexicalContentLength: entry.lexicalContent.length
          }
        });
      }

      return result;
    } catch (error) {
      this.ingestionMetrics.recordBuild({
        datasourceId: input.datasourceId,
        status: "failure",
        sourceVersion: input.sourceVersion,
        failureReason: this.resolveFailureReason(error)
      });
      await this.replayRepository.writeReplay({
        runId: replayRunId,
        replayKey: `index:build:failed:${startedAt}`,
        datasourceId: input.datasourceId,
        stage: "index_build_failed",
        payload: {
          sourceVersion: input.sourceVersion,
          buildReason: input.buildReason ?? "scheduled_build",
          error: error instanceof Error ? error.message : String(error)
        }
      });
      throw error;
    }
  }

  private resolveReplayRunId(
    runId: string | undefined,
    datasourceId: string,
    startedAt: number
  ): string {
    const normalized = runId?.trim();
    if (normalized) {
      return normalized;
    }
    return `rag-build:${datasourceId}:${startedAt}`;
  }

  private resolveFailureReason(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message.trim().toLowerCase();
    }
    return "unknown";
  }
}
