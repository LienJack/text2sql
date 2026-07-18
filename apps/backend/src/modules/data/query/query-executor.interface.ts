import type { Datasource, DatasourceType } from "@text2sql/shared-types";

export interface QueryExecutionResult {
  columns: string[];
  rows: Array<Record<string, unknown>>;
}

export interface QueryExplainResult {
  capability: "available" | "unavailable";
  evidenceRefs: string[];
  reasonCodes: string[];
}

export interface QueryExecutor {
  readonly type: DatasourceType;
  execute(input: {
    datasource: Datasource;
    sql: string;
    abortSignal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<QueryExecutionResult>;
  explain?(input: {
    datasource: Datasource;
    sql: string;
    abortSignal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<QueryExplainResult>;
}
