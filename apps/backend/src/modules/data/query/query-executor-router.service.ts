import { Injectable } from "@nestjs/common";
import type { Datasource, DatasourceType } from "@text2sql/shared-types";
import { DomainError } from "../../../common/domain-error";
import type { QueryExecutionResult } from "./query-executor.interface";
import { FileDatasourceExecutorService } from "./file-datasource-executor.service";
import { MysqlExecutorService } from "./mysql-executor.service";
import { PostgresExecutorService } from "./postgres-executor.service";
import {
  SqlTableAccessGuardService,
  type SqlPolicyLookupResolver,
  type SqlTableAccessContext
} from "./sql-table-access-guard.service";
import { SqliteExecutorService } from "./sqlite-executor.service";

const MAX_QUERY_LIMIT = 200;
const DEFAULT_QUERY_LIMIT = 50;

export interface QueryValidationCapabilities {
  dryRun: boolean;
  dryPlan: boolean;
  reason?: string;
}

export interface QueryDryPlanSnapshot {
  complete: boolean;
  referencedTables: string[];
  reason?: string;
}

export interface QueryExecutionTablePermissionsOptions {
  accessContext?: SqlTableAccessContext;
  allowedTables?: Iterable<string>;
  resolveAllowedTables?: SqlPolicyLookupResolver;
}

@Injectable()
export class QueryExecutorRouterService {
  private readonly tableAccessGuard = new SqlTableAccessGuardService();
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
    tablePermissions?: QueryExecutionTablePermissionsOptions;
  }): Promise<QueryExecutionResult> {
    this.tableAccessGuard.assertReadOnlySql(input.sql);
    const guarded = await this.tableAccessGuard.assertTableAccess({
      sql: input.sql,
      datasourceId: input.datasource.id,
      accessContext: input.tablePermissions?.accessContext,
      allowedTables: input.tablePermissions?.allowedTables,
      resolveAllowedTables: input.tablePermissions?.resolveAllowedTables
    });
    const normalizedSql = this.ensureLimit(guarded.sql, input.limit);
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

  getValidationCapabilities(datasourceType: DatasourceType): QueryValidationCapabilities {
    if (datasourceType === "csv" || datasourceType === "excel") {
      return {
        dryRun: false,
        dryPlan: true,
        reason: `${datasourceType} datasource does not support pre-execution dry-run`
      };
    }
    return {
      dryRun: true,
      dryPlan: true
    };
  }

  buildDryPlan(sql: string): QueryDryPlanSnapshot {
    const extraction = this.tableAccessGuard.extractReferencedTables(sql);
    return {
      complete: extraction.complete,
      referencedTables: extraction.tables,
      ...(extraction.reason ? { reason: extraction.reason } : {})
    };
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
}
