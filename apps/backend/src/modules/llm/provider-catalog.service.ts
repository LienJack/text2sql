import { Injectable } from "@nestjs/common";
import type {
  LlmProviderCode,
  LlmSettingsView,
  ModelCatalogItem,
  ProviderConfig,
  ProviderSyncStatus,
  SettingsActor
} from "@text2sql/shared-types";
import { DomainError } from "../../common/domain-error";
import { AppConfigService } from "../config/app-config.service";
import { LlmConfigRepository } from "../data/persistence/llm-config.repository";
import { DeepSeekAdapter } from "./provider-adapters/deepseek.adapter";
import { GeminiAdapter } from "./provider-adapters/gemini.adapter";
import { KimiAdapter } from "./provider-adapters/kimi.adapter";
import { MinimaxAdapter } from "./provider-adapters/minimax.adapter";
import { OpenAiAdapter } from "./provider-adapters/openai.adapter";
import { OpenRouterAdapter } from "./provider-adapters/openrouter.adapter";
import { ProviderRuntimeConfig, type ProviderAdapter } from "./provider-adapters/provider-adapter.interface";
import { PROVIDER_CAPABILITIES, SUPPORTED_PROVIDER_CODES } from "./provider-adapters/provider-capabilities";
import { SiliconflowAdapter } from "./provider-adapters/siliconflow.adapter";
import { TencentHunyuanAdapter } from "./provider-adapters/tencent-hunyuan.adapter";
import { TongyiAdapter } from "./provider-adapters/tongyi.adapter";
import { VolcengineAdapter } from "./provider-adapters/volcengine.adapter";

type ProviderPayload = {
  id?: string;
  provider: LlmProviderCode;
  displayName?: string;
  baseUrl?: string | null;
  apiKey?: string;
  enabled?: boolean;
  actor: SettingsActor;
};

@Injectable()
export class ProviderCatalogService {
  private readonly adapters: Map<LlmProviderCode, ProviderAdapter>;

  constructor(
    private readonly config: AppConfigService,
    private readonly repository: LlmConfigRepository
  ) {
    const adapterList: ProviderAdapter[] = [
      new OpenAiAdapter(),
      new GeminiAdapter(),
      new DeepSeekAdapter(),
      new KimiAdapter(),
      new VolcengineAdapter(),
      new SiliconflowAdapter(),
      new OpenRouterAdapter(),
      new MinimaxAdapter(),
      new TencentHunyuanAdapter(),
      new TongyiAdapter()
    ];
    this.adapters = new Map(adapterList.map((adapter) => [adapter.provider, adapter]));
  }

  listSupportedProviders(): Array<{
    provider: LlmProviderCode;
    displayName: string;
    defaultBaseUrl: string;
    supportsModelListing: boolean;
  }> {
    return SUPPORTED_PROVIDER_CODES.map((provider) => ({
      provider,
      displayName: PROVIDER_CAPABILITIES[provider].displayName,
      defaultBaseUrl: PROVIDER_CAPABILITIES[provider].defaultBaseUrl,
      supportsModelListing: PROVIDER_CAPABILITIES[provider].supportsModelListing
    }));
  }

  async listSettingsView(actor: SettingsActor): Promise<LlmSettingsView> {
    const providers = await this.repository.listProviders();
    const models = await this.repository.listModels({
      includeDisabled: actor.role === "admin"
    });
    const defaultModel = await this.repository.resolveDefaultModel();
    return {
      actor,
      providers,
      models: actor.role === "admin" ? models : models.filter((item) => item.enabled),
      defaultModelId: defaultModel?.id ?? null
    };
  }

  async createOrUpdateProvider(payload: ProviderPayload): Promise<ProviderConfig> {
    const capability = PROVIDER_CAPABILITIES[payload.provider];
    const displayName = payload.displayName?.trim() || capability.displayName;
    const next = await this.repository.upsertProvider({
      id: payload.id,
      provider: payload.provider,
      displayName,
      baseUrl: payload.baseUrl ?? capability.defaultBaseUrl,
      apiKeyCiphertext: payload.apiKey,
      apiKeyMasked: payload.apiKey ? this.maskApiKey(payload.apiKey) : undefined,
      enabled: payload.enabled,
      actorId: payload.actor.id
    });
    return next;
  }

  async deleteProvider(providerConfigId: string): Promise<void> {
    const deleted = await this.repository.softDeleteProvider(providerConfigId);
    if (!deleted) {
      throw new DomainError("PROVIDER_NOT_FOUND", "厂商配置不存在。", 404, {
        providerConfigId
      });
    }
  }

  async syncProviderModels(providerConfigId: string): Promise<{
    provider: ProviderConfig;
    syncedModels: ModelCatalogItem[];
  }> {
    const provider = await this.repository.getProviderById(providerConfigId);
    if (!provider) {
      throw new DomainError("PROVIDER_NOT_FOUND", "厂商配置不存在。", 404, {
        providerConfigId
      });
    }
    const adapter = this.getAdapter(provider.provider);
    await this.repository.updateProviderSync(providerConfigId, {
      status: "syncing",
      error: null
    });

    const runtime = await this.resolveRuntimeConfig(providerConfigId);
    try {
      const remoteModels = await adapter.listModels(runtime);
      const synced = await this.repository.upsertModels(
        providerConfigId,
        remoteModels.map((item) => ({
          provider: provider.provider,
          model: item.model,
          displayName: item.displayName,
          capabilities: item.capabilities,
          contextWindow: item.contextWindow ?? null,
          metadata: item.metadata
        }))
      );
      await this.repository.updateProviderSync(providerConfigId, {
        status: "healthy",
        error: null,
        syncedAt: new Date().toISOString()
      });
      const latestProvider = await this.repository.getProviderById(providerConfigId);
      return {
        provider: latestProvider ?? provider,
        syncedModels: synced
      };
    } catch (error) {
      await this.repository.updateProviderSync(providerConfigId, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async checkProviderHealth(providerConfigId: string): Promise<{
    provider: ProviderConfig;
    status: ProviderSyncStatus;
    message: string;
    checkedAt: string;
    latencyMs: number;
  }> {
    const provider = await this.repository.getProviderById(providerConfigId);
    if (!provider) {
      throw new DomainError("PROVIDER_NOT_FOUND", "厂商配置不存在。", 404, {
        providerConfigId
      });
    }
    const adapter = this.getAdapter(provider.provider);
    const result = await adapter.checkHealth(
      await this.resolveRuntimeConfig(providerConfigId)
    );
    const status: ProviderSyncStatus = result.healthy ? "healthy" : "degraded";
    await this.repository.updateProviderSync(providerConfigId, {
      status,
      error: result.healthy ? null : result.message,
      syncedAt: result.checkedAt
    });
    const latest = await this.repository.getProviderById(providerConfigId);
    return {
      provider: latest ?? provider,
      status,
      message: result.message,
      checkedAt: result.checkedAt,
      latencyMs: result.latencyMs
    };
  }

  async setModelEnabled(modelId: string, enabled: boolean): Promise<ModelCatalogItem> {
    const updated = await this.repository.setModelEnabled(modelId, enabled);
    if (!updated) {
      throw new DomainError("MODEL_NOT_FOUND", "模型不存在。", 404, {
        modelId
      });
    }
    return updated;
  }

  async listEnabledModels(): Promise<ModelCatalogItem[]> {
    return this.repository.listModels({ enabledOnly: true });
  }

  async resolveDefaultModel(): Promise<ModelCatalogItem> {
    const model = await this.repository.resolveDefaultModel();
    if (!model) {
      throw new DomainError(
        "MODEL_SWITCH_REQUIRED",
        "当前没有可用模型，请联系管理员配置并启用模型。",
        409
      );
    }
    return model;
  }

  async resolveModelById(modelId: string): Promise<ModelCatalogItem> {
    const model = await this.repository.getModelById(modelId);
    if (!model || !model.enabled) {
      throw new DomainError(
        "MODEL_SWITCH_REQUIRED",
        "当前模型不可用，请手动切换到其他可用模型。",
        409,
        {
          modelId
        }
      );
    }
    return model;
  }

  async resolveRuntimeByModelId(modelId: string): Promise<{
    model: ModelCatalogItem;
    runtime: ProviderRuntimeConfig;
  }> {
    const model = await this.resolveModelById(modelId);
    return {
      model,
      runtime: await this.resolveRuntimeConfig(model.providerConfigId)
    };
  }

  async resolveRuntimeConfig(providerConfigId: string): Promise<ProviderRuntimeConfig> {
    const runtime = await this.repository.getProviderRuntimeConfig(providerConfigId);
    if (!runtime) {
      throw new DomainError("PROVIDER_NOT_FOUND", "厂商配置不存在。", 404, {
        providerConfigId
      });
    }
    if (!runtime.enabled) {
      throw new DomainError(
        "MODEL_SWITCH_REQUIRED",
        "当前厂商配置已停用，请手动切换模型。",
        409,
        {
          provider: runtime.provider
        }
      );
    }
    return {
      provider: runtime.provider,
      baseUrl: runtime.baseUrl,
      apiKey: runtime.apiKey || this.resolveFallbackApiKey(runtime.provider),
      timeoutMs: this.config.llmTimeoutMs
    };
  }

  private resolveFallbackApiKey(provider: LlmProviderCode): string | undefined {
    if (provider === this.config.llmProvider) {
      return this.config.llmApiKey || undefined;
    }
    return undefined;
  }

  private getAdapter(provider: LlmProviderCode): ProviderAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new DomainError("PROVIDER_UNSUPPORTED", `不支持的厂商: ${provider}`, 400, {
        provider
      });
    }
    return adapter;
  }

  private maskApiKey(apiKey: string): string {
    const trimmed = apiKey.trim();
    if (trimmed.length <= 8) {
      return `${trimmed.slice(0, 2)}***${trimmed.slice(-1)}`;
    }
    return `${trimmed.slice(0, 4)}***${trimmed.slice(-4)}`;
  }
}
