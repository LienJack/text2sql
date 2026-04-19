import { Injectable } from "@nestjs/common";
import type { DatasourceType, PromptTemplateTraceEvidence } from "@text2sql/shared-types";
import type {
  LlmGatewayStreamEvent,
  LlmGatewayToolDefinition
} from "../../../llm/llm-gateway.interface";
import { SqlGenerationService } from "../sql/sql-generation.service";
import type { RagRetrievalChunkPayload } from "../../../knowledge/rag/retrieval/rag-retrieval.types";

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
      datasourceId?: string;
      workspaceId?: string;
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
  }> {
    if (options?.stream) {
      return this.sqlGeneration.stream(
        question,
        {
          datasourceId: options.datasourceId,
          workspaceId: options.workspaceId,
          datasourceType,
          modelCatalogId,
          selectedContext: options.selectedContext
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
      selectedContext: options?.selectedContext
    });
  }
}
