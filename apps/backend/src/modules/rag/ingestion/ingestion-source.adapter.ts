import { Injectable } from "@nestjs/common";
import type { RagChunkProfile } from "./chunk-profiles";

export type RagIngestionSourceType = "schema" | "sql_example" | "semantic_term";

interface IngestionBaseInput {
  datasourceId: string;
  sourceVersion: string;
  contentChecksum: string;
  sourceRef?: string;
  metadata?: Record<string, unknown>;
}

export interface SchemaIngestionSourceInput extends IngestionBaseInput {
  sourceType: "schema";
  tableName: string;
  columnName?: string;
  ddl?: string;
  description?: string;
}

export interface SqlExampleIngestionSourceInput extends IngestionBaseInput {
  sourceType: "sql_example";
  exampleId?: string;
  question: string;
  sql: string;
  rationale?: string;
  tableNames?: string[];
  columnNames?: string[];
}

export interface SemanticTermIngestionSourceInput extends IngestionBaseInput {
  sourceType: "semantic_term";
  termId?: string;
  term: string;
  definition: string;
  synonyms?: string[];
  tableNames?: string[];
  columnNames?: string[];
}

export type IngestionSourceInput =
  | SchemaIngestionSourceInput
  | SqlExampleIngestionSourceInput
  | SemanticTermIngestionSourceInput;

export interface NormalizedRagDocumentInput {
  datasourceId: string;
  domain: string;
  sourceType: RagIngestionSourceType;
  sourceRef?: string;
  sourceVersion: string;
  contentChecksum: string;
  title?: string;
  content: string;
  tableNames: string[];
  columnNames: string[];
  metadata?: Record<string, unknown>;
  chunkProfile: RagChunkProfile;
}

@Injectable()
export class IngestionSourceAdapter {
  normalize(input: IngestionSourceInput): NormalizedRagDocumentInput {
    switch (input.sourceType) {
      case "schema":
        return this.normalizeSchemaSource(input);
      case "sql_example":
        return this.normalizeSqlExampleSource(input);
      case "semantic_term":
        return this.normalizeSemanticTermSource(input);
      default: {
        const exhaustive: never = input;
        return exhaustive;
      }
    }
  }

  private normalizeSchemaSource(input: SchemaIngestionSourceInput): NormalizedRagDocumentInput {
    const tableName = input.tableName.trim();
    const columnName = input.columnName?.trim() || undefined;
    const sourceRef = input.sourceRef ?? (columnName ? `${tableName}.${columnName}` : tableName);
    const title = columnName ? `Schema Column ${sourceRef}` : `Schema Table ${tableName}`;
    const contentParts = [
      `Schema Source: ${columnName ? "column" : "table"}`,
      `Table: ${tableName}`,
      columnName ? `Column: ${columnName}` : "",
      input.ddl?.trim() ? `DDL:\n${input.ddl.trim()}` : "",
      input.description?.trim() ? `Description: ${input.description.trim()}` : ""
    ].filter(Boolean);

    return {
      datasourceId: input.datasourceId,
      domain: "schema",
      sourceType: input.sourceType,
      sourceRef,
      sourceVersion: input.sourceVersion,
      contentChecksum: input.contentChecksum,
      title,
      content: contentParts.join("\n\n"),
      tableNames: uniqueNonEmpty([tableName]),
      columnNames: uniqueNonEmpty(columnName ? [columnName] : []),
      metadata: {
        schemaKind: columnName ? "column" : "table",
        ...(input.metadata ?? {})
      },
      chunkProfile: columnName ? "schema_column" : "schema_table"
    };
  }

  private normalizeSqlExampleSource(
    input: SqlExampleIngestionSourceInput
  ): NormalizedRagDocumentInput {
    const sourceRef = input.sourceRef ?? input.exampleId;
    const contentParts = [
      `Question: ${input.question.trim()}`,
      `SQL:\n${input.sql.trim()}`,
      input.rationale?.trim() ? `Rationale: ${input.rationale.trim()}` : ""
    ].filter(Boolean);

    return {
      datasourceId: input.datasourceId,
      domain: "sql_example",
      sourceType: input.sourceType,
      sourceRef,
      sourceVersion: input.sourceVersion,
      contentChecksum: input.contentChecksum,
      title: sourceRef ? `SQL Example ${sourceRef}` : "SQL Example",
      content: contentParts.join("\n\n"),
      tableNames: uniqueNonEmpty(input.tableNames ?? []),
      columnNames: uniqueNonEmpty(input.columnNames ?? []),
      metadata: {
        exampleId: input.exampleId,
        ...(input.metadata ?? {})
      },
      chunkProfile: "sql_example"
    };
  }

  private normalizeSemanticTermSource(
    input: SemanticTermIngestionSourceInput
  ): NormalizedRagDocumentInput {
    const sourceRef = input.sourceRef ?? input.termId ?? input.term.trim();
    const synonymList = uniqueNonEmpty(input.synonyms ?? []);
    const contentParts = [
      `Term: ${input.term.trim()}`,
      `Definition: ${input.definition.trim()}`,
      synonymList.length > 0 ? `Synonyms: ${synonymList.join(", ")}` : ""
    ].filter(Boolean);

    return {
      datasourceId: input.datasourceId,
      domain: "semantic_term",
      sourceType: input.sourceType,
      sourceRef,
      sourceVersion: input.sourceVersion,
      contentChecksum: input.contentChecksum,
      title: `Semantic Term ${input.term.trim()}`,
      content: contentParts.join("\n\n"),
      tableNames: uniqueNonEmpty(input.tableNames ?? []),
      columnNames: uniqueNonEmpty(input.columnNames ?? []),
      metadata: {
        term: input.term.trim(),
        ...(input.metadata ?? {})
      },
      chunkProfile: "semantic_term"
    };
  }
}

const uniqueNonEmpty = (values: string[]): string[] => {
  const normalized = values.map((value) => value.trim()).filter((value) => value.length > 0);
  return Array.from(new Set(normalized.values()));
};
