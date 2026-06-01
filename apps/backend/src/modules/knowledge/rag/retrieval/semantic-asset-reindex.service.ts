import { Injectable } from "@nestjs/common";
import { AppConfigService } from "../../../config/app-config.service";
import { RagTaskConfigService } from "../../../llm/rag-task-config.service";
import { ModelingGraphRepository } from "../../../platform/data/persistence/modeling-graph.repository";
import { RagIndexRepository } from "../../../rag/index/rag-index.repository";
import type { RagChunkBuildInput } from "../../../rag/index/rag-index.repository";
import type { RagIndexBuildManifestContext } from "../../../rag/index/rag-index-builder.service";
import { RagDocumentFactory } from "../../../rag/ingestion/rag-document.factory";
import { BuildRagIndexJob } from "../../../rag/jobs/build-rag-index.job";
import { RagQualityService } from "../../../rag/quality/rag-quality.service";
import type {
  SemanticAssetManifest,
  SemanticAssetManifestSummary
} from "../preparation/semantic-asset-manifest.types";
import { SemanticAssetReadinessService } from "../preparation/semantic-asset-readiness.service";
import { SemanticAssetPreparerService } from "../preparation/semantic-asset-preparer.service";
import type { SemanticAssetSourceSnapshot } from "../preparation/semantic-asset-source-snapshot.types";
import { SEMANTIC_ASSET_REASON_CODES } from "../preparation/semantic-asset-reason-codes";

export const SEMANTIC_ASSET_REINDEX_TRIGGERS = [
  "schema",
  "modeling_revision",
  "examples",
  "instructions",
  "prior_sql",
  "embedding_model"
] as const;

export type SemanticAssetReindexTrigger = (typeof SEMANTIC_ASSET_REINDEX_TRIGGERS)[number];

export interface SemanticAssetReindexRequest {
  datasourceId: string;
  workspaceId?: string;
  triggers: SemanticAssetReindexTrigger[];
  reason?: string;
  runId?: string;
  force?: boolean;
  sourceVersion?: string;
  sourceSnapshots?: SemanticAssetSourceSnapshot[];
}

export interface SemanticAssetReindexResult {
  status: "reindexed" | "skipped";
  datasourceId: string;
  workspaceId?: string;
  sourceVersion: string;
  semanticAssetVersion: string;
  embeddingProfile: {
    provider: string;
    model: string;
    dimensions?: number;
    vectorVersion: string;
    configSource: "settings" | "env_fallback" | "missing";
  };
  triggerSummary: Record<SemanticAssetReindexTrigger, boolean>;
  modelingRevision?: number;
  reasonCodes: string[];
  runId?: string;
  manifestSummary: SemanticAssetManifestSummary;
  preparedSourceCount?: number;
  typedChunkInputCount?: number;
  excludedSourceCount?: number;
  indexVersionId?: string;
  entryCount?: number;
  lifecycle: SemanticAssetReindexLifecycleSummary;
}

export interface SemanticAssetReindexLifecycleSummary {
  status:
    | "skipped_no_triggers"
    | "missing_active"
    | "already_active"
    | "stale_rebuildable"
    | "activated";
  latestManifestFingerprint: string;
  activeManifestFingerprint?: string;
  activeIndexVersionId?: string;
  activeSourceVersion?: string;
  activatedIndexVersionId?: string;
  previousActiveIndexVersionId?: string;
  rebuildable: boolean;
  staleReasons: string[];
}

@Injectable()
export class SemanticAssetReindexService {
  constructor(
    private readonly appConfig: AppConfigService,
    private readonly ragTaskConfigService: RagTaskConfigService,
    private readonly indexRepository: RagIndexRepository,
    private readonly buildIndexJob: BuildRagIndexJob,
    private readonly modelingGraphRepository: ModelingGraphRepository,
    private readonly semanticAssetPreparer: SemanticAssetPreparerService,
    private readonly ragDocumentFactory: RagDocumentFactory,
    private readonly semanticAssetReadiness: SemanticAssetReadinessService,
    private readonly ragQualityService: RagQualityService
  ) {}

  async reindex(input: SemanticAssetReindexRequest): Promise<SemanticAssetReindexResult> {
    const datasourceId = input.datasourceId.trim();
    const workspaceId = input.workspaceId?.trim() || undefined;
    const triggers = this.normalizeTriggers(input.triggers);
    const triggerSummary = this.toTriggerSummary(triggers);
    const modelingRevision = await this.resolveModelingRevision({
      workspaceId,
      datasourceId,
      includeModelingRevision: triggerSummary.modeling_revision
    });
    const embeddingProfile = await this.resolveEmbeddingProfile();
    const reasonCodes = this.unique([
      input.reason?.trim() || SEMANTIC_ASSET_REASON_CODES.semanticAssetReindexRequested,
      ...triggers.map((trigger) => `trigger:${trigger}`)
    ]);
    const preparation = this.semanticAssetPreparer.prepare({
      datasourceId,
      workspaceId,
      triggers,
      modelingRevision,
      embeddingProfile,
      sourceVersion: input.sourceVersion?.trim(),
      reasonCodes,
      sourceSnapshots: input.sourceSnapshots ?? []
    });
    const manifestSummary = preparation.manifestSummary;
    const manifest = preparation.manifest;
    const semanticAssetVersion = manifest.fingerprint;
    const sourceVersion =
      input.sourceVersion?.trim() ||
      this.buildSourceVersion({
        semanticAssetVersion,
        triggers,
        embeddingProfile
      });

    if (triggers.length === 0) {
      const result: SemanticAssetReindexResult = {
        status: "skipped",
        datasourceId,
        workspaceId,
        sourceVersion,
        semanticAssetVersion,
        embeddingProfile,
        triggerSummary,
        modelingRevision,
        reasonCodes: [...reasonCodes, "skip:no_triggers"],
        runId: input.runId?.trim() || undefined,
        manifestSummary,
        preparedSourceCount: preparation.sourceSnapshots.length,
        typedChunkInputCount: preparation.ingestionSources.length,
        excludedSourceCount: preparation.excludedSnapshots.length,
        lifecycle: {
          status: "skipped_no_triggers",
          latestManifestFingerprint: semanticAssetVersion,
          rebuildable: false,
          staleReasons: []
        }
      };
      this.recordReadinessAndQuality(result);
      return result;
    }

    const activeVersion = await this.indexRepository.getActiveVersion(datasourceId);
    const lifecycleBeforeBuild = this.resolveLifecycle({
      activeVersion,
      sourceVersion,
      semanticAssetVersion
    });
    if (!input.force && activeVersion?.sourceVersion === sourceVersion) {
      const result: SemanticAssetReindexResult = {
        status: "skipped",
        datasourceId,
        workspaceId,
        sourceVersion,
        semanticAssetVersion,
        embeddingProfile,
        triggerSummary,
        modelingRevision,
        reasonCodes: [...reasonCodes, SEMANTIC_ASSET_REASON_CODES.skippedAlreadyActive],
        runId: input.runId?.trim() || undefined,
        manifestSummary,
        preparedSourceCount: preparation.sourceSnapshots.length,
        typedChunkInputCount: preparation.ingestionSources.length,
        excludedSourceCount: preparation.excludedSnapshots.length,
        lifecycle: {
          ...lifecycleBeforeBuild,
          status: "already_active",
          rebuildable: false
        }
      };
      this.recordReadinessAndQuality(result);
      return result;
    }

    const runId =
      input.runId?.trim() ||
      `semantic-asset-reindex:${datasourceId}:${Date.now()}`;
    const result = await this.buildIndexJob.run({
      datasourceId,
      sourceVersion,
      buildReason: `semantic_asset_reindex:${reasonCodes.join("|")}`,
      runId,
      chunks: this.buildTypedChunks(preparation.ingestionSources),
      manifest: this.toBuildManifestContext(manifest, manifestSummary)
    });

    const reindexResult: SemanticAssetReindexResult = {
      status: "reindexed",
      datasourceId,
      workspaceId,
      sourceVersion,
      semanticAssetVersion,
      embeddingProfile,
      triggerSummary,
      modelingRevision,
      reasonCodes,
      runId,
      manifestSummary,
      preparedSourceCount: preparation.sourceSnapshots.length,
      typedChunkInputCount: preparation.ingestionSources.length,
      excludedSourceCount: preparation.excludedSnapshots.length,
      indexVersionId: result.indexVersionId,
      entryCount: result.entryCount,
      lifecycle: {
        ...lifecycleBeforeBuild,
        status: "activated",
        activatedIndexVersionId: result.indexVersionId,
        previousActiveIndexVersionId: activeVersion?.id,
        rebuildable: false
      }
    };
    this.recordReadinessAndQuality(reindexResult);
    return reindexResult;
  }

  private recordReadinessAndQuality(result: SemanticAssetReindexResult): void {
    if (result.lifecycle.status === "activated" || result.lifecycle.status === "already_active") {
      this.semanticAssetReadiness.recordActivation({
        datasourceId: result.datasourceId,
        workspaceId: result.workspaceId,
        runId: result.runId,
        sourceVersion: result.sourceVersion,
        indexVersionId:
          result.lifecycle.activatedIndexVersionId ??
          result.lifecycle.activeIndexVersionId ??
          result.indexVersionId,
        manifestSummary: result.manifestSummary,
        previousActiveIndexVersionId: result.lifecycle.previousActiveIndexVersionId,
        staleReasons: result.lifecycle.staleReasons
      });
    }
    this.ragQualityService.recordPreparationPlane({
      runId:
        result.runId ??
        result.lifecycle.activatedIndexVersionId ??
        result.lifecycle.activeIndexVersionId ??
        result.indexVersionId ??
        result.datasourceId,
      datasourceId: result.datasourceId,
      manifestFingerprint: result.semanticAssetVersion,
      activeIndexVersionId:
        result.lifecycle.activatedIndexVersionId ??
        result.lifecycle.activeIndexVersionId ??
        result.indexVersionId,
      familyCounts: result.manifestSummary.familyCounts as Record<string, number>,
      preparedEntryCount: result.manifestSummary.preparedEntryCount,
      degradedEntryCount: result.manifestSummary.degradedEntryCount,
      skippedEntryCount: result.manifestSummary.skippedEntryCount,
      staleReasons: result.lifecycle.staleReasons,
      lifecycleStatus: result.lifecycle.status
    });
  }

  private buildTypedChunks(
    ingestionSources: ReturnType<SemanticAssetPreparerService["prepare"]>["ingestionSources"]
  ): RagChunkBuildInput[] {
    return ingestionSources.flatMap((source) => {
      const build = this.ragDocumentFactory.create(source);
      return build.chunks.map((chunk) => ({
        id: chunk.id,
        datasourceId: chunk.datasourceId,
        domain: chunk.domain,
        content: chunk.content,
        metadata: chunk.metadata
      }));
    });
  }

  private toBuildManifestContext(
    manifest: SemanticAssetManifest,
    summary: SemanticAssetManifestSummary
  ): RagIndexBuildManifestContext {
    return {
      fingerprint: manifest.fingerprint,
      summary: {
        entryCount: summary.entryCount,
        preparedEntryCount: summary.preparedEntryCount,
        skippedEntryCount: summary.skippedEntryCount,
        degradedEntryCount: summary.degradedEntryCount,
        familyCounts: summary.familyCounts as Record<string, number>,
        reasonCodes: summary.reasonCodes,
        embeddingProfile: summary.embeddingProfile,
        sourceSnapshotSummary: summary.sourceSnapshotSummary
      },
      entries: manifest.entries.map((entry) => ({
        id: entry.id,
        family: entry.family,
        status: entry.status,
        sourceRef: entry.sourceRef,
        sourceVersion: entry.sourceVersion,
        reasonCodes: entry.reasonCodes
      }))
    };
  }

  private resolveLifecycle(input: {
    activeVersion?: { id: string; sourceVersion: string };
    sourceVersion: string;
    semanticAssetVersion: string;
  }): SemanticAssetReindexLifecycleSummary {
    if (!input.activeVersion) {
      return {
        status: "missing_active",
        latestManifestFingerprint: input.semanticAssetVersion,
        rebuildable: true,
        staleReasons: []
      };
    }
    const activeManifestFingerprint = this.extractManifestFingerprint(
      input.activeVersion.sourceVersion
    );
    const alreadyActive = input.activeVersion.sourceVersion === input.sourceVersion;
    return {
      status: alreadyActive ? "already_active" : "stale_rebuildable",
      latestManifestFingerprint: input.semanticAssetVersion,
      activeManifestFingerprint,
      activeIndexVersionId: input.activeVersion.id,
      activeSourceVersion: input.activeVersion.sourceVersion,
      rebuildable: !alreadyActive,
      staleReasons: alreadyActive
        ? []
        : [SEMANTIC_ASSET_REASON_CODES.staleSourceVersion]
    };
  }

  private extractManifestFingerprint(sourceVersion: string): string | undefined {
    const normalized = sourceVersion.trim();
    if (!normalized) {
      return undefined;
    }
    return normalized.split(":")[0];
  }

  private normalizeTriggers(triggers: SemanticAssetReindexTrigger[]): SemanticAssetReindexTrigger[] {
    if (!Array.isArray(triggers) || triggers.length === 0) {
      return [];
    }
    const allowed = new Set(SEMANTIC_ASSET_REINDEX_TRIGGERS);
    return this.unique(
      triggers
        .map((trigger) => trigger.trim() as SemanticAssetReindexTrigger)
        .filter((trigger): trigger is SemanticAssetReindexTrigger => allowed.has(trigger))
    ) as SemanticAssetReindexTrigger[];
  }

  private toTriggerSummary(
    triggers: SemanticAssetReindexTrigger[]
  ): Record<SemanticAssetReindexTrigger, boolean> {
    const triggerSet = new Set(triggers);
    return {
      schema: triggerSet.has("schema"),
      modeling_revision: triggerSet.has("modeling_revision"),
      examples: triggerSet.has("examples"),
      instructions: triggerSet.has("instructions"),
      prior_sql: triggerSet.has("prior_sql"),
      embedding_model: triggerSet.has("embedding_model")
    };
  }

  private buildSourceVersion(input: {
    semanticAssetVersion: string;
    triggers: SemanticAssetReindexTrigger[];
    embeddingProfile: {
      provider: string;
      model: string;
      vectorVersion: string;
      configSource: "settings" | "env_fallback" | "missing";
    };
  }): string {
    const triggerPart = input.triggers.join("+") || "none";
    return `${input.semanticAssetVersion}:${input.embeddingProfile.provider}:${input.embeddingProfile.model}:${input.embeddingProfile.vectorVersion}:${input.embeddingProfile.configSource}:${triggerPart}`;
  }

  private async resolveEmbeddingProfile(): Promise<{
    provider: string;
    model: string;
    dimensions?: number;
    vectorVersion: string;
    configSource: "settings" | "env_fallback" | "missing";
  }> {
    try {
      const runtime = await this.ragTaskConfigService.resolveEmbeddingRuntime();
      return {
        provider: runtime.provider,
        model: runtime.model,
        dimensions: runtime.dimensions,
        vectorVersion: runtime.vectorVersion ?? this.appConfig.embeddingVectorVersion,
        configSource: runtime.configSource
      };
    } catch {
      return {
        provider: this.appConfig.embeddingProvider,
        model: this.appConfig.embeddingModel,
        dimensions: this.appConfig.embeddingDimensions,
        vectorVersion: this.appConfig.embeddingVectorVersion,
        configSource: "missing"
      };
    }
  }

  private async resolveModelingRevision(input: {
    workspaceId?: string;
    datasourceId: string;
    includeModelingRevision: boolean;
  }): Promise<number | undefined> {
    if (!input.includeModelingRevision || !input.workspaceId) {
      return undefined;
    }
    const scope = await this.modelingGraphRepository.getLatestScopeState({
      workspaceId: input.workspaceId,
      datasourceId: input.datasourceId
    });
    return scope.activeRevision;
  }

  private unique(values: string[]): string[] {
    return Array.from(new Set(values.filter((item) => item.trim().length > 0)));
  }
}
