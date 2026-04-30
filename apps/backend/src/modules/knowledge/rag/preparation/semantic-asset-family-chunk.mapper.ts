import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { IngestionSourceInput } from "../../../rag/ingestion/ingestion-source.adapter";
import type { RagChunkProfile } from "../../../rag/ingestion/chunk-profiles";
import type {
  SemanticAssetFamily,
  SemanticAssetManifestEntry
} from "./semantic-asset-manifest.types";
import type { SemanticAssetSourceSnapshot } from "./semantic-asset-source-snapshot.types";

export interface SemanticAssetChunkMappingInput {
  manifestFingerprint: string;
  entry: SemanticAssetManifestEntry;
  snapshot: SemanticAssetSourceSnapshot;
}

@Injectable()
export class SemanticAssetFamilyChunkMapper {
  toIngestionSource(input: SemanticAssetChunkMappingInput): IngestionSourceInput {
    const metadata = this.metadataFor(input);
    const content = this.contentFor(input.entry.family, input.snapshot);
    const tableNames = this.tableNamesFor(input.snapshot);
    const columnNames = this.columnNamesFor(input.snapshot);
    const sourceRef = `${input.entry.sourceRef.type}:${input.entry.sourceRef.ref}`;

    if (input.entry.family === "prior_question_sql") {
      return {
        sourceType: "sql_example",
        datasourceId: input.entry.datasourceId,
        sourceVersion: input.entry.sourceVersion,
        contentChecksum: input.entry.sourceHash ?? this.digest(content),
        sourceRef,
        exampleId: input.snapshot.viewId ?? input.entry.sourceRef.ref,
        question: input.snapshot.question ?? input.snapshot.title ?? "Saved prior SQL",
        sql: input.snapshot.sql ?? content,
        rationale: input.snapshot.rationale,
        tableNames,
        columnNames,
        metadata
      };
    }

    if (input.entry.family === "business_term") {
      return {
        sourceType: "semantic_term",
        datasourceId: input.entry.datasourceId,
        sourceVersion: input.entry.sourceVersion,
        contentChecksum: input.entry.sourceHash ?? this.digest(content),
        sourceRef,
        termId: input.entry.sourceRef.ref,
        term: input.snapshot.term ?? input.snapshot.title ?? input.entry.sourceRef.ref,
        definition: input.snapshot.definition ?? content,
        synonyms: input.snapshot.synonyms,
        tableNames,
        columnNames,
        metadata
      };
    }

    return {
      sourceType: "semantic_asset",
      datasourceId: input.entry.datasourceId,
      sourceVersion: input.entry.sourceVersion,
      contentChecksum: input.entry.sourceHash ?? this.digest(content),
      sourceRef,
      assetFamily: input.entry.family,
      title: input.snapshot.title ?? this.titleFor(input.entry.family, input.snapshot),
      content,
      tableNames,
      columnNames,
      metadata,
      chunkProfile: this.chunkProfileFor(input.entry.family)
    };
  }

  private metadataFor(input: SemanticAssetChunkMappingInput): Record<string, unknown> {
    return {
      ...(input.snapshot.metadata ?? {}),
      assetFamily: input.entry.family,
      manifestFingerprint: input.manifestFingerprint,
      manifestEntryId: input.entry.id,
      semanticAssetSourceRef: input.entry.sourceRef,
      sourceHash: input.entry.sourceHash,
      sourceVersion: input.entry.sourceVersion,
      workspaceId: input.entry.workspaceId,
      datasourceId: input.entry.datasourceId,
      policyVersion: input.entry.policyVersion,
      modelingRevision: input.entry.modelingRevision,
      visibilityScope: input.entry.visibilityScope,
      preparationStatus: input.entry.status,
      reasonCodes: input.entry.reasonCodes,
      familySummary: input.entry.summary,
      compatibilitySignals: input.snapshot.compatibilitySignals,
      trusted: input.snapshot.trusted,
      verified: input.snapshot.verified,
      viewStatus: input.snapshot.viewStatus
    };
  }

  private contentFor(
    family: SemanticAssetFamily,
    snapshot: SemanticAssetSourceSnapshot
  ): string {
    if (snapshot.content?.trim()) {
      return snapshot.content.trim();
    }

    switch (family) {
      case "table_description":
        return this.joinLines([
          `Table: ${snapshot.tableName ?? snapshot.sourceRef?.ref ?? "unknown"}`,
          snapshot.summary?.description
            ? `Description: ${String(snapshot.summary.description)}`
            : snapshot.title
        ]);
      case "full_schema":
        return this.joinLines([
          `Schema: ${snapshot.tableName ?? snapshot.sourceRef?.ref ?? "unknown"}`,
          this.formatColumns(snapshot.columns),
          snapshot.summary?.ddl ? `DDL:\n${String(snapshot.summary.ddl)}` : undefined
        ]);
      case "column_batch":
        return this.joinLines([
          `Columns for ${snapshot.tableName ?? snapshot.sourceRef?.ref ?? "unknown"}`,
          this.formatColumns(snapshot.columns)
        ]);
      case "relationship_binding":
        return this.joinLines([
          "Relationships",
          ...(snapshot.relationships ?? []).map((relationship) =>
            this.joinLines([
              `${relationship.fromTable}.${relationship.fromColumn ?? "*"} -> ${
                relationship.toTable
              }.${relationship.toColumn ?? "*"}`,
              relationship.joinType ? `Join: ${relationship.joinType}` : undefined,
              relationship.description
            ])
          )
        ]);
      case "metric":
        return this.joinLines([
          `Metric: ${snapshot.title ?? snapshot.sourceRef?.ref ?? "unnamed"}`,
          snapshot.summary?.expression ? `Expression: ${String(snapshot.summary.expression)}` : undefined,
          snapshot.summary?.description
            ? `Description: ${String(snapshot.summary.description)}`
            : undefined
        ]);
      case "calculated_field":
        return this.joinLines([
          `Calculated Field: ${snapshot.title ?? snapshot.sourceRef?.ref ?? "unnamed"}`,
          snapshot.summary?.expression ? `Expression: ${String(snapshot.summary.expression)}` : undefined,
          snapshot.summary?.description
            ? `Description: ${String(snapshot.summary.description)}`
            : undefined
        ]);
      case "prompt_instruction":
        return this.joinLines([
          `Instruction: ${snapshot.scene ?? snapshot.sourceRef?.ref ?? "runtime"}`,
          snapshot.scope ? `Scope: ${snapshot.scope}` : undefined,
          snapshot.instructionSummary ?? snapshot.title
        ]);
      case "dialect_rule":
        return this.joinLines([
          `Dialect: ${snapshot.dialect ?? "unknown"}`,
          ...(snapshot.rules ?? [])
        ]);
      case "project_metadata":
        return this.joinLines([
          `Project: ${snapshot.projectName ?? snapshot.workspaceId ?? "workspace"}`,
          snapshot.summary ? JSON.stringify(snapshot.summary) : undefined
        ]);
      case "business_term":
      case "prior_question_sql":
        return this.joinLines([snapshot.title, snapshot.definition, snapshot.question, snapshot.sql]);
      default: {
        const exhaustive: never = family;
        return exhaustive;
      }
    }
  }

  private titleFor(family: SemanticAssetFamily, snapshot: SemanticAssetSourceSnapshot): string {
    const ref = snapshot.sourceRef?.ref ?? snapshot.tableName ?? snapshot.term ?? "asset";
    return `${family.replace(/_/g, " ")} ${ref}`;
  }

  private chunkProfileFor(family: SemanticAssetFamily): RagChunkProfile {
    const profiles: Record<SemanticAssetFamily, RagChunkProfile> = {
      table_description: "semantic_asset_table_description",
      full_schema: "semantic_asset_full_schema",
      column_batch: "semantic_asset_column_batch",
      relationship_binding: "semantic_asset_relationship",
      metric: "semantic_asset_metric",
      calculated_field: "semantic_asset_calculated_field",
      business_term: "semantic_asset_business_term",
      prompt_instruction: "semantic_asset_prompt_instruction",
      prior_question_sql: "semantic_asset_prior_question_sql",
      dialect_rule: "semantic_asset_dialect_rule",
      project_metadata: "semantic_asset_project_metadata"
    };
    return profiles[family];
  }

  private tableNamesFor(snapshot: SemanticAssetSourceSnapshot): string[] {
    return this.unique([
      ...(snapshot.tableNames ?? []),
      snapshot.tableName,
      ...(snapshot.relationships ?? []).flatMap((item) => [item.fromTable, item.toTable])
    ]);
  }

  private columnNamesFor(snapshot: SemanticAssetSourceSnapshot): string[] {
    return this.unique([
      ...(snapshot.columnNames ?? []),
      snapshot.columnName,
      ...(snapshot.columns ?? []).map((item) => item.name),
      ...(snapshot.relationships ?? []).flatMap((item) => [item.fromColumn, item.toColumn])
    ]);
  }

  private formatColumns(columns?: SemanticAssetSourceSnapshot["columns"]): string | undefined {
    if (!columns || columns.length === 0) {
      return undefined;
    }
    return columns
      .map((column) =>
        this.joinLines([
          `- ${column.name}${column.type ? ` ${column.type}` : ""}`,
          column.description ? `  ${column.description}` : undefined
        ])
      )
      .join("\n");
  }

  private joinLines(values: Array<string | undefined | null>): string {
    return values
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter((value) => value.length > 0)
      .join("\n");
  }

  private unique(values: Array<string | undefined>): string[] {
    return Array.from(
      new Set(
        values
          .map((value) => value?.trim())
          .filter((value): value is string => Boolean(value))
      )
    );
  }

  private digest(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }
}
