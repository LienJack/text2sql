import { Injectable } from "@nestjs/common";
import { ProviderRouterService } from "../../llm/provider-router.service";

@Injectable()
export class GenerateSqlNode {
  constructor(private readonly providerRouter: ProviderRouterService) {}

  async run(question: string): Promise<{
    provider: string;
    sql: string;
    explanation: string;
  }> {
    return this.providerRouter.generateSql(question);
  }
}

