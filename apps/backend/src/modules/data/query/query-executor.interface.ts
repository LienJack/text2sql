import type { Datasource, DatasourceType } from "@text2sql/shared-types";

export interface QueryExecutionResult {
  columns: string[];
  rows: Array<Record<string, unknown>>;
}

export interface QueryExecutor {
  readonly type: DatasourceType;
  execute(input: {
    datasource: Datasource;
    sql: string;
  }): Promise<QueryExecutionResult>;
}
