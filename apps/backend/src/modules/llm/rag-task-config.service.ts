import { Injectable } from "@nestjs/common";
import type {
  RagConfigSource,
  RagHealthCheckedAgainst,
  RagTaskConfig,
  RagTaskConfigDraftInput,
  RagTaskConfigHealthResult,
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
  draft?: RagTaskConfigDraftInput;
}

export interface CheckRagTaskConfigHealthContext {
  requestId?: string;
  traceId?: string;
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
    input: CheckRagTaskConfigHealthInput,
    context?: CheckRagTaskConfigHealthContext
  ): Promise<RagTaskConfigHealthResult> {
    const start = Date.now();
    const checkedAt = new Date().toISOString();
    const persisted = await this.repository.getConfig(taskType);
    const checkedAgainst: RagHealthCheckedAgainst = input.draft ? "draft" : "persisted";

    try {
      const runtime = input.draft
        ? await this.resolveRuntimeFromDraft(taskType, input.draft, persisted)
        : await this.resolveRuntime(taskType);
      const healthProbe =
        taskType === "embedding"
          ? await this.healthProbe.probeEmbedding({
              runtime,
              expectedDimensions: input.expectedDimensions
            })
          : await this.healthProbe.probeRerank({
              runtime,
              sampleQuery: input.sampleQuery,
              sampleCandidates: input.sampleCandidates
            });
      const latencyMs = Date.now() - start;
      if (persisted && checkedAgainst === "persisted") {
        await this.repository.updateHealth(taskType, {
          healthStatus: healthProbe.status,
          lastCheckedAt: checkedAt,
          lastHealthLatencyMs: latencyMs,
          lastHealthMessage: healthProbe.message,
          lastError: healthProbe.status === "healthy" ? null : healthProbe.message
        });
      }

      const response: RagTaskConfigHealthResult = {
        taskType,
        status: healthProbe.status,
        reasonCode: healthProbe.reasonCode,
        message: healthProbe.message,
        checkedAt,
        latencyMs: healthProbe.latencyMs,
        configSource: runtime.configSource,
        checkedAgainst,
        requestId: context?.requestId,
        traceId: context?.traceId ?? context?.requestId,
        config: await this.resolveEffectiveConfig(taskType),
        details: healthProbe.details
      };

      if (taskType === "rerank") {
        const rerankProbe = healthProbe as Awaited<
          ReturnType<RagTaskHealthProbeService["probeRerank"]>
        >;
        response.challenge = rerankProbe.challenge;
        if (rerankProbe.reranked && rerankProbe.reranked.length > 0) {
          response.sample = {
            reranked: rerankProbe.reranked
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
        error instanceof DomainError
          ? error.code === "RAG_TASK_CONFIG_SCHEMA_INVALID"
            ? "failed"
            : "degraded"
          : "failed";
      if (persisted && checkedAgainst === "persisted") {
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
        reasonCode: this.mapHealthReasonCode(error, status),
        message,
        checkedAt,
        latencyMs,
        configSource: this.resolveHealthConfigSource(error, checkedAgainst),
        checkedAgainst,
        requestId: context?.requestId,
        traceId: context?.traceId ?? context?.requestId,
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

  private async resolveRuntimeFromDraft(
    taskType: RagTaskType,
    draft: RagTaskConfigDraftInput,
    persisted?: RagTaskConfig | null
  ): Promise<RagTaskRuntimeConfig> {
    const provider = draft.provider?.trim() ?? "";
    const model = draft.model?.trim() ?? "";
    const baseUrl = draft.baseUrl?.trim() ?? "";
    const apiKey = draft.apiKey?.trim() ?? "";

    if (!provider || !model || !baseUrl || !apiKey || draft.enabled === false) {
      throw new DomainError(
        "RAG_TASK_CONFIG_SCHEMA_INVALID",
        "草稿配置不完整，至少需要 provider/model/baseUrl/apiKey 且 enabled=true。",
        400,
        {
          taskType,
          checkedAgainst: "draft",
          missingFields: {
            provider: !provider,
            model: !model,
            baseUrl: !baseUrl,
            apiKey: !apiKey,
            enabled: draft.enabled === false
          }
        }
      );
    }

    return {
      taskType,
      provider,
      model,
      baseUrl,
      apiKey,
      dimensions:
        taskType === "embedding"
          ? (draft.dimensions ?? persisted?.dimensions ?? this.appConfig.embeddingDimensions)
          : undefined,
      vectorVersion:
        taskType === "embedding"
          ? (draft.vectorVersion?.trim() ||
            persisted?.vectorVersion ||
            this.appConfig.embeddingVectorVersion)
          : undefined,
      timeoutMs:
        draft.timeoutMs ??
        persisted?.timeoutMs ??
        (taskType === "embedding"
          ? this.appConfig.embeddingTimeoutMs
          : this.appConfig.rerankTimeoutMs),
      configSource: "settings",
      configId: persisted?.id
    };
  }

  private mapHealthReasonCode(
    error: unknown,
    status: "degraded" | "failed"
  ): string {
    if (error instanceof DomainError) {
      if (error.code === "RAG_TASK_CONFIG_SCHEMA_INVALID") {
        return "schema_invalid";
      }
      if (
        error.code === "EMBEDDING_PROVIDER_UNAVAILABLE" ||
        error.code === "RERANK_PROVIDER_UNAVAILABLE"
      ) {
        return "provider_unavailable";
      }
      if (error.code.includes("REQUEST_TIMEOUT")) {
        return "timeout";
      }
      if (error.code.includes("AUTH")) {
        return "auth_failed";
      }
      if (error.code.includes("INVALID_PAYLOAD")) {
        return "schema_invalid";
      }
      if (error.code.includes("DIMENSION_MISMATCH")) {
        return "dimension_mismatch";
      }
      if (error.code.includes("MODEL_NOT_FOUND")) {
        return "model_not_found";
      }
      if (error.code.includes("RESPONSE_ERROR")) {
        const statusCode = Number(error.details?.statusCode);
        if (Number.isFinite(statusCode) && statusCode >= 500) {
          return "provider_5xx";
        }
        if (statusCode === 401 || statusCode === 403) {
          return "auth_failed";
        }
        if (statusCode === 404) {
          return "model_not_found";
        }
      }
      return status === "degraded" ? "provider_unavailable" : "unexpected_error";
    }

    return status === "degraded" ? "provider_unavailable" : "unexpected_error";
  }

  private resolveHealthConfigSource(
    error: unknown,
    checkedAgainst: RagHealthCheckedAgainst
  ): RagConfigSource {
    if (checkedAgainst === "draft") {
      return "settings";
    }
    if (error instanceof DomainError) {
      const source = error.details?.configSource;
      if (
        source === "settings" ||
        source === "env_fallback" ||
        source === "missing"
      ) {
        return source;
      }
    }
    return "missing";
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

}
