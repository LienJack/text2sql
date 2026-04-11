import { Injectable } from "@nestjs/common";
import { AppConfigService } from "../config/app-config.service";
import { FreeTextSqlExtractor } from "./free-text-sql-extractor";
import { LlmGatewayService } from "./llm-gateway.service";
import type {
  LlmGatewayRuntimeConfig,
  LlmGatewayStreamEvent,
  LlmGatewayToolDefinition
} from "./llm-gateway.interface";
import { ProviderCatalogService } from "./provider-catalog.service";

export interface SqlDraft {
  provider: string;
  model: string;
  modelCatalogId?: string;
  sql: string;
  explanation: string;
  rawText: string;
  prompt: {
    systemPrompt: string;
    userPrompt: string;
  };
}

export interface SqlStreamEvent {
  type: "text-delta" | "tool-call" | "tool-result" | "tool-error";
  payload: string | Record<string, unknown>;
}

@Injectable()
export class ProviderRouterService {
  constructor(
    private readonly config: AppConfigService,
    private readonly providerCatalog: ProviderCatalogService,
    private readonly llmGateway: LlmGatewayService,
    private readonly extractor: FreeTextSqlExtractor
  ) {}

  async generateSql(
    question: string,
    selection?: {
      modelCatalogId?: string;
    }
  ): Promise<SqlDraft> {
    const prompt = this.buildPrompt(question);
    const resolved = await this.resolveRuntime(selection?.modelCatalogId);

    const completion = await this.llmGateway.generate(
      prompt,
      resolved.runtime
    );

    const extracted = this.extractor.extract(completion.rawText);
    return {
      provider: completion.provider,
      model: completion.model,
      modelCatalogId: resolved.modelCatalogId,
      sql: extracted.sql,
      explanation: extracted.explanation || completion.rawText,
      rawText: completion.rawText,
      prompt
    };
  }

  async streamSql(
    question: string,
    selection?: {
      modelCatalogId?: string;
    },
    options?: {
      tools?: Record<string, LlmGatewayToolDefinition>;
      onEvent?: (event: SqlStreamEvent) => Promise<void> | void;
    }
  ): Promise<SqlDraft> {
    const prompt = this.buildPrompt(question);
    const resolved = await this.resolveRuntime(selection?.modelCatalogId);
    const completion = await this.llmGateway.stream(prompt, resolved.runtime, {
      tools: options?.tools,
      onEvent: async (event) => {
        await options?.onEvent?.(this.toSqlStreamEvent(event));
      }
    });
    const extracted = this.extractor.extract(completion.rawText);
    return {
      provider: completion.provider,
      model: completion.model,
      modelCatalogId: resolved.modelCatalogId,
      sql: extracted.sql,
      explanation: extracted.explanation || completion.rawText,
      rawText: completion.rawText,
      prompt
    };
  }

  private buildPrompt(question: string): {
    systemPrompt: string;
    userPrompt: string;
  } {
    return {
      systemPrompt: [
        "You are a senior SQL analyst for a SQLite ecommerce database.",
        "Only produce read-only SQL queries.",
        "Prefer SELECT or WITH ... SELECT statements.",
        "Never generate INSERT/UPDATE/DELETE/DDL.",
        "Respond in free text with explanation plus SQL in a markdown code block."
      ].join(" "),
      userPrompt: [
        `Question: ${question}`,
        "Return one best SQL query and a short explanation."
      ].join("\n")
    };
  }

  private async resolveRuntime(
    modelCatalogId?: string
  ): Promise<{
    modelCatalogId?: string;
    runtime: LlmGatewayRuntimeConfig;
  }> {
    if (modelCatalogId) {
      const resolved = await this.providerCatalog.resolveRuntimeByModelId(modelCatalogId);
      return {
        modelCatalogId: resolved.model.id,
        runtime: {
          provider: resolved.model.provider,
          model: resolved.model.model,
          baseUrl: resolved.runtime.baseUrl?.trim() || this.config.llmBaseUrl || "",
          apiKey: resolved.runtime.apiKey?.trim() || this.config.llmApiKey || "",
          timeoutMs: this.config.llmTimeoutMs
        }
      };
    }

    try {
      const defaultModel = await this.providerCatalog.resolveDefaultModel();
      const defaultRuntime = await this.providerCatalog.resolveRuntimeConfig(
        defaultModel.providerConfigId
      );
      return {
        modelCatalogId: defaultModel.id,
        runtime: {
          provider: defaultModel.provider,
          model: defaultModel.model,
          baseUrl: defaultRuntime.baseUrl?.trim() || this.config.llmBaseUrl || "",
          apiKey: defaultRuntime.apiKey?.trim() || this.config.llmApiKey || "",
          timeoutMs: this.config.llmTimeoutMs
        }
      };
    } catch {
      return {
        runtime: {
          provider: this.config.llmProvider,
          model: this.config.llmModel,
          baseUrl: this.config.llmBaseUrl,
          apiKey: this.config.llmApiKey,
          timeoutMs: this.config.llmTimeoutMs
        }
      };
    }
  }

  private toSqlStreamEvent(event: LlmGatewayStreamEvent): SqlStreamEvent {
    if (event.type === "text-delta") {
      return {
        type: "text-delta",
        payload: event.text
      };
    }
    if (event.type === "tool-call") {
      return {
        type: "tool-call",
        payload: {
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          input: event.input
        }
      };
    }
    if (event.type === "tool-result") {
      return {
        type: "tool-result",
        payload: {
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          output: event.output
        }
      };
    }
    return {
      type: "tool-error",
      payload: {
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        message: event.message
      }
    };
  }
}
