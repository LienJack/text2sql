import { Injectable } from "@nestjs/common";
import { DomainError } from "../../../../common/domain-error";
import { DatasourceRepository } from "../../../data/persistence/datasource.repository";
import type { SqlTableAccessContext } from "../../../data/query/sql-table-access-guard.service";
import { QueryExecutorRouterService } from "../../../data/query/query-executor-router.service";

export interface RelationshipDryRunResult {
  pass: boolean;
  executedCount: number;
  failedSamples: Array<{
    sql: string;
    reason: string;
  }>;
}

const MAX_SAMPLE_COUNT = 20;
const MAX_SQL_LENGTH = 2000;

@Injectable()
export class RelationshipDryRunService {
  constructor(
    private readonly datasourceRepository: DatasourceRepository,
    private readonly queryExecutorRouter: QueryExecutorRouterService
  ) {}

  async execute(input: {
    datasourceId: string;
    sqlSamples: string[];
    allowedTables: string[];
    accessContext: SqlTableAccessContext;
  }): Promise<RelationshipDryRunResult> {
    const datasourceId = input.datasourceId.trim();
    if (!datasourceId) {
      throw new DomainError("VALIDATION_ERROR", "datasourceId 不能为空。", 400);
    }
    const datasource = await this.datasourceRepository.getDatasourceById(datasourceId, {
      includeDeleted: true
    });
    if (!datasource || datasource.status === "deleted") {
      throw new DomainError("DATASOURCE_NOT_FOUND", "数据源不存在或已删除。", 404, {
        datasourceId
      });
    }

    const normalizedSamples = this.normalizeSqlSamples(input.sqlSamples);
    const failedSamples: Array<{ sql: string; reason: string }> = [];
    let executedCount = 0;

    for (const sql of normalizedSamples) {
      try {
        await this.queryExecutorRouter.execute({
          datasource,
          sql,
          limit: 10,
          tablePermissions: {
            accessContext: input.accessContext,
            allowedTables: input.allowedTables
          }
        });
        executedCount += 1;
      } catch (error) {
        failedSamples.push({
          sql,
          reason: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return {
      pass: failedSamples.length === 0,
      executedCount,
      failedSamples
    };
  }

  private normalizeSqlSamples(sqlSamples: string[]): string[] {
    const normalized = sqlSamples
      .map((item) => item.trim().replace(/;\s*$/, ""))
      .filter(Boolean)
      .slice(0, MAX_SAMPLE_COUNT)
      .map((item) => item.slice(0, MAX_SQL_LENGTH));
    if (normalized.length === 0) {
      return ["SELECT 1"];
    }
    return normalized;
  }
}
