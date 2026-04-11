import { DomainError } from "../../../common/domain-error";
import type {
  ProviderAdapter,
  ProviderHealthResult,
  ProviderModelDescriptor,
  ProviderRuntimeConfig
} from "./provider-adapter.interface";

type OpenAiModelsResponse = {
  data?: Array<{
    id?: string;
    created?: number;
    object?: string;
    owned_by?: string;
    context_window?: number;
    modalities?: string[];
  }>;
};

const resolveModelsUrl = (baseUrl: string): string => {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (!normalized) {
    return "";
  }
  if (/\/models$/i.test(normalized)) {
    return normalized;
  }
  if (/\/v\d+$/i.test(normalized)) {
    return `${normalized}/models`;
  }
  return `${normalized}/v1/models`;
};

export abstract class OpenAiBaseAdapter implements ProviderAdapter {
  abstract readonly provider: ProviderRuntimeConfig["provider"];
  readonly supportsModelListing = true;
  protected readonly defaultBaseUrl: string;

  constructor(defaultBaseUrl: string) {
    this.defaultBaseUrl = defaultBaseUrl;
  }

  resolveBaseUrl(config: ProviderRuntimeConfig): string {
    const fromConfig = config.baseUrl?.trim();
    if (fromConfig) {
      return fromConfig;
    }
    return this.defaultBaseUrl;
  }

  async listModels(config: ProviderRuntimeConfig): Promise<ProviderModelDescriptor[]> {
    const baseUrl = this.resolveBaseUrl(config);
    if (!baseUrl || !config.apiKey) {
      throw new DomainError(
        "PROVIDER_CONFIG_MISSING",
        `厂商 ${this.provider} 配置不完整，缺少 baseUrl 或 apiKey。`,
        400,
        {
          provider: this.provider
        }
      );
    }

    const started = Date.now();
    const response = await fetch(resolveModelsUrl(baseUrl), {
      method: "GET",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json"
      },
      signal: AbortSignal.timeout(config.timeoutMs)
    });

    if (!response.ok) {
      throw new DomainError(
        "PROVIDER_MODELS_FETCH_FAILED",
        `拉取 ${this.provider} 模型列表失败: HTTP ${response.status}`,
        502,
        {
          provider: this.provider,
          status: response.status,
          elapsedMs: Date.now() - started
        }
      );
    }

    const payload = (await response.json()) as OpenAiModelsResponse;
    const models = payload.data ?? [];
    const normalized: ProviderModelDescriptor[] = [];
    for (const item of models) {
      const model = item.id?.trim();
      if (!model) {
        continue;
      }
      normalized.push({
        model,
        displayName: model,
        capabilities: item.modalities ?? ["chat"],
        contextWindow: item.context_window ?? null,
        metadata: {
          providerOwner: item.owned_by ?? undefined,
          object: item.object ?? undefined,
          created: item.created ?? undefined
        }
      });
    }
    return normalized;
  }

  async checkHealth(config: ProviderRuntimeConfig): Promise<ProviderHealthResult> {
    const startedAt = Date.now();
    try {
      await this.listModels(config);
      const checkedAt = new Date().toISOString();
      return {
        healthy: true,
        message: "模型列表拉取成功。",
        checkedAt,
        latencyMs: Date.now() - startedAt
      };
    } catch (error) {
      const checkedAt = new Date().toISOString();
      return {
        healthy: false,
        message: error instanceof Error ? error.message : String(error),
        checkedAt,
        latencyMs: Date.now() - startedAt
      };
    }
  }
}
