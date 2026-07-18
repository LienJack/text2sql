import { Injectable } from "@nestjs/common";
import type { Datasource } from "@text2sql/shared-types";
import { DomainError } from "../../../common/domain-error";
import type { QueryExecutionResult, QueryExecutor } from "./query-executor.interface";
import { SqliteQueryService } from "../sqlite/sqlite-query.service";

@Injectable()
export class SqliteExecutorService implements QueryExecutor {
  readonly type = "sqlite" as const;

  constructor(private readonly sqliteQuery: SqliteQueryService) {}

  async execute(input: {
    datasource: Datasource;
    sql: string;
    abortSignal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<QueryExecutionResult> {
    return this.sqliteQuery.query(input.sql, {
      filePath: this.resolveDatasourcePath(input.datasource),
      abortSignal: input.abortSignal,
      timeoutMs: input.timeoutMs
    });
  }

  async explain(input: {
    datasource: Datasource;
    sql: string;
    abortSignal?: AbortSignal;
    timeoutMs?: number;
  }) {
    await this.sqliteQuery.dryRun(input.sql, {
      filePath: this.resolveDatasourcePath(input.datasource),
      abortSignal: input.abortSignal,
      timeoutMs: input.timeoutMs
    });
    return {
      capability: "available" as const,
      evidenceRefs: ["sqlite:explain-query-plan"],
      reasonCodes: ["sqlite_explain_passed"]
    };
  }

  private resolveDatasourcePath(datasource: Datasource): string {
    const path =
      datasource.config && typeof datasource.config.path === "string"
        ? datasource.config.path.trim()
        : "";

    if (path) {
      return path;
    }

    if (datasource.id === "sqlite_main") {
      return this.sqliteQuery.dbPath;
    }

    throw new DomainError(
      "SQLITE_DATASOURCE_PATH_MISSING",
      "当前 SQLite 数据源缺少可执行路径，请更新数据源配置后重试。",
      400,
      {
        datasourceId: datasource.id,
        field: "config.path",
        suggestedAction: "previous"
      }
    );
  }
}
