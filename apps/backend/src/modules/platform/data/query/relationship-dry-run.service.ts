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

export interface RelationshipDryPlanSnapshot {
  pass: boolean;
  missingTables: string[];
  reason?: string;
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

  evaluateJoinPathConsistency(input: {
    sql: string;
    selectedTables?: string[];
    joinPath?: string[];
  }): RelationshipDryPlanSnapshot {
    const selectedTables = this.normalizeIdentifiers(input.selectedTables ?? []);
    const joinPath = this.normalizeJoinPath(input.joinPath ?? []);
    if (selectedTables.length <= 1 && joinPath.length === 0) {
      return {
        pass: true,
        missingTables: []
      };
    }

    const referencedTables = this.extractTables(input.sql);
    const missingTables = selectedTables.filter(
      (table) => !referencedTables.includes(table)
    );
    if (missingTables.length > 0) {
      return {
        pass: false,
        missingTables,
        reason: `missing tables from relationship plan: ${missingTables.join(", ")}`
      };
    }

    if (joinPath.length > 0 && !/\bjoin\b/i.test(input.sql)) {
      return {
        pass: false,
        missingTables: selectedTables,
        reason: "join path exists but SQL has no JOIN keyword"
      };
    }

    return {
      pass: true,
      missingTables: []
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

  private extractTables(sql: string): string[] {
    const matches = [
      ...sql.matchAll(/\b(?:from|join)\s+([a-zA-Z_][\w$]*(?:\.[a-zA-Z_][\w$]*)?)/gi)
    ];
    const tables = matches
      .map((match) => this.normalizeIdentifier(match[1]))
      .filter((value): value is string => Boolean(value));
    return Array.from(new Set(tables));
  }

  private normalizeJoinPath(values: string[]): string[] {
    return Array.from(
      new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))
    );
  }

  private normalizeIdentifiers(values: string[]): string[] {
    return Array.from(
      new Set(
        values
          .map((value) => this.normalizeIdentifier(value))
          .filter((value): value is string => Boolean(value))
      )
    );
  }

  private normalizeIdentifier(value: string | undefined): string | undefined {
    if (!value) {
      return undefined;
    }
    const normalized = value
      .trim()
      .replace(/^[`"'\[\]]+|[`"'\[\]]+$/g, "")
      .replace(/\s+/g, "")
      .toLowerCase();
    return normalized.length > 0 ? normalized : undefined;
  }
}
