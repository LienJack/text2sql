import { Injectable } from "@nestjs/common";
import type { Datasource, DatasourceType } from "@text2sql/shared-types";
import { DomainError } from "../../../common/domain-error";
import type { QueryExecutionResult } from "./query-executor.interface";
import { FileDatasourceExecutorService } from "./file-datasource-executor.service";
import { MysqlExecutorService } from "./mysql-executor.service";
import { PostgresExecutorService } from "./postgres-executor.service";
import { SqliteExecutorService } from "./sqlite-executor.service";

const MAX_QUERY_LIMIT = 200;
const DEFAULT_QUERY_LIMIT = 50;
const FORBIDDEN_KEYWORDS = [
  "insert",
  "update",
  "delete",
  "drop",
  "alter",
  "truncate",
  "create",
  "replace",
  "attach",
  "detach",
  "pragma"
] as const;

@Injectable()
export class QueryExecutorRouterService {
  private readonly executors: Map<DatasourceType, {
    execute: (input: { datasource: Datasource; sql: string }) => Promise<QueryExecutionResult>;
  }>;

  constructor(
    sqliteExecutor: SqliteExecutorService,
    mysqlExecutor: MysqlExecutorService,
    postgresExecutor: PostgresExecutorService,
    fileDatasourceExecutor: FileDatasourceExecutorService
  ) {
    this.executors = new Map<DatasourceType, {
      execute: (input: { datasource: Datasource; sql: string }) => Promise<QueryExecutionResult>;
    }>([
      ["sqlite", sqliteExecutor],
      ["mysql", mysqlExecutor],
      ["postgresql", postgresExecutor],
      ["csv", fileDatasourceExecutor],
      ["excel", fileDatasourceExecutor]
    ]);
  }

  async execute(input: {
    datasource: Datasource;
    sql: string;
    limit?: number;
  }): Promise<QueryExecutionResult> {
    this.assertReadOnlySql(input.sql);
    const normalizedSql = this.ensureLimit(input.sql, input.limit);
    const executor = this.executors.get(input.datasource.type);

    if (!executor) {
      throw new DomainError(
        "DATASOURCE_TYPE_UNSUPPORTED",
        `暂不支持 ${input.datasource.type} 数据源执行。`,
        400,
        {
          datasourceId: input.datasource.id,
          type: input.datasource.type
        }
      );
    }

    return executor.execute({
      datasource: input.datasource,
      sql: normalizedSql
    });
  }

  private ensureLimit(sql: string, limit?: number): string {
    const normalized = sql.trim().replace(/;\s*$/, "");
    const limitWithOffsetPattern = /\blimit\s+(\d+)\s+offset\s+(\d+)\s*$/i;
    const mysqlLimitPattern = /\blimit\s+(\d+)\s*,\s*(\d+)\s*$/i;
    const simpleLimitPattern = /\blimit\s+(\d+)\s*$/i;

    const normalizeLimit = (value: number): number =>
      Math.min(Math.max(value, 1), MAX_QUERY_LIMIT);

    const withOffsetMatch = normalized.match(limitWithOffsetPattern);
    if (withOffsetMatch) {
      const existingLimit = Number(withOffsetMatch[1]);
      const offset = Number(withOffsetMatch[2]);
      const clampedLimit = normalizeLimit(existingLimit);
      if (existingLimit === clampedLimit) {
        return normalized;
      }
      return normalized.replace(
        limitWithOffsetPattern,
        `LIMIT ${clampedLimit} OFFSET ${offset}`
      );
    }

    const mysqlLimitMatch = normalized.match(mysqlLimitPattern);
    if (mysqlLimitMatch) {
      const offset = Number(mysqlLimitMatch[1]);
      const existingLimit = Number(mysqlLimitMatch[2]);
      const clampedLimit = normalizeLimit(existingLimit);
      if (existingLimit === clampedLimit) {
        return normalized;
      }
      return normalized.replace(
        mysqlLimitPattern,
        `LIMIT ${offset}, ${clampedLimit}`
      );
    }

    const simpleLimitMatch = normalized.match(simpleLimitPattern);
    if (simpleLimitMatch) {
      const existingLimit = Number(simpleLimitMatch[1]);
      const clampedLimit = normalizeLimit(existingLimit);
      if (existingLimit === clampedLimit) {
        return normalized;
      }
      return normalized.replace(simpleLimitPattern, `LIMIT ${clampedLimit}`);
    }

    const finalLimit = Math.min(
      Math.max(limit ?? DEFAULT_QUERY_LIMIT, 1),
      MAX_QUERY_LIMIT
    );
    return `${normalized} LIMIT ${finalLimit}`;
  }

  private assertReadOnlySql(sql: string): void {
    const normalized = sql.trim();
    const statementWithoutTailSemicolon = normalized.replace(/;+\s*$/, "");
    if (statementWithoutTailSemicolon.includes(";")) {
      throw new DomainError(
        "SQL_READONLY_REJECTED",
        "检测到多语句执行，已拒绝。",
        400,
        { sql }
      );
    }
    if (!/^\s*(select\b|with\b)/i.test(statementWithoutTailSemicolon)) {
      throw new DomainError(
        "SQL_READONLY_REJECTED",
        "只允许执行 SELECT 或 WITH ... SELECT 的只读查询。",
        400,
        { sql }
      );
    }
    for (const keyword of FORBIDDEN_KEYWORDS) {
      if (new RegExp(`\\b${keyword}\\b`, "i").test(statementWithoutTailSemicolon)) {
        throw new DomainError(
          "SQL_READONLY_REJECTED",
          `检测到受限关键字 ${keyword.toUpperCase()}，只允许只读查询。`,
          400,
          { sql }
        );
      }
    }
  }
}
