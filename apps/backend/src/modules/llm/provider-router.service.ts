import { Injectable } from "@nestjs/common";
import { AppConfigService } from "../config/app-config.service";
import { FreeTextSqlExtractor } from "./free-text-sql-extractor";
import { OpenAiCompatibleClient } from "./openai-compatible.client";

export interface SqlDraft {
  provider: string;
  model: string;
  sql: string;
  explanation: string;
  rawText: string;
  prompt: {
    systemPrompt: string;
    userPrompt: string;
  };
}

@Injectable()
export class ProviderRouterService {
  constructor(
    private readonly config: AppConfigService,
    private readonly openAiClient: OpenAiCompatibleClient,
    private readonly extractor: FreeTextSqlExtractor
  ) {}

  async generateSql(question: string): Promise<SqlDraft> {
    const systemPrompt = [
      "You are a senior SQL analyst for a SQLite ecommerce database.",
      "Only produce read-only SQL queries.",
      "Prefer SELECT or WITH ... SELECT statements.",
      "Never generate INSERT/UPDATE/DELETE/DDL.",
      "Respond in free text with explanation plus SQL in a markdown code block."
    ].join(" ");
    const userPrompt = [
      `Question: ${question}`,
      "Return one best SQL query and a short explanation."
    ].join("\n");
    const completion = await this.openAiClient.complete({
      systemPrompt,
      userPrompt
    });

    const extracted = this.extractor.extract(completion.rawText);
    return {
      provider: this.config.llmProvider,
      model: this.config.llmModel,
      sql: extracted.sql,
      explanation: extracted.explanation || completion.rawText,
      rawText: completion.rawText,
      prompt: {
        systemPrompt,
        userPrompt
      }
    };
  }
}
