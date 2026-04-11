import { Injectable } from "@nestjs/common";
import { AppConfigService } from "../config/app-config.service";
import { LlmGatewayService } from "./llm-gateway.service";
import type {
  LlmGatewayPrompt,
  LlmGatewayRuntimeConfig,
  LlmGatewayStreamEvent,
  LlmGatewayToolDefinition
} from "./llm-gateway.interface";
import { ProviderCatalogService } from "./provider-catalog.service";

export interface LlmDraft {
  provider: string;
  model: string;
  modelCatalogId?: string;
  rawText: string;
  prompt: LlmGatewayPrompt;
}

@Injectable()
export class ProviderRouterService {
  constructor(
    private readonly config: AppConfigService,
    private readonly providerCatalog: ProviderCatalogService,
    private readonly llmGateway: LlmGatewayService
  ) {}

  async generate(
    prompt: LlmGatewayPrompt,
    selection?: {
      modelCatalogId?: string;
    }
  ): Promise<LlmDraft> {
    const resolved = await this.resolveRuntime(selection?.modelCatalogId);
    const completion = await this.llmGateway.generate(prompt, resolved.runtime);
    return {
      provider: completion.provider,
      model: completion.model,
      modelCatalogId: resolved.modelCatalogId,
      rawText: completion.rawText,
      prompt
    };
  }

  async stream(
    prompt: LlmGatewayPrompt,
    selection?: {
      modelCatalogId?: string;
    },
    options?: {
      tools?: Record<string, LlmGatewayToolDefinition>;
      onEvent?: (event: LlmGatewayStreamEvent) => Promise<void> | void;
    }
  ): Promise<LlmDraft> {
    const resolved = await this.resolveRuntime(selection?.modelCatalogId);
    const completion = await this.llmGateway.stream(prompt, resolved.runtime, options);
    return {
      provider: completion.provider,
      model: completion.model,
      modelCatalogId: resolved.modelCatalogId,
      rawText: completion.rawText,
      prompt
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
}
