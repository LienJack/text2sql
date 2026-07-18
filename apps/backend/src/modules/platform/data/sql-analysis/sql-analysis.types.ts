import type { DatasourceType } from "@text2sql/shared-types";
import type { DatasourceSchemaSnapshotV1 } from "../schema/schema-snapshot.types";

export type SupportedSqlDialect = "sqlite" | "mysql" | "postgresql";

export interface SqlAnalysisBudget {
  maxSqlBytes: number;
  maxStatements: number;
  maxAstDepth: number;
  maxAstNodes: number;
  maxLineageEntries: number;
}

export interface SqlAnalysisDiagnostic {
  code: string;
  category: "capability" | "parse" | "structural" | "resource" | "read_only";
  message: string;
}

export interface SqlAnalysisTableReference {
  name: string;
  normalizedName: string;
  catalog?: string;
  schema?: string;
}

export interface SqlAnalysisColumnReference {
  table?: string;
  name: string;
  normalizedName: string;
  wildcard: boolean;
}

export interface SqlAnalysisLineage {
  ctes: Array<{
    name: string;
    sourceTables: string[];
  }>;
  aliases: Record<string, string>;
  subqueryCount: number;
}

export interface SqlAnalysisResult {
  version: "sql-analysis.v1";
  status: "ready" | "failed" | "unavailable";
  datasourceType: DatasourceType;
  dialect?: SupportedSqlDialect;
  normalizedSqlDigest: string;
  statementCount: number;
  statementTypes: string[];
  readOnly: boolean;
  tables: SqlAnalysisTableReference[];
  columns: SqlAnalysisColumnReference[];
  functions: string[];
  wildcards: string[];
  parameters: string[];
  lineage: SqlAnalysisLineage;
  ast: unknown;
  astNodeCount: number;
  astDepth: number;
  diagnostics: SqlAnalysisDiagnostic[];
}

export interface SqlCatalogResolvedColumn {
  reference: SqlAnalysisColumnReference;
  table: string;
  column: string;
  qualifiedName: string;
}

export interface SqlCatalogResolutionResult {
  version: "sql-catalog-resolution.v1";
  status: "resolved" | "failed" | "unavailable";
  schemaSnapshotId?: string;
  schemaSnapshotDigest?: string;
  allowedSchemaDigest?: string;
  tables: string[];
  columns: SqlCatalogResolvedColumn[];
  ambiguousReferences: string[];
  unknownReferences: string[];
  reasonCodes: string[];
}

export interface ResolveSqlCatalogInput {
  analysis: SqlAnalysisResult;
  schemaSnapshot?: DatasourceSchemaSnapshotV1;
  requireSnapshot?: boolean;
}
