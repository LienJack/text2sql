import { Injectable } from "@nestjs/common";
import type { DatasourceType } from "@text2sql/shared-types";
import type { LlmGatewayPrompt } from "../../../llm/llm-gateway.interface";
import type { RetrievedKnowledge } from "../nodes/retrieve-knowledge.node";
import type { RagContextPack } from "../../../rag/retrieval/rag-retrieval.types";

type RagRetrievalChunkPayload = NonNullable<
  NonNullable<RetrievedKnowledge["retrievalBundle"]>["selected_context"]
>[number];

export type SqlSemanticIntent = "count" | "metadata" | "general";

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
      semanticGuardrail?: {
        intent: SqlSemanticIntent;
        retryReason?: string;
      };
      semanticContextPack?: RagContextPack;
    }
  ): LlmGatewayPrompt {
    const dialect = DIALECT_HINT[datasourceType] ?? "SQLite";
    const tableHint =
      datasourceType === "csv" || datasourceType === "excel"
        ? "For file datasources, the default imported table name is usually `uploaded_data`."
        : "";
    const contextBlock = this.buildContextBlock(selectedContext);
    const semanticInstructionBlock = this.buildSemanticInstructionBlock(
      options?.semanticContextPack
    );
    const overlayBlock = this.buildTemplateOverlay(options?.templateOverlay);
    const semanticGuardrailBlock = this.buildSemanticGuardrailBlock(
      options?.semanticGuardrail?.intent ?? "general"
    );
    const repairHintBlock = this.buildRepairHintBlock(
      options?.semanticGuardrail?.retryReason
    );
    return {
      systemPrompt: [
        `You are a senior SQL analyst for a ${dialect} datasource.`,
        "Only produce read-only SQL queries.",
        "Prefer SELECT or WITH ... SELECT statements.",
        "Never generate INSERT/UPDATE/DELETE/DDL.",
        semanticGuardrailBlock,
        repairHintBlock,
        tableHint,
        overlayBlock,
        semanticInstructionBlock,
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

  private buildSemanticGuardrailBlock(intent: SqlSemanticIntent): string {
    if (intent === "count") {
      return [
        "Semantic guardrail: this is a business count-intent query.",
        "The final SQL must contain COUNT(...) aggregation over business data.",
        "Do not return schema/metadata introspection SQL."
      ].join(" ");
    }
    if (intent === "metadata") {
      return [
        "Semantic guardrail: this is a metadata-intent query.",
        "The final SQL must use schema introspection paths",
        "(for example sqlite_master, sqlite_schema, pragma, information_schema, SHOW TABLES).",
        "Do not return business row counting SQL."
      ].join(" ");
    }
    return "Semantic guardrail: ensure SQL semantics strictly match the user question intent.";
  }

  private buildRepairHintBlock(retryReason?: string): string {
    const normalized = retryReason?.trim();
    if (!normalized) {
      return "";
    }
    return `Retry repair hint (single automatic retry): previous SQL failed semantic guardrail because ${normalized}. Return corrected final SQL only.`;
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

  private buildSemanticInstructionBlock(contextPack?: RagContextPack): string {
    if (!contextPack || contextPack.status === "degraded") {
      return "";
    }
    const instructionSets = contextPack.instruction_sets;
    const lines: string[] = [];
    if (instructionSets.metric_bindings.length > 0) {
      lines.push(
        `Metric bindings: ${instructionSets.metric_bindings.slice(0, 8).join(", ")}`
      );
    }
    if (instructionSets.relationship_bindings.length > 0) {
      lines.push(
        `Relationship bindings: ${instructionSets.relationship_bindings
          .slice(0, 8)
          .join(", ")}`
      );
    }
    if (instructionSets.calculated_field_bindings.length > 0) {
      lines.push(
        `Calculated-field bindings: ${instructionSets.calculated_field_bindings
          .slice(0, 8)
          .join(", ")}`
      );
    }
    if (lines.length === 0) {
      return "";
    }
    return [
      "Structured semantic instruction set (higher priority than free-text context):",
      ...lines
    ].join(" ");
  }
}
