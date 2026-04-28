import type { LlmProviderCode } from "@text2sql/shared-types";

export interface ProviderCapability {
  provider: LlmProviderCode;
  displayName: string;
  supportsModelListing: boolean;
  defaultBaseUrl: string;
  ragProfiles?: {
    embedding?: {
      endpoint: string;
      recommendedModel?: string;
      mode?: "compatible" | "native";
    };
    rerank?: {
      endpoint: string;
      recommendedModel?: string;
      mode?: "compatible" | "native";
    };
  };
}

export const PROVIDER_CAPABILITIES: Record<LlmProviderCode, ProviderCapability> = {
  openai: {
    provider: "openai",
    displayName: "OpenAI",
    supportsModelListing: true,
    defaultBaseUrl: "https://api.openai.com/v1",
    ragProfiles: {
      embedding: {
        endpoint: "/embeddings",
        recommendedModel: "text-embedding-3-small",
        mode: "native"
      },
      rerank: {
        endpoint: "/responses",
        recommendedModel: "gpt-4.1-mini",
        mode: "native"
      }
    }
  },
  gemini: {
    provider: "gemini",
    displayName: "Gemini",
    supportsModelListing: true,
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta"
  },
  deepseek: {
    provider: "deepseek",
    displayName: "DeepSeek",
    supportsModelListing: true,
    defaultBaseUrl: "https://api.deepseek.com/v1"
  },
  kimi: {
    provider: "kimi",
    displayName: "Kimi",
    supportsModelListing: true,
    defaultBaseUrl: "https://api.moonshot.cn/v1"
  },
  volcengine: {
    provider: "volcengine",
    displayName: "火山引擎",
    supportsModelListing: true,
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    ragProfiles: {
      embedding: {
        endpoint: "/embeddings",
        recommendedModel: "doubao-embedding-text-240715",
        mode: "compatible"
      },
      rerank: {
        endpoint: "/rerank",
        recommendedModel: "doubao-rerank-v1",
        mode: "compatible"
      }
    }
  },
  siliconflow: {
    provider: "siliconflow",
    displayName: "硅基流动",
    supportsModelListing: true,
    defaultBaseUrl: "https://api.siliconflow.cn/v1",
    ragProfiles: {
      embedding: {
        endpoint: "/embeddings",
        recommendedModel: "BAAI/bge-m3",
        mode: "compatible"
      },
      rerank: {
        endpoint: "/rerank",
        recommendedModel: "BAAI/bge-reranker-v2-m3",
        mode: "compatible"
      }
    }
  },
  openrouter: {
    provider: "openrouter",
    displayName: "OpenRouter",
    supportsModelListing: true,
    defaultBaseUrl: "https://openrouter.ai/api/v1"
  },
  minimax: {
    provider: "minimax",
    displayName: "MiniMax",
    supportsModelListing: true,
    defaultBaseUrl: "https://api.minimax.chat/v1"
  },
  "tencent-hunyuan": {
    provider: "tencent-hunyuan",
    displayName: "腾讯混元",
    supportsModelListing: true,
    defaultBaseUrl: "https://api.hunyuan.cloud.tencent.com/v1"
  },
  tongyi: {
    provider: "tongyi",
    displayName: "通义",
    supportsModelListing: true,
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    ragProfiles: {
      embedding: {
        endpoint: "/embeddings",
        recommendedModel: "text-embedding-v4",
        mode: "compatible"
      },
      rerank: {
        endpoint: "/rerank",
        recommendedModel: "gte-rerank-v2",
        mode: "compatible"
      }
    }
  }
};

export const SUPPORTED_PROVIDER_CODES = Object.keys(
  PROVIDER_CAPABILITIES
) as LlmProviderCode[];
