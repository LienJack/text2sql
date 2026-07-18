import { Injectable } from "@nestjs/common";
import type { DatasourceType } from "@text2sql/shared-types";
import { SqlDialectAnalyzerService } from "../../platform/data/sql-analysis/sql-dialect-analyzer.service";

export type RowFilterRewriteInput = {
  sql: string;
  referencedTables: string[];
  datasourceType?: DatasourceType;
  rowFiltersByTable?: Record<string, string>;
};

export type RowFilterRewriteResult =
  | {
      ok: true;
      sql: string;
      rewritten: boolean;
    }
  | {
      ok: false;
      reason: string;
    };

@Injectable()
export class RowFilterRewriteService {
  constructor(
    private readonly sqlAnalyzer: SqlDialectAnalyzerService = new SqlDialectAnalyzerService()
  ) {}

  rewrite(input: RowFilterRewriteInput): RowFilterRewriteResult {
    const tableFilters = this.resolveFilters(
      input.referencedTables,
      input.rowFiltersByTable
    );
    if (tableFilters.length === 0) {
      return {
        ok: true,
        sql: input.sql,
        rewritten: false
      };
    }
    if (input.referencedTables.length !== 1) {
      return {
        ok: false,
        reason: "检测到多表查询，当前行权限改写策略仅支持单表语句。"
      };
    }
    if (tableFilters.length > 1) {
      return {
        ok: false,
        reason: "检测到多条行过滤条件，当前策略无法安全合并。"
      };
    }

    const datasourceType = input.datasourceType ?? "sqlite";
    const originalAnalysis = this.sqlAnalyzer.analyze({
      sql: input.sql,
      datasourceType
    });
    if (
      originalAnalysis.status !== "ready" ||
      originalAnalysis.lineage.subqueryCount > 0
    ) {
      return {
        ok: false,
        reason: "SQL AST 无法证明当前行权限改写是安全的。"
      };
    }

    const normalizedSql = input.sql.trim().replace(/;+\s*$/, "");
    if (!normalizedSql) {
      return {
        ok: false,
        reason: "SQL 语句为空，无法应用行权限过滤。"
      };
    }

    // Conservative fail-closed: block unsupported set operations until parser support is added.
    if (/\b(union|intersect|except)\b/i.test(normalizedSql)) {
      return {
        ok: false,
        reason: "检测到集合运算语法，当前行权限改写不支持该语句。"
      };
    }

    const rowFilter = tableFilters[0];
    const clauseBoundaryIndex = this.findClauseBoundaryIndex(normalizedSql);
    const wherePattern = /\bwhere\b/i;
    const hasWhere = wherePattern.test(normalizedSql);
    const rewrittenSql = hasWhere
      ? this.appendToExistingWhere(normalizedSql, rowFilter, clauseBoundaryIndex)
      : this.insertWhereClause(normalizedSql, rowFilter, clauseBoundaryIndex);

    const rewrittenAnalysis = this.sqlAnalyzer.analyze({
      sql: rewrittenSql,
      datasourceType
    });
    if (
      rewrittenAnalysis.status !== "ready" ||
      rewrittenAnalysis.tables.map((table) => table.normalizedName).join("|") !==
        originalAnalysis.tables.map((table) => table.normalizedName).join("|")
    ) {
      return {
        ok: false,
        reason: "行权限改写后的 SQL 无法通过等价结构校验。"
      };
    }

    return {
      ok: true,
      sql: rewrittenSql,
      rewritten: true
    };
  }

  private resolveFilters(
    referencedTables: string[],
    rowFiltersByTable?: Record<string, string>
  ): string[] {
    if (!rowFiltersByTable) {
      return [];
    }
    const filters = new Set<string>();
    for (const tableName of referencedTables) {
      const normalized = tableName.trim().toLowerCase();
      const lastSegment = normalized.split(".").filter(Boolean).at(-1);
      const resolved =
        rowFiltersByTable[normalized]?.trim() ||
        (lastSegment ? rowFiltersByTable[lastSegment]?.trim() : "");
      if (resolved) {
        filters.add(resolved);
      }
    }
    return Array.from(filters);
  }

  private findClauseBoundaryIndex(sql: string): number {
    const clausePattern = /\b(group\s+by|having|order\s+by|limit|offset)\b/i;
    const matched = clausePattern.exec(sql);
    return matched?.index ?? -1;
  }

  private appendToExistingWhere(
    sql: string,
    rowFilter: string,
    boundaryIndex: number
  ): string {
    if (boundaryIndex < 0) {
      return `${sql} AND (${rowFilter})`;
    }
    const head = sql.slice(0, boundaryIndex).trimEnd();
    const tail = sql.slice(boundaryIndex).trimStart();
    return `${head} AND (${rowFilter}) ${tail}`;
  }

  private insertWhereClause(
    sql: string,
    rowFilter: string,
    boundaryIndex: number
  ): string {
    if (boundaryIndex < 0) {
      return `${sql} WHERE (${rowFilter})`;
    }
    const head = sql.slice(0, boundaryIndex).trimEnd();
    const tail = sql.slice(boundaryIndex).trimStart();
    return `${head} WHERE (${rowFilter}) ${tail}`;
  }
}
