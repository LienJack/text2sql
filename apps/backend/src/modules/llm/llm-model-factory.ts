import { Injectable } from "@nestjs/common";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { DomainError } from "../../common/domain-error";
import type { LlmGatewayRuntimeConfig } from "./llm-gateway.interface";

export const resolveProviderBaseUrl = (baseUrl: string): string => {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (!normalized) {
    return "";
  }
  return normalized.replace(/\/chat\/completions$/i, "");
};

@Injectable()
export class LlmModelFactory {
  createChatModel(runtime: LlmGatewayRuntimeConfig): unknown {
    const baseUrl = resolveProviderBaseUrl(runtime.baseUrl);
    if (!baseUrl || !runtime.apiKey || !runtime.model) {
      throw new DomainError(
        "LLM_CONFIG_MISSING",
        "LLM 配置不完整，请检查厂商 Base URL、API Key 与模型配置。",
        500,
        {
          provider: runtime.provider
        }
      );
    }

    const provider = createOpenAICompatible({
      name: runtime.provider,
      baseURL: baseUrl,
      apiKey: runtime.apiKey
    });
    return provider.chatModel(runtime.model);
  }
}
