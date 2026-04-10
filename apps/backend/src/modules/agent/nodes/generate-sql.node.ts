import { Injectable } from "@nestjs/common";
import { ProviderRouterService } from "../../llm/provider-router.service";

@Injectable()
export class GenerateSqlNode {
  constructor(private readonly providerRouter: ProviderRouterService) {}

  async run(question: string): Promise<{
    provider: string;
    model: string;
    sql: string;
    explanation: string;
    rawText: string;
    prompt: {
      systemPrompt: string;
      userPrompt: string;
    };
  }> {
    return this.providerRouter.generateSql(question);
  }
}
