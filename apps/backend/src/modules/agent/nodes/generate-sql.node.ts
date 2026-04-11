import { Injectable } from "@nestjs/common";
import type {
  LlmGatewayStreamEvent,
  LlmGatewayToolDefinition
} from "../../llm/llm-gateway.interface";
import { SqlGenerationService } from "../sql/sql-generation.service";

@Injectable()
export class GenerateSqlNode {
  constructor(private readonly sqlGeneration: SqlGenerationService) {}

  async run(
    question: string,
    modelCatalogId?: string,
    options?: {
      stream?: boolean;
      tools?: Record<string, LlmGatewayToolDefinition>;
      onEvent?: (event: LlmGatewayStreamEvent) => Promise<void> | void;
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
  }> {
    if (options?.stream) {
      return this.sqlGeneration.stream(
        question,
        {
          modelCatalogId
        },
        {
          tools: options.tools,
          onEvent: options.onEvent
        }
      );
    }
    return this.sqlGeneration.generate(question, {
      modelCatalogId
    });
  }
}
