import { Injectable } from "@nestjs/common";
import type { Datasource } from "@text2sql/shared-types";
import type { QueryExecutionResult, QueryExecutor } from "./query-executor.interface";
import { SqliteQueryService } from "../sqlite/sqlite-query.service";

@Injectable()
export class SqliteExecutorService implements QueryExecutor {
  readonly type = "sqlite" as const;

  constructor(private readonly sqliteQuery: SqliteQueryService) {}

  async execute(input: {
    datasource: Datasource;
    sql: string;
  }): Promise<QueryExecutionResult> {
    return this.sqliteQuery.query(input.sql);
  }
}
