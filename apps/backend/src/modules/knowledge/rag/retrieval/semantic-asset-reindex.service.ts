import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { AppConfigService } from "../../../config/app-config.service";
import { RagTaskConfigService } from "../../../llm/rag-task-config.service";
import { ModelingGraphRepository } from "../../../platform/data/persistence/modeling-graph.repository";
import { RagIndexRepository } from "../../../rag/index/rag-index.repository";
import { BuildRagIndexJob } from "../../../rag/jobs/build-rag-index.job";

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
  indexVersionId?: string;
  entryCount?: number;
}

@Injectable()
export class SemanticAssetReindexService {
  constructor(
    private readonly appConfig: AppConfigService,
    private readonly ragTaskConfigService: RagTaskConfigService,
    private readonly indexRepository: RagIndexRepository,
    private readonly buildIndexJob: BuildRagIndexJob,
    private readonly modelingGraphRepository: ModelingGraphRepository
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

    const semanticAssetVersion = this.buildSemanticAssetVersion({
      datasourceId,
      workspaceId,
      triggers,
      modelingRevision,
      embeddingProfile
    });
    const sourceVersion =
      input.sourceVersion?.trim() ||
      this.buildSourceVersion({
        semanticAssetVersion,
        triggers,
        embeddingProfile
      });

    const reasonCodes = this.unique([
      input.reason?.trim() || "semantic_asset_reindex_requested",
      ...triggers.map((trigger) => `trigger:${trigger}`)
    ]);
    if (triggers.length === 0) {
      return {
        status: "skipped",
        datasourceId,
        workspaceId,
        sourceVersion,
        semanticAssetVersion,
        embeddingProfile,
        triggerSummary,
        modelingRevision,
        reasonCodes: [...reasonCodes, "skip:no_triggers"]
      };
    }

    const activeVersion = await this.indexRepository.getActiveVersion(datasourceId);
    if (!input.force && activeVersion?.sourceVersion === sourceVersion) {
      return {
        status: "skipped",
        datasourceId,
        workspaceId,
        sourceVersion,
        semanticAssetVersion,
        embeddingProfile,
        triggerSummary,
        modelingRevision,
        reasonCodes: [...reasonCodes, "skip:already_active"]
      };
    }

    const runId =
      input.runId?.trim() ||
      `semantic-asset-reindex:${datasourceId}:${Date.now()}`;
    const result = await this.buildIndexJob.run({
      datasourceId,
      sourceVersion,
      buildReason: `semantic_asset_reindex:${reasonCodes.join("|")}`,
      runId
    });

    return {
      status: "reindexed",
      datasourceId,
      workspaceId,
      sourceVersion,
      semanticAssetVersion,
      embeddingProfile,
      triggerSummary,
      modelingRevision,
      reasonCodes,
      indexVersionId: result.indexVersionId,
      entryCount: result.entryCount
    };
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

  private buildSemanticAssetVersion(input: {
    datasourceId: string;
    workspaceId?: string;
    triggers: SemanticAssetReindexTrigger[];
    modelingRevision?: number;
    embeddingProfile: {
      provider: string;
      model: string;
      dimensions?: number;
      vectorVersion: string;
      configSource: "settings" | "env_fallback" | "missing";
    };
  }): string {
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          datasourceId: input.datasourceId,
          workspaceId: input.workspaceId,
          triggers: [...input.triggers].sort(),
          modelingRevision: input.modelingRevision,
          embeddingProfile: input.embeddingProfile
        })
      )
      .digest("hex")
      .slice(0, 16);
    return `semantic-assets-${fingerprint}`;
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
