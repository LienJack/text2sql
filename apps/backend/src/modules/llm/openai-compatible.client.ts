import { Injectable } from "@nestjs/common";
import { DomainError } from "../../common/domain-error";
import { AppConfigService } from "../config/app-config.service";

export interface OpenAiCompletionInput {
  systemPrompt: string;
  userPrompt: string;
}

export interface OpenAiCompletionOutput {
  provider: string;
  rawText: string;
  prompt: OpenAiCompletionInput;
  model: string;
}

export interface OpenAiRuntimeConfig {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
}

export const resolveChatCompletionsUrl = (baseUrl: string): string => {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (!normalized) {
    return "";
  }
  if (/\/chat\/completions$/i.test(normalized)) {
    return normalized;
  }
  if (/\/v\d+$/i.test(normalized)) {
    return `${normalized}/chat/completions`;
  }
  return `${normalized}/v1/chat/completions`;
};

@Injectable()
export class OpenAiCompatibleClient {
  constructor(private readonly config: AppConfigService) {}

  async complete(
    input: OpenAiCompletionInput,
    runtime?: OpenAiRuntimeConfig
  ): Promise<OpenAiCompletionOutput> {
    const provider = runtime?.provider ?? this.config.llmProvider;
    const model = runtime?.model ?? this.config.llmModel;
    const baseUrl = runtime?.baseUrl ?? this.config.llmBaseUrl;
    const apiKey = runtime?.apiKey ?? this.config.llmApiKey;

    if (this.config.llmMockMode) {
      const isWriteIntent = /\b(delete|update|insert|drop|alter|truncate)\b/i.test(
        input.userPrompt
      );
      return {
        provider,
        model,
        prompt: input,
        rawText: isWriteIntent
          ? [
              "下面是查询结果说明。",
              "```sql",
              "DELETE FROM orders WHERE id = 1",
              "```",
              "该语句用于演示写操作意图。"
            ].join("\n")
          : [
              "下面是查询结果说明。",
              "```sql",
              "SELECT status, COUNT(*) AS order_count, ROUND(SUM(total_amount), 2) AS total_amount",
              "FROM orders",
              "GROUP BY status",
              "ORDER BY total_amount DESC",
              "```",
              "该查询按订单状态汇总订单数与总金额。"
            ].join("\n")
      };
    }

    if (!baseUrl || !apiKey || !model) {
      throw new DomainError(
        "LLM_CONFIG_MISSING",
        "LLM 配置不完整，请检查 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL。",
        500
      );
    }

    const completionUrl = resolveChatCompletionsUrl(baseUrl);
    const response = await fetch(completionUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: input.systemPrompt
          },
          {
            role: "user",
            content: input.userPrompt
          }
        ]
      }),
      signal: AbortSignal.timeout(this.config.llmTimeoutMs)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      const isNotFound = response.status === 404;
      throw new DomainError(
        "LLM_REQUEST_FAILED",
        isNotFound
          ? "LLM 请求失败: HTTP 404（请检查 LLM_BASE_URL 路径或 LLM_MODEL 是否正确）"
          : `LLM 请求失败: HTTP ${response.status}`,
        502,
        {
          provider,
          requestUrl: completionUrl,
          body: errorBody.slice(0, 1000)
        }
      );
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new DomainError(
        "LLM_EMPTY_RESPONSE",
        "LLM 返回为空，无法生成 SQL。",
        502,
        {
          provider
        }
      );
    }

    return {
      provider,
      model,
      prompt: input,
      rawText: content
    };
  }
}
