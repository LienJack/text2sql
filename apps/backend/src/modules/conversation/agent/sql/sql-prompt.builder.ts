import { Injectable } from "@nestjs/common";
import type { DatasourceType } from "@text2sql/shared-types";
import type { LlmGatewayPrompt } from "../../../llm/llm-gateway.interface";
import type { RagRetrievalChunkPayload } from "../../../knowledge/rag/retrieval/rag-retrieval.types";

const DIALECT_HINT: Record<DatasourceType, string> = {
  sqlite: "SQLite",
  mysql: "MySQL",
  postgresql: "PostgreSQL",
  excel: "SQLite-compatible",
  csv: "SQLite-compatible"
};

@Injectable()
export class SqlPromptBuilder {
  build(
    question: string,
    datasourceType: DatasourceType = "sqlite",
    selectedContext?: RagRetrievalChunkPayload[],
    options?: {
      templateOverlay?: string;
    }
  ): LlmGatewayPrompt {
    const dialect = DIALECT_HINT[datasourceType] ?? "SQLite";
    const tableHint =
      datasourceType === "csv" || datasourceType === "excel"
        ? "For file datasources, the default imported table name is usually `uploaded_data`."
        : "";
    const contextBlock = this.buildContextBlock(selectedContext);
    const overlayBlock = this.buildTemplateOverlay(options?.templateOverlay);
    return {
      systemPrompt: [
        `You are a senior SQL analyst for a ${dialect} datasource.`,
        "Only produce read-only SQL queries.",
        "Prefer SELECT or WITH ... SELECT statements.",
        "Never generate INSERT/UPDATE/DELETE/DDL.",
        tableHint,
        overlayBlock,
        "Respond in free text with explanation plus SQL in a markdown code block."
      ].join(" "),
      userPrompt: [
        `Question: ${question}`,
        contextBlock,
        "Return one best SQL query and a short explanation."
      ]
        .filter((line) => line.trim().length > 0)
        .join("\n")
    };
  }

  private buildTemplateOverlay(templateOverlay?: string): string {
    const normalized = templateOverlay?.trim();
    if (!normalized) {
      return "";
    }
    return `Runtime template overlay (higher priority guidance): ${normalized}`;
  }

  private buildContextBlock(selectedContext?: RagRetrievalChunkPayload[]): string {
    if (!selectedContext || selectedContext.length === 0) {
      return "";
    }
    const lines = selectedContext.slice(0, 5).map((item, index) => {
      const domain = item.metadata.domain;
      const chunkId = item.chunk_id;
      const compact = item.content.replace(/\s+/g, " ").trim();
      const excerpt = compact.length > 260 ? `${compact.slice(0, 260)}...` : compact;
      return `${index + 1}. [${domain}] ${chunkId}: ${excerpt}`;
    });
    return ["Retrieved context (trusted evidence):", ...lines].join("\n");
  }
}
