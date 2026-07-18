import { createHash } from "node:crypto";
import { Injectable, Optional } from "@nestjs/common";
import type {
  DatasourceType,
  Text2SqlEvalVersionTupleV1,
  Text2SqlQueryContractV1,
  Text2SqlRepairReceiptV1
} from "@text2sql/shared-types";
import { Parser } from "node-sql-parser";
import type { DatasourceSchemaSnapshotV1 } from "../../platform/data/schema/schema-snapshot.types";
import { SqlDialectAnalyzerService } from "../../platform/data/sql-analysis/sql-dialect-analyzer.service";
import { createText2SqlRepairReceipt } from "../contracts/text2sql-v2.types";

type RepairPatchKind = Text2SqlRepairReceiptV1["patchKind"];

export interface SqlRepairResult {
  status: "applied" | "rejected";
  patchedSql?: string;
  receipt: Text2SqlRepairReceiptV1;
  failureSignature: string;
  failureCode?: string;
}

interface RepairCandidate {
  sql: string;
  patchId: string;
  patchKind: RepairPatchKind;
  allowedChangedDimensions: string[];
}

const PARSER_DATABASE: Partial<Record<DatasourceType, string>> = {
  sqlite: "SQLite",
  mysql: "MySQL",
  postgresql: "Postgresql"
};

const NORMALIZED_FAILURE_ALLOWLIST = new Set([
  "SQL_CATALOG_REFERENCE_AMBIGUOUS",
  "SQL_MISSING_COLUMN",
  "SQL_DIALECT_MISMATCH",
  "SQL_ANALYSIS_DIALECT_FUNCTION_UNSUPPORTED"
]);

@Injectable()
export class SqlRepairService {
  private readonly parser = new Parser();

  constructor(
    @Optional()
    private readonly sqlAnalyzer: SqlDialectAnalyzerService = new SqlDialectAnalyzerService()
  ) {}

  repair(input: {
    failedSql: string;
    failureCode?: string;
    runId: string;
    queryContract: Text2SqlQueryContractV1;
    versions: Text2SqlEvalVersionTupleV1;
    datasourceType: DatasourceType;
    schemaSnapshot: DatasourceSchemaSnapshotV1;
    attempt: 1 | 2;
    seenSqlDigests?: string[];
    seenFailureSignatures?: string[];
  }): SqlRepairResult {
    const parentAnalysis = this.sqlAnalyzer.analyze({
      sql: input.failedSql,
      datasourceType: input.datasourceType
    });
    const parentSqlDigest = parentAnalysis.normalizedSqlDigest;
    const failureSignature = this.hash(
      `${input.failureCode ?? "unknown"}:${parentSqlDigest}`
    );
    const rejected = (reasonCode: string, candidate?: RepairCandidate): SqlRepairResult => {
      const patchedSqlDigest = candidate
        ? this.sqlAnalyzer.analyze({
            sql: candidate.sql,
            datasourceType: input.datasourceType
          }).normalizedSqlDigest
        : parentSqlDigest;
      return {
        status: "rejected",
        failureSignature,
        failureCode: reasonCode,
        receipt: createText2SqlRepairReceipt({
          runId: input.runId,
          queryContractDigest: input.queryContract.digest,
          versions: input.versions,
          parentSqlDigest,
          patchedSqlDigest,
          patchId: candidate?.patchId ?? `repair-rejected:${failureSignature.slice(0, 16)}`,
          patchKind: candidate?.patchKind ?? "identifier_qualification",
          equivalenceStatus: "rejected",
          attempt: input.attempt,
          changedSemanticDimensions: [],
          reasonCodes: [reasonCode],
          issuedAt: new Date().toISOString()
        })
      };
    };

    if (!input.failureCode || !NORMALIZED_FAILURE_ALLOWLIST.has(input.failureCode)) {
      return rejected("repair_failure_not_allowlisted");
    }
    if (input.queryContract.runId !== input.runId) {
      return rejected("repair_query_contract_run_mismatch");
    }
    if (input.schemaSnapshot.datasourceType !== input.datasourceType) {
      return rejected("repair_schema_dialect_mismatch");
    }
    if (
      input.seenSqlDigests?.includes(parentSqlDigest) ||
      input.seenFailureSignatures?.includes(failureSignature)
    ) {
      return rejected("repair_cycle_detected");
    }

    const candidate =
      input.failureCode === "SQL_DIALECT_MISMATCH" ||
      input.failureCode === "SQL_ANALYSIS_DIALECT_FUNCTION_UNSUPPORTED"
        ? this.buildDialectEquivalentCandidate(input.failedSql, input.datasourceType)
        : this.buildIdentifierQualificationCandidate({
            sql: input.failedSql,
            datasourceType: input.datasourceType,
            queryContract: input.queryContract,
            schemaSnapshot: input.schemaSnapshot
          });
    if (!candidate) {
      return rejected("repair_patch_unavailable");
    }

    const patchedAnalysis = this.sqlAnalyzer.analyze({
      sql: candidate.sql,
      datasourceType: input.datasourceType
    });
    if (patchedAnalysis.status !== "ready" || !patchedAnalysis.readOnly) {
      return rejected("repair_patched_sql_not_structurally_ready", candidate);
    }
    if (
      patchedAnalysis.normalizedSqlDigest === parentSqlDigest ||
      input.seenSqlDigests?.includes(patchedAnalysis.normalizedSqlDigest)
    ) {
      return rejected("repair_no_progress_or_cycle", candidate);
    }

    const changedSemanticDimensions = this.diffSemanticDimensions({
      parentAst: parentAnalysis.ast,
      patchedAst: patchedAnalysis.ast,
      patchKind: candidate.patchKind
    });
    const forbiddenChanges = changedSemanticDimensions.filter(
      (dimension) => !candidate.allowedChangedDimensions.includes(dimension)
    );
    if (forbiddenChanges.length > 0) {
      return rejected(`repair_semantic_drift:${forbiddenChanges.join(",")}`, candidate);
    }

    return {
      status: "applied",
      patchedSql: candidate.sql,
      failureSignature,
      receipt: createText2SqlRepairReceipt({
        runId: input.runId,
        queryContractDigest: input.queryContract.digest,
        versions: input.versions,
        parentSqlDigest,
        patchedSqlDigest: patchedAnalysis.normalizedSqlDigest,
        patchId: candidate.patchId,
        patchKind: candidate.patchKind,
        equivalenceStatus: "proven",
        attempt: input.attempt,
        changedSemanticDimensions,
        reasonCodes: ["repair_ast_equivalence_proven"],
        issuedAt: new Date().toISOString()
      })
    };
  }

  buildFailureSignature(failureCode: string | undefined, sqlDigest: string): string {
    return this.hash(`${failureCode ?? "unknown"}:${sqlDigest}`);
  }

  private buildIdentifierQualificationCandidate(input: {
    sql: string;
    datasourceType: DatasourceType;
    queryContract: Text2SqlQueryContractV1;
    schemaSnapshot: DatasourceSchemaSnapshotV1;
  }): RepairCandidate | undefined {
    const database = PARSER_DATABASE[input.datasourceType];
    if (!database) {
      return undefined;
    }
    const targetByColumn = new Map<string, string>();
    for (const required of input.queryContract.requiredColumns) {
      const [table, column, ...tail] = required.toLowerCase().split(".");
      if (!table || !column || tail.length > 0) {
        continue;
      }
      const allowedColumns = input.schemaSnapshot.allowedSchemaSet.columnsByTable[table] ?? [];
      if (!allowedColumns.some((item) => item.toLowerCase() === column)) {
        continue;
      }
      if (targetByColumn.has(column) && targetByColumn.get(column) !== table) {
        targetByColumn.delete(column);
        continue;
      }
      targetByColumn.set(column, table);
    }
    if (targetByColumn.size === 0) {
      return undefined;
    }

    try {
      const parsed = this.parser.parse(input.sql, { database });
      const ast = parsed.ast;
      const aliasByTable = this.collectAliasByTable(ast);
      let mutationCount = 0;
      this.walk(ast, (record) => {
        if (record.type !== "column_ref" || this.readString(record.table)) {
          return;
        }
        const column = this.readColumnName(record.column)?.toLowerCase();
        const targetTable = column ? targetByColumn.get(column) : undefined;
        if (!targetTable) {
          return;
        }
        record.table = aliasByTable.get(targetTable) ?? targetTable;
        mutationCount += 1;
      });
      if (mutationCount === 0) {
        return undefined;
      }
      return {
        sql: this.parser.sqlify(ast, { database }),
        patchId: `qualify:${Array.from(targetByColumn.entries())
          .map(([column, table]) => `${table}.${column}`)
          .sort()
          .join(",")}`,
        patchKind: "identifier_qualification",
        allowedChangedDimensions: ["identifier_qualification"]
      };
    } catch {
      return undefined;
    }
  }

  private buildDialectEquivalentCandidate(
    sql: string,
    datasourceType: DatasourceType
  ): RepairCandidate | undefined {
    let patched = sql;
    let patchId: string | undefined;
    if (datasourceType === "postgresql") {
      patched = sql.replace(
        /strftime\s*\(\s*(['"])%Y\1\s*,\s*([A-Za-z_][\w.]*)\s*\)/gi,
        "to_char($2, 'YYYY')"
      );
      patchId = patched !== sql ? "dialect:strftime-year:to-char" : undefined;
    } else if (datasourceType === "mysql") {
      patched = sql.replace(
        /strftime\s*\(\s*(['"])%Y\1\s*,\s*([A-Za-z_][\w.]*)\s*\)/gi,
        "date_format($2, '%Y')"
      );
      patchId = patched !== sql ? "dialect:strftime-year:date-format" : undefined;
    } else if (datasourceType === "sqlite") {
      patched = sql.replace(
        /date_trunc\s*\(\s*(['"])month\1\s*,\s*([A-Za-z_][\w.]*)\s*\)/gi,
        "strftime('%Y-%m-01', $2)"
      );
      patchId = patched !== sql ? "dialect:date-trunc-month:strftime" : undefined;
    }
    if (!patchId) {
      return undefined;
    }
    return {
      sql: patched,
      patchId,
      patchKind: "dialect_equivalent",
      allowedChangedDimensions: ["dialect_equivalent"]
    };
  }

  private diffSemanticDimensions(input: {
    parentAst: unknown;
    patchedAst: unknown;
    patchKind: RepairPatchKind;
  }): string[] {
    const parent = this.semanticFingerprint(input.parentAst, input.patchKind);
    const patched = this.semanticFingerprint(input.patchedAst, input.patchKind);
    const changed: string[] = [];
    for (const key of Object.keys(parent) as Array<keyof typeof parent>) {
      if (JSON.stringify(parent[key]) !== JSON.stringify(patched[key])) {
        changed.push(key);
      }
    }
    if (changed.length === 0) {
      changed.push(input.patchKind);
    }
    return changed;
  }

  private semanticFingerprint(ast: unknown, patchKind: RepairPatchKind): Record<string, unknown> {
    const root = Array.isArray(ast) ? ast[0] : ast;
    const record = this.asRecord(root) ?? {};
    return {
      statement: record.type,
      datasource: this.canonicalAst(record.from, {
        stripColumnTable: patchKind === "identifier_qualification",
        normalizeDialectFunction: false
      }),
      result_shape: this.projectionShape(record.columns),
      aggregation: this.collectNodeValues(ast, "aggr_func", "name"),
      metric: this.canonicalAst(record.columns, {
        stripColumnTable: patchKind === "identifier_qualification",
        normalizeDialectFunction: patchKind === "dialect_equivalent"
      }),
      filter: this.canonicalAst(record.where, { stripColumnTable: patchKind === "identifier_qualification", normalizeDialectFunction: false }),
      grain: this.canonicalAst(record.groupby, { stripColumnTable: patchKind === "identifier_qualification", normalizeDialectFunction: false }),
      join: this.canonicalAst(record.from, { stripColumnTable: patchKind === "identifier_qualification", normalizeDialectFunction: false }),
      time: this.canonicalAst(record.having, { stripColumnTable: patchKind === "identifier_qualification", normalizeDialectFunction: false }),
      sort_limit: this.canonicalAst([record.orderby, record.limit], { stripColumnTable: patchKind === "identifier_qualification", normalizeDialectFunction: false })
    };
  }

  private projectionShape(value: unknown): unknown {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map((item) => {
      const record = this.asRecord(item) ?? {};
      const expr = this.asRecord(record.expr) ?? {};
      return { as: this.readString(record.as)?.toLowerCase(), type: expr.type };
    });
  }

  private canonicalAst(
    value: unknown,
    options: { stripColumnTable: boolean; normalizeDialectFunction: boolean }
  ): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.canonicalAst(item, options));
    }
    const record = this.asRecord(value);
    if (!record) {
      return typeof value === "string" ? value.toLowerCase() : value;
    }
    if (options.normalizeDialectFunction && record.type === "function") {
      const columnRefs: unknown[] = [];
      this.walk(record.args, (item) => {
        if (item.type === "column_ref") {
          columnRefs.push(
            this.canonicalAst(item, {
              stripColumnTable: false,
              normalizeDialectFunction: false
            })
          );
        }
      });
      return {
        type: "function",
        name: "__dialect_equivalent__",
        columnRefs
      };
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (options.stripColumnTable && record.type === "column_ref" && key === "table") {
        continue;
      }
      if (options.normalizeDialectFunction && key === "name" && record.type === "function") {
        result[key] = "__dialect_equivalent__";
        continue;
      }
      if (
        options.normalizeDialectFunction &&
        record.type === "single_quote_string" &&
        key === "value" &&
        ["%y", "yyyy", "%y-%m-01", "month"].includes(String(record[key]).toLowerCase())
      ) {
        result[key] = "__dialect_time_format__";
        continue;
      }
      result[key] = this.canonicalAst(record[key], options);
    }
    return result;
  }

  private collectAliasByTable(ast: unknown): Map<string, string> {
    const result = new Map<string, string>();
    this.walk(ast, (record) => {
      const table = this.readString(record.table)?.toLowerCase();
      const alias = this.readString(record.as)?.toLowerCase();
      if (table && alias) {
        result.set(table, alias);
      }
    });
    return result;
  }

  private collectNodeValues(ast: unknown, type: string, key: string): string[] {
    const values: string[] = [];
    this.walk(ast, (record) => {
      if (record.type === type) {
        const value = this.readString(record[key]);
        if (value) {
          values.push(value.toLowerCase());
        }
      }
    });
    return values.sort();
  }

  private walk(value: unknown, visit: (record: Record<string, unknown>) => void): void {
    const stack: unknown[] = [value];
    while (stack.length > 0) {
      const current = stack.pop();
      if (Array.isArray(current)) {
        stack.push(...current);
        continue;
      }
      const record = this.asRecord(current);
      if (!record) {
        continue;
      }
      visit(record);
      stack.push(...Object.values(record));
    }
  }

  private readColumnName(value: unknown): string | undefined {
    const direct = this.readString(value);
    if (direct) {
      return direct;
    }
    const record = this.asRecord(value);
    const expr = this.asRecord(record?.expr);
    return this.readString(expr?.value);
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private readString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }

  private hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }
}
