import { Injectable } from "@nestjs/common";
import { generateText, streamText, tool } from "ai";
import {
  composeAbortSignals,
  createUserCancelledError,
  isUserCancelledError,
  throwIfAborted
} from "../../common/abort-utils";
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

const isUserAbortError = (error: unknown): boolean => {
  if (isUserCancelledError(error)) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  const normalized = `${error.name} ${error.message}`.toLowerCase();
  return normalized.includes("abort") && !normalized.includes("timeout");
};

const isInvalidJsonResponseError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  return `${error.name} ${error.message}`.toLowerCase().includes("invalid json response");
};

const isRetriableGenerateError = (error: unknown): boolean =>
  isTimeoutAbortError(error) || isInvalidJsonResponseError(error);

const isRecoverableStreamTransportError = (error: unknown): boolean =>
  isTimeoutAbortError(error) || isInvalidJsonResponseError(error);

const MAX_GENERATE_RETRY = 1;

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
      const isMetadataIntent =
        /(有哪些表|哪些表|表结构|schema|字段|列名|describe|show\s+tables|sqlite_master|sqlite_schema|information_schema|pg_catalog|pragma|元数据|数据库结构)/i.test(
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
          : isMetadataIntent
            ? [
                "下面是元数据查询结果。",
                "```sql",
                "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
                "```",
                "该查询用于枚举当前数据源中的表。"
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
      const content = await this.generateWithRetry(prompt, runtime);

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

  private async generateWithRetry(
    prompt: LlmGatewayPrompt,
    runtime: LlmGatewayRuntimeConfig
  ): Promise<string> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_GENERATE_RETRY; attempt += 1) {
      try {
        return await this.executeGenerate(prompt, runtime, attempt);
      } catch (error) {
        lastError = error;
        if (error instanceof DomainError) {
          throw error;
        }
        if (!isRetriableGenerateError(error) || attempt >= MAX_GENERATE_RETRY) {
          throw error;
        }
      }
    }

    throw lastError;
  }

  private async executeGenerate(
    prompt: LlmGatewayPrompt,
    runtime: LlmGatewayRuntimeConfig,
    attempt: number
  ): Promise<string> {
    const model = this.modelFactory.createChatModel(runtime) as never;
    const timeoutMs =
      attempt === 0
        ? runtime.timeoutMs
        : Math.min(
            Math.max(runtime.timeoutMs * 2, runtime.timeoutMs + 15000),
            120000
          );
    const result = await generateText({
      model,
      system: prompt.systemPrompt,
      prompt: prompt.userPrompt,
      abortSignal: AbortSignal.timeout(timeoutMs),
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

    return content;
  }

  async stream(
    prompt: LlmGatewayPrompt,
    runtime: LlmGatewayRuntimeConfig,
    options?: {
      abortSignal?: AbortSignal;
      tools?: Record<string, LlmGatewayToolDefinition>;
      onEvent?: (event: LlmGatewayStreamEvent) => Promise<void> | void;
    }
  ): Promise<LlmGatewayGenerateOutput> {
    if (this.config.llmMockMode) {
      throwIfAborted(options?.abortSignal, {
        phase: "llm_mock_stream_start"
      });
      const simulated = (
        await this.generate(prompt, runtime)
      ).rawText;
      for (const line of simulated.split("\n")) {
        throwIfAborted(options?.abortSignal, {
          phase: "llm_mock_stream_chunk"
        });
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
    let successfulToolCallSql: string | undefined;
    const toolCallSqlById = new Map<string, string>();
    try {
      const model = this.modelFactory.createChatModel(runtime) as never;
      const normalizedTools = this.normalizeTools(options?.tools);
      const streamTimeoutMs = runtime.streamTimeoutMs ?? runtime.timeoutMs;
      const streamAbortSignal = composeAbortSignals([
        AbortSignal.timeout(streamTimeoutMs),
        options?.abortSignal
      ]);
      throwIfAborted(options?.abortSignal, {
        phase: "llm_stream_start"
      });
      const result = streamText({
        model,
        system: prompt.systemPrompt,
        prompt: prompt.userPrompt,
        temperature: 0.2,
        abortSignal: streamAbortSignal,
        tools: normalizedTools
      });

      for await (const chunk of result.fullStream) {
        throwIfAborted(options?.abortSignal, {
          phase: "llm_stream_chunk"
        });
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
            toolCallSqlById.set(chunk.toolCallId, parsedSql);
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
          successfulToolCallSql = toolCallSqlById.get(chunk.toolCallId) ?? toolCallSql;
          await options?.onEvent?.({
            type: "tool-result",
            toolName: chunk.toolName,
            toolCallId: chunk.toolCallId,
            output: chunk.output
          });
          continue;
        }
        if (chunk.type === "tool-error") {
          const toolMessage = toErrorMessage(chunk.error);
          await options?.onEvent?.({
            type: "tool-error",
            toolName: chunk.toolName,
            toolCallId: chunk.toolCallId,
            message: toolMessage
          });
          throw new DomainError(
            "LLM_TOOL_CALL_EXECUTION_FAILED",
            `LLM 工具调用失败: ${toolMessage}`,
            502,
            {
              provider: runtime.provider,
              toolName: chunk.toolName,
              toolCallId: chunk.toolCallId,
              toolSql: toolCallSql?.slice(0, 500)
            }
          );
        }
      }

      throwIfAborted(options?.abortSignal, {
        phase: "llm_stream_finish"
      });
      const fullText = (await result.text).trim() || streamedText.trim();
      if (!fullText) {
        if (toolCallSql) {
          throw new DomainError(
            "LLM_TOOL_CALL_ONLY_RESPONSE",
            "LLM 仅返回工具调用中间结果，未生成最终 SQL。",
            502,
            {
              provider: runtime.provider,
              toolSql: toolCallSql.slice(0, 500)
            }
          );
        }
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
      if (isUserAbortError(error) || options?.abortSignal?.aborted) {
        throw createUserCancelledError({
          provider: runtime.provider
        });
      }
      if (error instanceof DomainError) {
        throw error;
      }

      if (successfulToolCallSql) {
        const recoveredText = this.formatToolSqlFallback(successfulToolCallSql);
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

      if (isRecoverableStreamTransportError(error)) {
        const recoveredText = await this.tryRecoverFromStreamTransportError(
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

  private async tryRecoverFromStreamTransportError(
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

  private formatToolSqlFallback(sql: string): string {
    return [
      "上游模型在工具执行后返回了无法解析的流式响应，已使用成功执行的只读 SQL 继续完成分析。",
      "```sql",
      sql.trim().replace(/;+\s*$/, ""),
      "```"
    ].join("\n");
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
