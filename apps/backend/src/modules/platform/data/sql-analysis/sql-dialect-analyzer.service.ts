import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { DatasourceType } from "@text2sql/shared-types";
import { Parser } from "node-sql-parser";
import type {
  SqlAnalysisBudget,
  SqlAnalysisColumnReference,
  SqlAnalysisDiagnostic,
  SqlAnalysisResult,
  SqlAnalysisTableReference,
  SupportedSqlDialect
} from "./sql-analysis.types";

const DEFAULT_BUDGET: SqlAnalysisBudget = {
  maxSqlBytes: 64 * 1024,
  maxStatements: 1,
  maxAstDepth: 64,
  maxAstNodes: 20_000,
  maxLineageEntries: 2_000
};

const DIALECTS: Partial<Record<DatasourceType, { dialect: SupportedSqlDialect; parser: string }>> = {
  sqlite: { dialect: "sqlite", parser: "SQLite" },
  mysql: { dialect: "mysql", parser: "MySQL" },
  postgresql: { dialect: "postgresql", parser: "Postgresql" }
};

const DANGEROUS_FUNCTIONS = new Set([
  "pg_read_file",
  "pg_ls_dir",
  "dblink",
  "load_file",
  "sleep",
  "benchmark"
]);

const UNSUPPORTED_FUNCTIONS: Partial<Record<SupportedSqlDialect, Set<string>>> = {
  sqlite: new Set(["date_trunc"]),
  mysql: new Set(["strftime", "date_trunc"]),
  postgresql: new Set(["strftime"])
};

@Injectable()
export class SqlDialectAnalyzerService {
  private readonly parser = new Parser();

  analyze(input: {
    sql: string;
    datasourceType: DatasourceType;
    budget?: Partial<SqlAnalysisBudget>;
  }): SqlAnalysisResult {
    const budget = { ...DEFAULT_BUDGET, ...input.budget };
    const normalizedSqlDigest = this.hash(this.normalizeSqlForDigest(input.sql));
    const dialect = DIALECTS[input.datasourceType];
    const unavailable = (diagnostic: SqlAnalysisDiagnostic): SqlAnalysisResult =>
      this.emptyResult({
        datasourceType: input.datasourceType,
        dialect: dialect?.dialect,
        normalizedSqlDigest,
        status: "unavailable",
        diagnostics: [diagnostic]
      });
    const failed = (diagnostic: SqlAnalysisDiagnostic): SqlAnalysisResult =>
      this.emptyResult({
        datasourceType: input.datasourceType,
        dialect: dialect?.dialect,
        normalizedSqlDigest,
        status: "failed",
        diagnostics: [diagnostic]
      });

    if (!dialect) {
      return unavailable({
        code: "SQL_ANALYSIS_DIALECT_UNAVAILABLE",
        category: "capability",
        message: `SQL AST analysis is unavailable for datasource type ${input.datasourceType}.`
      });
    }

    const sqlBytes = Buffer.byteLength(input.sql, "utf8");
    if (sqlBytes === 0) {
      return failed({
        code: "SQL_ANALYSIS_EMPTY",
        category: "parse",
        message: "SQL is empty."
      });
    }
    if (sqlBytes > budget.maxSqlBytes) {
      return failed({
        code: "SQL_ANALYSIS_SQL_BYTES_EXCEEDED",
        category: "resource",
        message: "SQL exceeds the structural analysis byte budget."
      });
    }
    if (this.countPotentialStatements(input.sql) > budget.maxStatements) {
      return failed({
        code: "SQL_ANALYSIS_STATEMENT_BUDGET_EXCEEDED",
        category: "structural",
        message: "Only one SQL statement is allowed."
      });
    }

    try {
      const sqlForParser =
        dialect.dialect === "sqlite"
          ? input.sql.replace(/\bover\s*\(\s*\)/gi, "OVER (PARTITION BY 1)")
          : input.sql;
      const parsed = this.parser.parse(sqlForParser, { database: dialect.parser });
      const astStatements = Array.isArray(parsed.ast) ? parsed.ast : [parsed.ast];
      if (astStatements.length > budget.maxStatements) {
        return failed({
          code: "SQL_ANALYSIS_STATEMENT_BUDGET_EXCEEDED",
          category: "structural",
          message: "Only one SQL statement is allowed."
        });
      }
      const astShape = this.measureAst(astStatements);
      if (astShape.depth > budget.maxAstDepth) {
        return failed({
          code: "SQL_ANALYSIS_AST_DEPTH_EXCEEDED",
          category: "resource",
          message: "SQL AST exceeds the depth budget."
        });
      }
      if (astShape.nodes > budget.maxAstNodes) {
        return failed({
          code: "SQL_ANALYSIS_AST_NODES_EXCEEDED",
          category: "resource",
          message: "SQL AST exceeds the node budget."
        });
      }

      const cteNames = this.collectCteNames(astStatements);
      const tables = this.parseTables(parsed.tableList).filter(
        (table) => !cteNames.has(table.normalizedName.split(".").at(-1) ?? "")
      );
      const projectionAliases = this.collectProjectionAliases(astStatements);
      const columns = this.parseColumns(parsed.columnList).filter(
        (column) => column.table || !projectionAliases.has(column.name)
      );
      const functions = this.collectFunctions(astStatements);
      const lineage = {
        ctes: this.collectCteLineage(astStatements, tables, budget.maxLineageEntries),
        aliases: this.collectAliases(astStatements),
        subqueryCount: this.countSubqueries(astStatements)
      };
      const lineageEntries =
        lineage.ctes.reduce((count, cte) => count + 1 + cte.sourceTables.length, 0) +
        Object.keys(lineage.aliases).length +
        lineage.subqueryCount;
      if (lineageEntries > budget.maxLineageEntries) {
        return failed({
          code: "SQL_ANALYSIS_LINEAGE_BUDGET_EXCEEDED",
          category: "resource",
          message: "SQL lineage exceeds the expansion budget."
        });
      }

      const statementTypes = astStatements.map((statement) =>
        this.readString(this.asRecord(statement)?.type)?.toLowerCase() ?? "unknown"
      );
      const diagnostics: SqlAnalysisDiagnostic[] = [];
      const lockDetected = this.containsKeyValue(astStatements, (key, value) =>
        ["lock", "locking_read", "for_update", "for_share", "into"].includes(key) &&
        this.hasMeaningfulAstValue(value)
      );
      const dangerousFunctions = functions.filter((name) => DANGEROUS_FUNCTIONS.has(name));
      const unsupportedFunctions = functions.filter((name) =>
        UNSUPPORTED_FUNCTIONS[dialect.dialect]?.has(name)
      );
      const readOnly =
        statementTypes.length === 1 &&
        statementTypes[0] === "select" &&
        !lockDetected &&
        dangerousFunctions.length === 0;
      if (!readOnly) {
        diagnostics.push({
          code: dangerousFunctions.length > 0
            ? "SQL_ANALYSIS_DANGEROUS_FUNCTION"
            : lockDetected
              ? "SQL_ANALYSIS_LOCKING_OR_SELECT_INTO"
              : "SQL_ANALYSIS_NOT_READ_ONLY",
          category: "read_only",
          message: "SQL AST cannot be proven read-only."
        });
      }
      if (unsupportedFunctions.length > 0) {
        diagnostics.push({
          code: "SQL_ANALYSIS_DIALECT_FUNCTION_UNSUPPORTED",
          category: "capability",
          message: "SQL uses a function outside the supported target-dialect subset."
        });
      }

      return {
        version: "sql-analysis.v1",
        status: diagnostics.length > 0 ? "failed" : "ready",
        datasourceType: input.datasourceType,
        dialect: dialect.dialect,
        normalizedSqlDigest,
        statementCount: astStatements.length,
        statementTypes,
        readOnly,
        tables: this.uniqueBy(tables, (table) => table.normalizedName),
        columns: this.uniqueBy(columns, (column) => column.normalizedName),
        functions,
        wildcards: columns.filter((column) => column.wildcard).map((column) => column.normalizedName),
        parameters: this.collectParameters(astStatements),
        lineage,
        ast: parsed.ast,
        astNodeCount: astShape.nodes,
        astDepth: astShape.depth,
        diagnostics
      };
    } catch {
      return failed({
        code: "SQL_ANALYSIS_PARSE_FAILED",
        category: "parse",
        message: `SQL could not be parsed as ${dialect.dialect}.`
      });
    }
  }

  assertReady(result: SqlAnalysisResult): asserts result is SqlAnalysisResult & { status: "ready" } {
    if (result.status !== "ready" || !result.readOnly) {
      const code = result.diagnostics[0]?.code ?? "SQL_ANALYSIS_UNAVAILABLE";
      throw new Error(code);
    }
  }

  private emptyResult(input: {
    datasourceType: DatasourceType;
    dialect?: SupportedSqlDialect;
    normalizedSqlDigest: string;
    status: "failed" | "unavailable";
    diagnostics: SqlAnalysisDiagnostic[];
  }): SqlAnalysisResult {
    return {
      version: "sql-analysis.v1",
      ...input,
      statementCount: 0,
      statementTypes: [],
      readOnly: false,
      tables: [],
      columns: [],
      functions: [],
      wildcards: [],
      parameters: [],
      lineage: { ctes: [], aliases: {}, subqueryCount: 0 },
      ast: undefined,
      astNodeCount: 0,
      astDepth: 0
    };
  }

  private parseTables(values: string[]): SqlAnalysisTableReference[] {
    return values.map((value) => {
      const [, namespace, tableName] = value.split("::");
      const namespaceParts = (namespace && namespace !== "null" ? namespace : "")
        .split(".")
        .filter(Boolean);
      const name = tableName ?? "";
      const qualified = [...namespaceParts, name].filter(Boolean).join(".");
      return {
        name,
        normalizedName: this.normalizeIdentifier(qualified),
        ...(namespaceParts.length > 1 ? { catalog: namespaceParts[0] } : {}),
        ...(namespaceParts.length > 0 ? { schema: namespaceParts.at(-1) } : {})
      };
    }).filter((table) => table.normalizedName.length > 0);
  }

  private parseColumns(values: string[]): SqlAnalysisColumnReference[] {
    return values.map((value) => {
      const [, tableName, columnName] = value.split("::");
      const table = tableName && tableName !== "null" ? tableName : undefined;
      const name = columnName === "(.*)" ? "*" : columnName ?? "";
      return {
        ...(table ? { table: this.normalizeIdentifier(table) } : {}),
        name: this.normalizeIdentifier(name),
        normalizedName: this.normalizeIdentifier(table ? `${table}.${name}` : name),
        wildcard: name === "*"
      };
    }).filter((column) => column.normalizedName.length > 0);
  }

  private collectCteNames(root: unknown): Set<string> {
    const names = new Set<string>();
    this.walk(root, (record) => {
      const statement = this.asRecord(record.stmt);
      if (!statement || !("ast" in statement)) {
        return;
      }
      const nameRecord = this.asRecord(record.name);
      const name = this.readString(nameRecord?.value ?? record.name);
      if (name) {
        names.add(this.normalizeIdentifier(name));
      }
    });
    return names;
  }

  private collectCteLineage(
    root: unknown,
    _tables: SqlAnalysisTableReference[],
    maxEntries: number
  ): Array<{ name: string; sourceTables: string[] }> {
    const lineage: Array<{ name: string; sourceTables: string[] }> = [];
    this.walk(root, (record) => {
      if (lineage.length >= maxEntries) {
        return;
      }
      const statement = this.asRecord(record.stmt);
      const name = this.flattenName(record.name);
      if (!statement || !("ast" in statement) || !name) {
        return;
      }
      const tableList = Array.isArray(statement.tableList)
        ? statement.tableList.filter((value): value is string => typeof value === "string")
        : [];
      lineage.push({
        name: this.normalizeIdentifier(name),
        sourceTables: this.parseTables(tableList)
          .map((table) => table.normalizedName)
          .slice(0, maxEntries)
      });
    });
    return lineage;
  }

  private collectAliases(root: unknown): Record<string, string> {
    const aliases: Record<string, string> = {};
    this.walk(root, (record) => {
      const table = this.readString(record.table);
      const alias = this.readString(record.as);
      if (table && alias) {
        aliases[this.normalizeIdentifier(alias)] = this.normalizeIdentifier(table);
      }
    });
    return aliases;
  }

  private collectProjectionAliases(root: unknown): Set<string> {
    const aliases = new Set<string>();
    this.walk(root, (record) => {
      if (!("expr" in record)) {
        return;
      }
      const alias = this.readString(record.as);
      if (alias) {
        aliases.add(this.normalizeIdentifier(alias));
      }
    });
    return aliases;
  }

  private collectFunctions(root: unknown): string[] {
    const names: string[] = [];
    this.walk(root, (record) => {
      const type = this.readString(record.type)?.toLowerCase();
      if (type !== "function" && type !== "aggr_func") {
        return;
      }
      const name = this.flattenName(record.name);
      if (name) {
        names.push(this.normalizeIdentifier(name));
      }
    });
    return Array.from(new Set(names));
  }

  private collectParameters(root: unknown): string[] {
    const parameters: string[] = [];
    this.walk(root, (record) => {
      const type = this.readString(record.type)?.toLowerCase();
      if (type === "param" || type === "parameter" || type === "var") {
        const value = this.readString(record.value) ?? type;
        parameters.push(value);
      }
    });
    return Array.from(new Set(parameters));
  }

  private countSubqueries(root: unknown): number {
    let count = 0;
    this.walk(root, (record, depth) => {
      if (depth > 1 && this.readString(record.type)?.toLowerCase() === "select") {
        count += 1;
      }
    });
    return Math.max(0, count - 1);
  }

  private measureAst(root: unknown): { nodes: number; depth: number } {
    let nodes = 0;
    let depth = 0;
    this.walk(root, (_record, currentDepth) => {
      nodes += 1;
      depth = Math.max(depth, currentDepth);
    });
    return { nodes, depth };
  }

  private containsKeyValue(
    root: unknown,
    predicate: (key: string, value: unknown) => boolean
  ): boolean {
    let matched = false;
    this.walk(root, (record) => {
      if (matched) {
        return;
      }
      matched = Object.entries(record).some(([key, value]) =>
        predicate(key.toLowerCase(), value)
      );
    });
    return matched;
  }

  private hasMeaningfulAstValue(value: unknown): boolean {
    if (value === null || value === undefined || value === false || value === "") {
      return false;
    }
    if (Array.isArray(value)) {
      return value.some((item) => this.hasMeaningfulAstValue(item));
    }
    const record = this.asRecord(value);
    if (record) {
      return Object.values(record).some((item) => this.hasMeaningfulAstValue(item));
    }
    return true;
  }

  private walk(
    root: unknown,
    visitor: (record: Record<string, unknown>, depth: number) => void
  ): void {
    const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 1 }];
    const seen = new Set<object>();
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || current.value === null || typeof current.value !== "object") {
        continue;
      }
      if (seen.has(current.value)) {
        continue;
      }
      seen.add(current.value);
      if (Array.isArray(current.value)) {
        for (const value of current.value) {
          stack.push({ value, depth: current.depth + 1 });
        }
        continue;
      }
      const record = current.value as Record<string, unknown>;
      visitor(record, current.depth);
      for (const value of Object.values(record)) {
        stack.push({ value, depth: current.depth + 1 });
      }
    }
  }

  private countPotentialStatements(sql: string): number {
    let statements = 0;
    let hasToken = false;
    let quote: "'" | '"' | "`" | undefined;
    for (let index = 0; index < sql.length; index += 1) {
      const char = sql[index];
      const next = sql[index + 1];
      if (quote) {
        if (char === quote && next === quote) {
          index += 1;
        } else if (char === quote) {
          quote = undefined;
        }
        continue;
      }
      if (char === "'" || char === '"' || char === "`") {
        quote = char;
        hasToken = true;
        continue;
      }
      if (char === ";") {
        if (hasToken) {
          statements += 1;
          hasToken = false;
        }
        continue;
      }
      if (!/\s/.test(char ?? "")) {
        hasToken = true;
      }
    }
    return statements + (hasToken ? 1 : 0);
  }

  private flattenName(value: unknown): string | undefined {
    if (typeof value === "string") {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.flattenName(item)).filter(Boolean).join(".");
    }
    const record = this.asRecord(value);
    if (!record) {
      return undefined;
    }
    return this.readString(record.value) ?? this.flattenName(record.name);
  }

  private normalizeSqlForDigest(sql: string): string {
    return sql.trim().replace(/;+\s*$/, "").replace(/\s+/g, " ");
  }

  private normalizeIdentifier(value: string): string {
    return value.replace(/^[`"\[]|[`"\]]$/g, "").trim().toLowerCase();
  }

  private hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private readString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }

  private uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
    const seen = new Set<string>();
    return values.filter((value) => {
      const identity = key(value);
      if (seen.has(identity)) {
        return false;
      }
      seen.add(identity);
      return true;
    });
  }
}
