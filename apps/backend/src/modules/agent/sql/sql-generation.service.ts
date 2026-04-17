import { Injectable } from "@nestjs/common";
import type { DatasourceType } from "@text2sql/shared-types";
import type {
  LlmGatewayPrompt,
  LlmGatewayStreamEvent,
  LlmGatewayToolDefinition
} from "../../llm/llm-gateway.interface";
import { ProviderRouterService } from "../../llm/provider-router.service";
import { SqlOutputExtractor } from "./sql-output-extractor";
import { SqlPromptBuilder } from "./sql-prompt.builder";
import type { RagRetrievalChunkPayload } from "../../rag/retrieval/rag-retrieval.types";

export interface SqlDraft {
  provider: string;
  model: string;
  modelCatalogId?: string;
  sql: string;
  explanation: string;
  rawText: string;
  prompt: LlmGatewayPrompt;
}

@Injectable()
export class SqlGenerationService {
  constructor(
    private readonly promptBuilder: SqlPromptBuilder,
    private readonly extractor: SqlOutputExtractor,
    private readonly providerRouter: ProviderRouterService
  ) {}

  async generate(
    question: string,
    selection?: {
      datasourceType?: DatasourceType;
      modelCatalogId?: string;
      selectedContext?: RagRetrievalChunkPayload[];
    }
  ): Promise<SqlDraft> {
    const prompt = this.promptBuilder.build(
      question,
      selection?.datasourceType,
      selection?.selectedContext
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
      prompt
    };
  }

  async stream(
    question: string,
    selection?: {
      datasourceType?: DatasourceType;
      modelCatalogId?: string;
      selectedContext?: RagRetrievalChunkPayload[];
    },
    options?: {
      tools?: Record<string, LlmGatewayToolDefinition>;
      onEvent?: (event: LlmGatewayStreamEvent) => Promise<void> | void;
    }
  ): Promise<SqlDraft> {
    const prompt = this.promptBuilder.build(
      question,
      selection?.datasourceType,
      selection?.selectedContext
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
      prompt
    };
  }
}
