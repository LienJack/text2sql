import { Injectable } from "@nestjs/common";
import type { DatasourceType, PromptTemplateTraceEvidence } from "@text2sql/shared-types";
import type {
  LlmGatewayStreamEvent,
  LlmGatewayToolDefinition
} from "../../../llm/llm-gateway.interface";
import { SqlGenerationService } from "../sql/sql-generation.service";
import type { SqlSemanticIntent } from "../sql/sql-prompt.builder";
import type {
  RagContextPack,
  RagRetrievalChunkPayload
} from "../../../knowledge/rag/retrieval/rag-retrieval.types";

@Injectable()
export class GenerateSqlNode {
  constructor(private readonly sqlGeneration: SqlGenerationService) {}

  async run(
    question: string,
    datasourceType?: DatasourceType,
    modelCatalogId?: string,
    options?: {
      stream?: boolean;
      tools?: Record<string, LlmGatewayToolDefinition>;
      onEvent?: (event: LlmGatewayStreamEvent) => Promise<void> | void;
      selectedContext?: RagRetrievalChunkPayload[];
      semanticContextPack?: RagContextPack;
      datasourceId?: string;
      workspaceId?: string;
      semanticIntent?: SqlSemanticIntent;
    }
  ): Promise<{
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
    promptTemplate?: PromptTemplateTraceEvidence;
    retryCount?: number;
    semanticIntent?: SqlSemanticIntent;
  }> {
    if (options?.stream) {
      return this.sqlGeneration.stream(
        question,
        {
          datasourceId: options.datasourceId,
          workspaceId: options.workspaceId,
          datasourceType,
          modelCatalogId,
          selectedContext: options.selectedContext,
          semanticContextPack: options.semanticContextPack,
          semanticIntent: options.semanticIntent
        },
        {
          tools: options.tools,
          onEvent: options.onEvent
        }
      );
    }
    return this.sqlGeneration.generate(question, {
      datasourceId: options?.datasourceId,
      workspaceId: options?.workspaceId,
      datasourceType,
      modelCatalogId,
      selectedContext: options?.selectedContext,
      semanticContextPack: options?.semanticContextPack,
      semanticIntent: options?.semanticIntent
    });
  }
}
