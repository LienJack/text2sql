import { Injectable } from "@nestjs/common";
import { generateText, streamText, tool } from "ai";
import { DomainError } from "../../common/domain-error";
import { AppConfigService } from "../config/app-config.service";
import { LlmModelFactory } from "./llm-model-factory";
import type {
  LlmGateway,
  LlmGatewayGenerateOutput,
  LlmGatewayPrompt,
  LlmGatewayRuntimeConfig,
  LlmGatewayStreamEvent,
  LlmGatewayToolDefinition
} from "./llm-gateway.interface";

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const isTimeoutAbortError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  const normalized = `${error.name} ${error.message}`.toLowerCase();
  return (
    normalized.includes("aborted due to timeout") ||
    normalized.includes("aborterror") ||
    normalized.includes("timeouterror")
  );
};

@Injectable()
export class LlmGatewayService implements LlmGateway {
  constructor(
    private readonly config: AppConfigService,
    private readonly modelFactory: LlmModelFactory
  ) {}

  async generate(
    prompt: LlmGatewayPrompt,
    runtime: LlmGatewayRuntimeConfig
  ): Promise<LlmGatewayGenerateOutput> {
    if (this.config.llmMockMode) {
      const isWriteIntent = /\b(delete|update|insert|drop|alter|truncate)\b/i.test(
        prompt.userPrompt
      );
      return {
        provider: runtime.provider,
        model: runtime.model,
        prompt,
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

    try {
      const model = this.modelFactory.createChatModel(runtime) as never;
      const result = await generateText({
        model,
        system: prompt.systemPrompt,
        prompt: prompt.userPrompt,
        abortSignal: AbortSignal.timeout(runtime.timeoutMs),
        temperature: 0.2
      });

      const content = result.text?.trim();
      if (!content) {
        throw new DomainError(
          "LLM_EMPTY_RESPONSE",
          "LLM 返回为空，无法生成 SQL。",
          502,
          {
            provider: runtime.provider
          }
        );
      }

      return {
        provider: runtime.provider,
        model: runtime.model,
        prompt,
        rawText: content
      };
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }
      const message = toErrorMessage(error);
      throw new DomainError(
        "LLM_REQUEST_FAILED",
        `LLM 请求失败: ${message}`,
        502,
        {
          provider: runtime.provider
        }
      );
    }
  }

  async stream(
    prompt: LlmGatewayPrompt,
    runtime: LlmGatewayRuntimeConfig,
    options?: {
      tools?: Record<string, LlmGatewayToolDefinition>;
      onEvent?: (event: LlmGatewayStreamEvent) => Promise<void> | void;
    }
  ): Promise<LlmGatewayGenerateOutput> {
    if (this.config.llmMockMode) {
      const simulated = (
        await this.generate(prompt, runtime)
      ).rawText;
      for (const line of simulated.split("\n")) {
        await options?.onEvent?.({
          type: "text-delta",
          text: `${line}\n`
        });
      }
      return {
        provider: runtime.provider,
        model: runtime.model,
        prompt,
        rawText: simulated
      };
    }

    let streamedText = "";
    let toolCallSql: string | undefined;
    try {
      const model = this.modelFactory.createChatModel(runtime) as never;
      const normalizedTools = this.normalizeTools(options?.tools);
      const result = streamText({
        model,
        system: prompt.systemPrompt,
        prompt: prompt.userPrompt,
        temperature: 0.2,
        abortSignal: AbortSignal.timeout(runtime.timeoutMs),
        tools: normalizedTools
      });

      for await (const chunk of result.fullStream) {
        if (chunk.type === "text-delta") {
          streamedText += chunk.text;
          await options?.onEvent?.({
            type: "text-delta",
            text: chunk.text
          });
          continue;
        }
        if (chunk.type === "tool-call") {
          const parsedSql = this.extractToolSql(chunk.input);
          if (parsedSql) {
            toolCallSql = parsedSql;
          }
          await options?.onEvent?.({
            type: "tool-call",
            toolName: chunk.toolName,
            toolCallId: chunk.toolCallId,
            input: chunk.input
          });
          continue;
        }
        if (chunk.type === "tool-result") {
          await options?.onEvent?.({
            type: "tool-result",
            toolName: chunk.toolName,
            toolCallId: chunk.toolCallId,
            output: chunk.output
          });
          continue;
        }
        if (chunk.type === "tool-error") {
          await options?.onEvent?.({
            type: "tool-error",
            toolName: chunk.toolName,
            toolCallId: chunk.toolCallId,
            message: toErrorMessage(chunk.error)
          });
        }
      }

      const fullText =
        (await result.text).trim() ||
        streamedText.trim() ||
        this.buildToolFallbackText(toolCallSql);
      if (!fullText) {
        throw new DomainError(
          "LLM_EMPTY_RESPONSE",
          "LLM 返回为空，无法生成 SQL。",
          502,
          {
            provider: runtime.provider
          }
        );
      }

      return {
        provider: runtime.provider,
        model: runtime.model,
        prompt,
        rawText: fullText
      };
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }

      const toolFallbackText = this.buildToolFallbackText(toolCallSql);
      if (toolFallbackText) {
        const delta = this.resolveFallbackDelta(streamedText, toolFallbackText);
        if (delta) {
          await options?.onEvent?.({
            type: "text-delta",
            text: delta
          });
        }
        return {
          provider: runtime.provider,
          model: runtime.model,
          prompt,
          rawText: toolFallbackText
        };
      }

      if (isTimeoutAbortError(error)) {
        const recoveredText = await this.tryRecoverFromStreamTimeout(
          prompt,
          runtime,
          streamedText
        );
        if (recoveredText) {
          const delta = this.resolveFallbackDelta(streamedText, recoveredText);
          if (delta) {
            await options?.onEvent?.({
              type: "text-delta",
              text: delta
            });
          }
          return {
            provider: runtime.provider,
            model: runtime.model,
            prompt,
            rawText: recoveredText
          };
        }
      }

      throw new DomainError(
        "LLM_REQUEST_FAILED",
        `LLM 流式请求失败: ${toErrorMessage(error)}`,
        502,
        {
          provider: runtime.provider
        }
      );
    }
  }

  private async tryRecoverFromStreamTimeout(
    prompt: LlmGatewayPrompt,
    runtime: LlmGatewayRuntimeConfig,
    streamedText: string
  ): Promise<string | undefined> {
    const timeoutMs = Math.min(
      Math.max(runtime.timeoutMs * 2, runtime.timeoutMs + 15000),
      120000
    );

    try {
      const model = this.modelFactory.createChatModel(runtime) as never;
      const result = await generateText({
        model,
        system: prompt.systemPrompt,
        prompt: prompt.userPrompt,
        temperature: 0.2,
        abortSignal: AbortSignal.timeout(timeoutMs)
      });
      const fallbackText = result.text?.trim();
      if (!fallbackText) {
        return undefined;
      }
      if (streamedText.trim().length > 0 && fallbackText.trim() === streamedText.trim()) {
        return streamedText;
      }
      return fallbackText;
    } catch {
      return undefined;
    }
  }

  private normalizeTools(tools?: Record<string, LlmGatewayToolDefinition>) {
    if (!tools) {
      return undefined;
    }
    return Object.fromEntries(
      Object.entries(tools).map(([name, definition]) => [
        name,
        tool({
          description: definition.description,
          inputSchema: definition.inputSchema as never,
          execute: async (input) => definition.execute(input)
        })
      ])
    );
  }

  private extractToolSql(input: unknown): string | undefined {
    if (typeof input === "object" && input !== null) {
      const sql = (input as { sql?: unknown }).sql;
      if (typeof sql === "string" && sql.trim()) {
        return sql.trim();
      }
    }
    return undefined;
  }

  private buildToolFallbackText(sql?: string): string {
    if (!sql) {
      return "";
    }
    return ["下面是工具调用生成的 SQL。", "```sql", sql, "```"].join("\n");
  }

  private resolveFallbackDelta(existingText: string, fallbackText: string): string {
    if (!existingText) {
      return fallbackText;
    }
    if (fallbackText.startsWith(existingText)) {
      return fallbackText.slice(existingText.length);
    }
    return "";
  }
}
