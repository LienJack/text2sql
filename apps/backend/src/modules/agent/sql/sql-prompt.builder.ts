import { Injectable } from "@nestjs/common";
import type { LlmGatewayPrompt } from "../../llm/llm-gateway.interface";

@Injectable()
export class SqlPromptBuilder {
  build(question: string): LlmGatewayPrompt {
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
}
