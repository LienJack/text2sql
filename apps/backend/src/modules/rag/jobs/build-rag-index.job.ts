import { Injectable } from "@nestjs/common";
import {
  RagIndexBuilderService,
  type RagIndexBuildManifestContext,
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
  manifest?: RagIndexBuildManifestContext;
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
    if (input.manifest) {
      await this.replayRepository.writeReplay({
        runId: replayRunId,
        replayKey: `manifest:prepared:${input.manifest.fingerprint}`,
        datasourceId: input.datasourceId,
        stage: "manifest_prepared",
        payload: {
          manifestFingerprint: input.manifest.fingerprint,
          sourceVersion: input.sourceVersion,
          buildReason: input.buildReason ?? "scheduled_build",
          summary: input.manifest.summary,
          degradedFamilies: this.resolveFamiliesByStatus(input.manifest, "degraded"),
          skippedFamilies: this.resolveFamiliesByStatus(input.manifest, "skipped"),
          typedChunkInputCount: input.chunks?.length ?? 0
        }
      });
    }
    await this.replayRepository.writeReplay({
      runId: replayRunId,
      replayKey: `index:build:started:${startedAt}`,
      datasourceId: input.datasourceId,
      stage: "index_build_started",
      payload: {
        sourceVersion: input.sourceVersion,
        buildReason: input.buildReason ?? "scheduled_build",
        manifestFingerprint: input.manifest?.fingerprint,
        baseChunkCount: baseChunks.length,
        incrementalChunkCount: input.chunks?.length ?? 0,
        mergedChunkCount: chunks.length,
        queueWaitMs
      }
    });
    try {
      const result = await this.builder.buildAndActivate({
        datasourceId: input.datasourceId,
        sourceVersion: input.sourceVersion,
        buildReason: input.buildReason ?? "scheduled_build",
        createdByRunId: input.runId,
        activatedByRunId: input.runId,
        chunks,
        manifest: input.manifest
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
          manifestFingerprint: input.manifest?.fingerprint,
          manifestSummary: input.manifest?.summary,
          entryCount: result.entryCount,
          archivedChannels: result.archivedChannels,
          denseMode: result.denseMode,
          activation: result.activation,
          activationLatencyMs,
          queueWaitMs
        }
      });

      await this.replayRepository.writeReplay({
        runId: replayRunId,
        replayKey: `index:activation:completed:${result.indexVersionId}`,
        datasourceId: input.datasourceId,
        stage: "index_activation_completed",
        indexVersionId: result.indexVersionId,
        payload: {
          sourceVersion: input.sourceVersion,
          manifestFingerprint: input.manifest?.fingerprint,
          activatedAt: result.activation.activatedAt,
          replacedVersionIds: result.activation.replacedVersionIds,
          replacedSourceVersions: result.activation.replacedSourceVersions
        }
      });

      if (result.activation.replacedVersionIds.length > 0) {
        await this.replayRepository.writeReplay({
          runId: replayRunId,
          replayKey: `index:activation:replaced_previous:${result.indexVersionId}`,
          datasourceId: input.datasourceId,
          stage: "activation_replaced_previous",
          indexVersionId: result.indexVersionId,
          payload: {
            sourceVersion: input.sourceVersion,
            manifestFingerprint: input.manifest?.fingerprint,
            replacedVersionIds: result.activation.replacedVersionIds,
            replacedSourceVersions: result.activation.replacedSourceVersions
          }
        });
      }

      const indexedChunks = await this.repository.listEntriesByVersion(result.indexVersionId);
      for (const entry of indexedChunks) {
        const lineage = this.resolveChunkLineage(entry.metadata);
        await this.replayRepository.writeReplay({
          runId: replayRunId,
          replayKey: `chunk:indexed:${entry.chunkId}`,
          datasourceId: entry.datasourceId,
          stage: "chunk_indexed",
          indexVersionId: entry.indexVersionId,
          chunkId: entry.chunkId,
          payload: {
            domain: entry.domain,
            lexicalContentLength: entry.lexicalContent.length,
            ...lineage
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
          manifestFingerprint: input.manifest?.fingerprint,
          manifestSummary: input.manifest?.summary,
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

  private resolveFamiliesByStatus(
    manifest: RagIndexBuildManifestContext,
    status: "degraded" | "skipped"
  ): string[] {
    const families = (manifest.entries ?? [])
      .filter((entry) => entry.status === status && entry.family)
      .map((entry) => entry.family as string);
    return Array.from(new Set(families)).sort();
  }

  private resolveChunkLineage(metadata: string | undefined): Record<string, unknown> {
    const parsed = this.safeParseJson(metadata);
    const sourceMetadata = this.isRecord(parsed?.sourceMetadata)
      ? parsed.sourceMetadata
      : this.isRecord(parsed)
        ? parsed
        : undefined;
    if (!sourceMetadata) {
      return {};
    }
    return {
      assetFamily: this.readString(sourceMetadata.assetFamily),
      manifestFingerprint: this.readString(sourceMetadata.manifestFingerprint),
      manifestEntryId: this.readString(sourceMetadata.manifestEntryId),
      sourceRef: sourceMetadata.semanticAssetSourceRef,
      sourceVersion: this.readString(sourceMetadata.sourceVersion),
      visibilityScope: this.readString(sourceMetadata.visibilityScope),
      preparationStatus: this.readString(sourceMetadata.preparationStatus),
      reasonCodes: Array.isArray(sourceMetadata.reasonCodes)
        ? sourceMetadata.reasonCodes.filter((item): item is string => typeof item === "string")
        : undefined,
      chunkProfile:
        this.readString(sourceMetadata.chunkProfile) ?? this.readString(parsed?.chunkProfile)
    };
  }

  private safeParseJson(value: string | undefined): Record<string, unknown> | undefined {
    if (!value) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(value) as unknown;
      return this.isRecord(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private readString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
  }
}
