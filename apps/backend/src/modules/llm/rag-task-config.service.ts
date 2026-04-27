import { Injectable } from "@nestjs/common";
import type {
  RagConfigSource,
  RagTaskConfig,
  RagTaskSettingsView,
  RagTaskType,
  SettingsActor
} from "@text2sql/shared-types";
import { DomainError } from "../../common/domain-error";
import { AppConfigService } from "../config/app-config.service";
import { RagTaskConfigRepository } from "../data/persistence/rag-task-config.repository";
import {
  RagTaskHealthProbeService,
  type RagRerankChallengeSummary
} from "./rag-task-health-probe.service";

export interface UpsertRagTaskConfigInput {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  enabled?: boolean;
  dimensions?: number;
  vectorVersion?: string;
  timeoutMs?: number;
  note?: string;
}

export interface CheckRagTaskConfigHealthInput {
  sampleQuery?: string;
  sampleCandidates?: string[];
  expectedDimensions?: number;
}

export interface RagTaskRuntimeConfig {
  taskType: RagTaskType;
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  dimensions?: number;
  vectorVersion?: string;
  timeoutMs: number;
  configSource: RagConfigSource;
  configId?: string;
}

@Injectable()
export class RagTaskConfigService {
  constructor(
    private readonly appConfig: AppConfigService,
    private readonly repository: RagTaskConfigRepository,
    private readonly healthProbe: RagTaskHealthProbeService
  ) {}

  async listSettingsView(actor: SettingsActor): Promise<RagTaskSettingsView> {
    const [embedding, rerank] = await Promise.all([
      this.resolveEffectiveConfig("embedding"),
      this.resolveEffectiveConfig("rerank")
    ]);
    return {
      actor,
      items: [embedding, rerank]
    };
  }

  async upsertConfig(
    taskType: RagTaskType,
    input: UpsertRagTaskConfigInput,
    actor: SettingsActor
  ): Promise<RagTaskConfig> {
    const provider = input.provider.trim();
    const model = input.model.trim();
    if (!provider || !model) {
      throw new DomainError("RAG_TASK_CONFIG_INVALID", "provider/model 不能为空。", 400, {
        taskType
      });
    }
    const created = await this.repository.upsertConfig({
      taskType,
      provider,
      model,
      baseUrl: input.baseUrl?.trim() || null,
      apiKeyCiphertext: input.apiKey?.trim() || undefined,
      apiKeyMasked: input.apiKey ? this.maskApiKey(input.apiKey) : undefined,
      enabled: input.enabled,
      dimensions: taskType === "embedding" ? (input.dimensions ?? null) : null,
      vectorVersion:
        taskType === "embedding" ? (input.vectorVersion?.trim() || null) : null,
      timeoutMs: input.timeoutMs ?? null,
      note: input.note?.trim() || null,
      actorId: actor.id
    });
    return this.resolveEffectiveConfig(taskType, created);
  }

  async checkConfigHealth(
    taskType: RagTaskType,
    input: CheckRagTaskConfigHealthInput
  ): Promise<{
    taskType: RagTaskType;
    status: "healthy" | "degraded" | "failed";
    reasonCode: string;
    message: string;
    checkedAt: string;
    latencyMs: number;
    configSource: RagConfigSource;
    config?: RagTaskConfig;
    details?: Record<string, unknown>;
    challenge?: RagRerankChallengeSummary;
    sample?: {
      reranked: Array<{
        rank: number;
        score: number;
        reason: string;
      }>;
    };
  }> {
    const start = Date.now();
    const checkedAt = new Date().toISOString();
    const persisted = await this.repository.getConfig(taskType);

    try {
      const runtime = await this.resolveRuntime(taskType);
      const healthProbe =
        taskType === "embedding"
          ? await this.healthProbe.probeEmbedding({
              runtimeDimensions: runtime.dimensions,
              expectedDimensions: input.expectedDimensions
            })
          : await this.healthProbe.probeRerank({
              sampleQuery: input.sampleQuery,
              sampleCandidates: input.sampleCandidates
            });
      const latencyMs = Date.now() - start;
      if (persisted) {
        await this.repository.updateHealth(taskType, {
          healthStatus: healthProbe.status,
          lastCheckedAt: checkedAt,
          lastHealthLatencyMs: latencyMs,
          lastHealthMessage: healthProbe.message,
          lastError: healthProbe.status === "healthy" ? null : healthProbe.message
        });
      }

      const response: {
        taskType: RagTaskType;
        status: "healthy" | "degraded" | "failed";
        reasonCode: string;
        message: string;
        checkedAt: string;
        latencyMs: number;
        configSource: RagConfigSource;
        config?: RagTaskConfig;
        details?: Record<string, unknown>;
        challenge?: RagRerankChallengeSummary;
        sample?: {
          reranked: Array<{
            rank: number;
            score: number;
            reason: string;
          }>;
        };
      } = {
        taskType,
        status: healthProbe.status,
        reasonCode: healthProbe.reasonCode,
        message: healthProbe.message,
        checkedAt,
        latencyMs: healthProbe.latencyMs,
        configSource: runtime.configSource,
        config: await this.resolveEffectiveConfig(taskType),
        details: healthProbe.details
      };

      if (taskType === "rerank") {
        const rerankProbe = healthProbe as Awaited<
          ReturnType<RagTaskHealthProbeService["probeRerank"]>
        >;
        response.challenge = rerankProbe.challenge;
        const query = input.sampleQuery?.trim() || "revenue by status";
        const candidates = input.sampleCandidates?.filter((item) => item.trim().length > 0) ?? [];
        if (candidates.length > 0) {
          response.sample = {
            reranked: this.mockSampleRerank(query, candidates)
          };
        }
      }

      return response;
    } catch (error) {
      const latencyMs = Date.now() - start;
      const message =
        error instanceof DomainError
          ? error.message
          : error instanceof Error
            ? error.message
            : "RAG 配置检测失败";
      const status: "degraded" | "failed" =
        error instanceof DomainError ? "degraded" : "failed";
      if (persisted) {
        await this.repository.updateHealth(taskType, {
          healthStatus: status,
          lastCheckedAt: checkedAt,
          lastHealthLatencyMs: latencyMs,
          lastHealthMessage: message,
          lastError: message
        });
      }
      return {
        taskType,
        status,
        reasonCode:
          status === "degraded" ? "provider_unavailable" : "unexpected_error",
        message,
        checkedAt,
        latencyMs,
        configSource: "missing",
        config: await this.resolveEffectiveConfig(taskType),
        details: {
          error:
            error instanceof DomainError
              ? error.code
              : error instanceof Error
                ? error.name
                : "unknown"
        }
      };
    }
  }

  async resolveEmbeddingRuntime(): Promise<RagTaskRuntimeConfig> {
    return this.resolveRuntime("embedding");
  }

  async resolveRerankRuntime(): Promise<RagTaskRuntimeConfig> {
    return this.resolveRuntime("rerank");
  }

  private async resolveRuntime(taskType: RagTaskType): Promise<RagTaskRuntimeConfig> {
    const stored = await this.repository.getConfig(taskType);
    const storedApiKey = stored ? await this.repository.getApiKey(taskType) : undefined;
    if (stored && this.isStoredConfigUsable(stored, storedApiKey)) {
      return {
        taskType,
        provider: stored.provider,
        model: stored.model,
        baseUrl: stored.baseUrl?.trim() || "",
        apiKey: storedApiKey?.trim() || "",
        dimensions: taskType === "embedding" ? (stored.dimensions ?? undefined) : undefined,
        vectorVersion:
          taskType === "embedding"
            ? (stored.vectorVersion?.trim() || this.appConfig.embeddingVectorVersion)
            : undefined,
        timeoutMs:
          stored.timeoutMs ??
          (taskType === "embedding"
            ? this.appConfig.embeddingTimeoutMs
            : this.appConfig.rerankTimeoutMs),
        configSource: "settings",
        configId: stored.id
      };
    }

    const fallback = this.resolveFallback(taskType);
    if (fallback.available) {
      return {
        taskType,
        provider: fallback.provider,
        model: fallback.model,
        baseUrl: fallback.baseUrl,
        apiKey: fallback.apiKey,
        dimensions: fallback.dimensions,
        vectorVersion: fallback.vectorVersion,
        timeoutMs: fallback.timeoutMs,
        configSource: "env_fallback"
      };
    }

    const code =
      taskType === "embedding"
        ? "EMBEDDING_PROVIDER_UNAVAILABLE"
        : "RERANK_PROVIDER_UNAVAILABLE";
    throw new DomainError(code, `${taskType} provider 配置不可用。`, 503, {
      taskType,
      configSource: "missing"
    });
  }

  private async resolveEffectiveConfig(
    taskType: RagTaskType,
    prefetched?: RagTaskConfig
  ): Promise<RagTaskConfig> {
    const now = new Date().toISOString();
    const stored = prefetched ?? (await this.repository.getConfig(taskType));
    const storedApiKey = stored ? await this.repository.getApiKey(taskType) : undefined;
    const fallback = this.resolveFallback(taskType);

    if (stored) {
      if (this.isStoredConfigUsable(stored, storedApiKey)) {
        return {
          ...stored,
          configSource: "settings",
          configSourceNote: null
        };
      }
      if (fallback.available) {
        return {
          ...stored,
          configSource: "env_fallback",
          configSourceNote: stored.enabled
            ? "settings_config_incomplete"
            : "settings_config_disabled"
        };
      }
      return {
        ...stored,
        configSource: "missing",
        configSourceNote: stored.enabled
          ? "settings_config_incomplete"
          : "settings_config_disabled"
      };
    }

    if (fallback.available) {
      return {
        id: `env-fallback:${taskType}`,
        taskType,
        provider: fallback.provider,
        model: fallback.model,
        baseUrl: fallback.baseUrl,
        enabled: true,
        hasApiKey: true,
        apiKeyMasked: this.maskApiKey(fallback.apiKey),
        dimensions: fallback.dimensions,
        vectorVersion: fallback.vectorVersion,
        timeoutMs: fallback.timeoutMs,
        note: null,
        healthStatus: "unknown",
        lastCheckedAt: null,
        lastHealthLatencyMs: null,
        lastHealthMessage: null,
        lastError: null,
        configSource: "env_fallback",
        configSourceNote: "using_environment_fallback",
        createdAt: now,
        updatedAt: now
      };
    }

    return {
      id: `missing:${taskType}`,
      taskType,
      provider: taskType === "embedding" ? this.appConfig.embeddingProvider : this.appConfig.rerankProvider,
      model: taskType === "embedding" ? this.appConfig.embeddingModel : this.appConfig.rerankModel,
      baseUrl: null,
      enabled: false,
      hasApiKey: false,
      apiKeyMasked: null,
      dimensions: taskType === "embedding" ? (this.appConfig.embeddingDimensions ?? null) : null,
      vectorVersion:
        taskType === "embedding" ? this.appConfig.embeddingVectorVersion : null,
      timeoutMs:
        taskType === "embedding"
          ? this.appConfig.embeddingTimeoutMs
          : this.appConfig.rerankTimeoutMs,
      note: null,
      healthStatus: "unknown",
      lastCheckedAt: null,
      lastHealthLatencyMs: null,
      lastHealthMessage: null,
      lastError: null,
      configSource: "missing",
      configSourceNote: "no_settings_or_env_config",
      createdAt: now,
      updatedAt: now
    };
  }

  private resolveFallback(taskType: RagTaskType): {
    available: boolean;
    provider: string;
    model: string;
    baseUrl: string;
    apiKey: string;
    dimensions?: number;
    vectorVersion?: string;
    timeoutMs: number;
  } {
    if (taskType === "embedding") {
      const baseUrl = this.appConfig.embeddingBaseUrl.trim();
      const apiKey = this.appConfig.embeddingApiKey.trim();
      const provider = this.appConfig.embeddingProvider.trim();
      const model = this.appConfig.embeddingModel.trim();
      return {
        available: Boolean(baseUrl && apiKey && provider && model),
        provider,
        model,
        baseUrl,
        apiKey,
        dimensions: this.appConfig.embeddingDimensions,
        vectorVersion: this.appConfig.embeddingVectorVersion,
        timeoutMs: this.appConfig.embeddingTimeoutMs
      };
    }

    const baseUrl = this.appConfig.rerankBaseUrl.trim();
    const apiKey = this.appConfig.rerankApiKey.trim();
    const provider = this.appConfig.rerankProvider.trim();
    const model = this.appConfig.rerankModel.trim();
    return {
      available: Boolean(baseUrl && apiKey && provider && model),
      provider,
      model,
      baseUrl,
      apiKey,
      timeoutMs: this.appConfig.rerankTimeoutMs
    };
  }

  private isStoredConfigUsable(config: RagTaskConfig, apiKey?: string): boolean {
    return Boolean(
      config.enabled &&
        config.provider.trim().length > 0 &&
        config.model.trim().length > 0 &&
        config.baseUrl?.trim().length &&
        apiKey?.trim().length
    );
  }

  private maskApiKey(apiKey: string): string {
    const trimmed = apiKey.trim();
    if (trimmed.length <= 8) {
      return `${trimmed.slice(0, 2)}***${trimmed.slice(-1)}`;
    }
    return `${trimmed.slice(0, 4)}***${trimmed.slice(-4)}`;
  }

  private mockSampleRerank(
    query: string,
    candidates: string[]
  ): Array<{ rank: number; score: number; reason: string }> {
    const tokens = new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9_\p{L}\p{N}]+/u)
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    );
    return candidates
      .map((candidate) => {
        const lowered = candidate.toLowerCase();
        const tokenHit = Array.from(tokens).filter((token) => lowered.includes(token)).length;
        const score = Math.max(0, Math.min(1, Number((0.4 + tokenHit * 0.18).toFixed(6))));
        return {
          score,
          reason: `token_match=${tokenHit}`
        };
      })
      .sort((left, right) => right.score - left.score)
      .map((item, index) => ({
        rank: index + 1,
        score: item.score,
        reason: item.reason
      }));
  }
}
