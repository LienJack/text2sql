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
  queuedAt?: string;
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
    const queueWaitMs = this.resolveQueueWaitMs(input.queuedAt, startedAt);
    const replayRunId = this.resolveReplayRunId(input.runId, input.datasourceId, startedAt);
    const baseChunks = await this.repository.listChunksForBuild(input.datasourceId);
    const chunks = this.mergeChunks(baseChunks, input.chunks ?? []);
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
          activationLatencyMs,
          queueWaitMs
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
          error: error instanceof Error ? error.message : String(error),
          queueWaitMs
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

  private resolveQueueWaitMs(queuedAt: string | undefined, startedAt: number): number {
    if (!queuedAt) {
      return 0;
    }
    const queuedAtMs = Date.parse(queuedAt);
    if (Number.isNaN(queuedAtMs)) {
      return 0;
    }
    return Math.max(0, startedAt - queuedAtMs);
  }

  private mergeChunks(
    baseChunks: RagChunkBuildInput[],
    incrementalChunks: RagChunkBuildInput[]
  ): RagChunkBuildInput[] {
    if (incrementalChunks.length === 0) {
      return [...baseChunks];
    }
    const merged = new Map<string, RagChunkBuildInput>();
    for (const chunk of baseChunks) {
      merged.set(chunk.id, {
        ...chunk
      });
    }
    for (const chunk of incrementalChunks) {
      merged.set(chunk.id, {
        ...chunk
      });
    }
    return [...merged.values()];
  }
}
