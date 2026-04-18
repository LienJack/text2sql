import { Injectable } from "@nestjs/common";
import type { DatasourceType, PromptTemplateTraceEvidence } from "@text2sql/shared-types";
import type {
  LlmGatewayPrompt,
  LlmGatewayStreamEvent,
  LlmGatewayToolDefinition
} from "../../llm/llm-gateway.interface";
import { ProviderRouterService } from "../../llm/provider-router.service";
import { SqlOutputExtractor } from "./sql-output-extractor";
import { SqlPromptBuilder } from "./sql-prompt.builder";
import type { RagRetrievalChunkPayload } from "../../rag/retrieval/rag-retrieval.types";
import { PromptTemplateService } from "../../settings/prompt-template.service";

export interface SqlDraft {
  provider: string;
  model: string;
  modelCatalogId?: string;
  sql: string;
  explanation: string;
  rawText: string;
  prompt: LlmGatewayPrompt;
  promptTemplate?: PromptTemplateTraceEvidence;
}

@Injectable()
export class SqlGenerationService {
  constructor(
    private readonly promptBuilder: SqlPromptBuilder,
    private readonly extractor: SqlOutputExtractor,
    private readonly providerRouter: ProviderRouterService,
    private readonly promptTemplateService: PromptTemplateService
  ) {}

  async generate(
    question: string,
    selection?: {
      datasourceId?: string;
      workspaceId?: string;
      datasourceType?: DatasourceType;
      modelCatalogId?: string;
      selectedContext?: RagRetrievalChunkPayload[];
    }
  ): Promise<SqlDraft> {
    const templateResolution = await this.resolvePromptTemplate(selection);
    const prompt = this.promptBuilder.build(
      question,
      selection?.datasourceType,
      selection?.selectedContext,
      {
        templateOverlay: templateResolution.templateOverlay
      }
    );
    const completion = await this.providerRouter.generate(prompt, selection);
    const extracted = this.extractor.extract(completion.rawText);
    return {
      provider: completion.provider,
      model: completion.model,
      modelCatalogId: completion.modelCatalogId,
      sql: extracted.sql,
      explanation: extracted.explanation || completion.rawText,
      rawText: completion.rawText,
      prompt,
      promptTemplate: templateResolution.evidence
    };
  }

  async stream(
    question: string,
    selection?: {
      datasourceId?: string;
      workspaceId?: string;
      datasourceType?: DatasourceType;
      modelCatalogId?: string;
      selectedContext?: RagRetrievalChunkPayload[];
    },
    options?: {
      tools?: Record<string, LlmGatewayToolDefinition>;
      onEvent?: (event: LlmGatewayStreamEvent) => Promise<void> | void;
    }
  ): Promise<SqlDraft> {
    const templateResolution = await this.resolvePromptTemplate(selection);
    const prompt = this.promptBuilder.build(
      question,
      selection?.datasourceType,
      selection?.selectedContext,
      {
        templateOverlay: templateResolution.templateOverlay
      }
    );
    const completion = await this.providerRouter.stream(prompt, selection, options);
    const extracted = this.extractor.extract(completion.rawText);
    return {
      provider: completion.provider,
      model: completion.model,
      modelCatalogId: completion.modelCatalogId,
      sql: extracted.sql,
      explanation: extracted.explanation || completion.rawText,
      rawText: completion.rawText,
      prompt,
      promptTemplate: templateResolution.evidence
    };
  }

  private async resolvePromptTemplate(selection?: {
    datasourceId?: string;
    workspaceId?: string;
  }): Promise<{
    templateOverlay?: string;
    evidence: PromptTemplateTraceEvidence;
  }> {
    try {
      const resolved = await this.promptTemplateService.resolveSqlTemplateRuntime({
        datasourceId: selection?.datasourceId,
        workspaceId: selection?.workspaceId
      });
      return {
        templateOverlay: resolved.template?.content,
        evidence: resolved.evidence
      };
    } catch {
      return {
        evidence: {
          scene: "sql",
          fallbackReason: "template_service_error"
        }
      };
    }
  }
}
