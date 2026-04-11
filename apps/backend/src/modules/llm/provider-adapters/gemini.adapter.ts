import { DomainError } from "../../../common/domain-error";
import type {
  ProviderAdapter,
  ProviderHealthResult,
  ProviderModelDescriptor,
  ProviderRuntimeConfig
} from "./provider-adapter.interface";

type GeminiModelsResponse = {
  models?: Array<{
    name?: string;
    displayName?: string;
    description?: string;
    inputTokenLimit?: number;
    outputTokenLimit?: number;
    supportedGenerationMethods?: string[];
  }>;
};

const resolveGeminiUrl = (baseUrl: string, apiKey: string): string => {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  const root = normalized || "https://generativelanguage.googleapis.com/v1beta";
  const separator = root.includes("?") ? "&" : "?";
  if (/\/models$/i.test(root)) {
    return `${root}${separator}key=${encodeURIComponent(apiKey)}`;
  }
  return `${root}/models?key=${encodeURIComponent(apiKey)}`;
};

export class GeminiAdapter implements ProviderAdapter {
  readonly provider = "gemini" as const;
  readonly supportsModelListing = true;

  resolveBaseUrl(config: ProviderRuntimeConfig): string {
    return config.baseUrl?.trim() || "https://generativelanguage.googleapis.com/v1beta";
  }

  async listModels(config: ProviderRuntimeConfig): Promise<ProviderModelDescriptor[]> {
    if (!config.apiKey) {
      throw new DomainError(
        "PROVIDER_CONFIG_MISSING",
        "Gemini 配置缺少 apiKey。",
        400,
        {
          provider: this.provider
        }
      );
    }

    const requestUrl = resolveGeminiUrl(this.resolveBaseUrl(config), config.apiKey);
    const response = await fetch(requestUrl, {
      method: "GET",
      signal: AbortSignal.timeout(config.timeoutMs)
    });

    if (!response.ok) {
      throw new DomainError(
        "PROVIDER_MODELS_FETCH_FAILED",
        `拉取 ${this.provider} 模型列表失败: HTTP ${response.status}`,
        502,
        {
          provider: this.provider,
          status: response.status
        }
      );
    }

    const payload = (await response.json()) as GeminiModelsResponse;
    const normalized: ProviderModelDescriptor[] = [];
    for (const item of payload.models ?? []) {
      const model = item.name?.replace(/^models\//, "").trim();
      if (!model) {
        continue;
      }
      normalized.push({
        model,
        displayName: item.displayName?.trim() || model,
        capabilities: item.supportedGenerationMethods ?? ["generateContent"],
        contextWindow: item.inputTokenLimit ?? null,
        metadata: {
          description: item.description ?? undefined,
          outputTokenLimit: item.outputTokenLimit ?? undefined
        }
      });
    }
    return normalized;
  }

  async checkHealth(config: ProviderRuntimeConfig): Promise<ProviderHealthResult> {
    const startedAt = Date.now();
    try {
      await this.listModels(config);
      return {
        healthy: true,
        message: "模型列表拉取成功。",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt
      };
    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : String(error),
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt
      };
    }
  }
}
