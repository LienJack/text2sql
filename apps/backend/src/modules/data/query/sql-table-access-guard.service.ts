import { Injectable } from "@nestjs/common";
import { DomainError } from "../../../common/domain-error";
import { RowFilterRewriteService } from "./row-filter-rewrite.service";

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

const IDENTIFIER_SEGMENT =
  '(?:"(?:[^"]|"")+"|`(?:[^`]|``)+`|\\[(?:[^\\]]|\\]\\])+\\]|[A-Za-z_][A-Za-z0-9_$]*)';

export interface SqlTableAccessContext {
  actorId: string;
  workspaceId: string;
  roleSet?: string[];
  enforcementMode?: "off" | "shadow" | "enforce";
  allowedTables?: string[];
  allowedColumnsByTable?: Record<string, string[]>;
  rowFiltersByTable?: Record<string, string>;
  evaluatorMode?: "workspace_table_permissions";
}

export interface SqlPolicyLookupRequest {
  actorId: string;
  workspaceId: string;
  datasourceId: string;
  roleSet: string[];
}

export type SqlPolicyLookupResolver = (
  request: SqlPolicyLookupRequest
) => Promise<Iterable<string> | null | undefined>;

export interface SqlTableAccessCheckInput {
  sql: string;
  datasourceId: string;
  accessContext?: SqlTableAccessContext;
  allowedTables?: Iterable<string>;
  resolveAllowedTables?: SqlPolicyLookupResolver;
}

export interface SqlTableExtractResult {
  complete: boolean;
  tables: string[];
  reason?: string;
}

export interface SqlTableGuardResult {
  sql: string;
  referencedTables: string[];
  rowFilterApplied: boolean;
  columnHookTriggered: boolean;
}

@Injectable()
export class SqlTableAccessGuardService {
  constructor(
    private readonly rowFilterRewriteService: RowFilterRewriteService = new RowFilterRewriteService()
  ) {}

  assertReadOnlySql(sql: string): void {
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

  extractReferencedTables(sql: string): SqlTableExtractResult {
    const stripped = this.stripCommentsAndStringLiterals(sql);
    const fromJoinPattern = /\b(from|join)\b/gi;
    const derivedFromPattern = /\b(from|join)\s*\(/i;
    const tableRefPattern = new RegExp(
      `\\b(from|join)\\b\\s*(${IDENTIFIER_SEGMENT}(?:\\s*\\.\\s*${IDENTIFIER_SEGMENT})*)`,
      "gi"
    );

    if (derivedFromPattern.test(stripped)) {
      return {
        complete: false,
        tables: [],
        reason: "检测到子查询或派生表 FROM/JOIN 语法，当前保守解析策略无法穷尽引用表。"
      };
    }

    const cteNames = this.extractCteNames(stripped);
    const allFromJoinKeywords = stripped.match(fromJoinPattern)?.length ?? 0;
    const tables = new Set<string>();
    let parsedFromJoinCount = 0;
    let match: RegExpExecArray | null;
    while ((match = tableRefPattern.exec(stripped)) !== null) {
      parsedFromJoinCount += 1;
      const tableRef = this.normalizeIdentifierChain(match[2] ?? "");
      if (!tableRef) {
        continue;
      }
      const lastSegment = this.getLastSegment(tableRef);
      if (cteNames.has(tableRef) || (lastSegment && cteNames.has(lastSegment))) {
        continue;
      }
      tables.add(tableRef);
    }

    if (parsedFromJoinCount < allFromJoinKeywords) {
      return {
        complete: false,
        tables: [],
        reason: "检测到无法完整解析的 FROM/JOIN 片段，已按 fail-closed 策略拒绝。"
      };
    }

    return {
      complete: true,
      tables: Array.from(tables.values())
    };
  }

  async assertTableAccess(input: SqlTableAccessCheckInput): Promise<SqlTableGuardResult> {
    const accessContext = input.accessContext;
    if (!accessContext || accessContext.enforcementMode === "off") {
      return {
        sql: input.sql,
        referencedTables: [],
        rowFilterApplied: false,
        columnHookTriggered: false
      };
    }

    const extraction = this.extractReferencedTables(input.sql);
    if (!extraction.complete) {
      throw new DomainError(
        "TABLE_PERMISSIONS_PARSE_REJECTED",
        extraction.reason ?? "无法确定 SQL 引用表集合，已拒绝执行。",
        400,
        {
          datasourceId: input.datasourceId,
          workspaceId: accessContext.workspaceId
        }
      );
    }

    if (extraction.tables.length === 0) {
      return {
        sql: input.sql,
        referencedTables: [],
        rowFilterApplied: false,
        columnHookTriggered: false
      };
    }

    const allowed = this.toNormalizedTableSet(
      input.allowedTables ?? accessContext.allowedTables
    );

    if (allowed.size === 0 && input.resolveAllowedTables) {
      const lookedUp = await input.resolveAllowedTables({
        actorId: accessContext.actorId,
        workspaceId: accessContext.workspaceId,
        datasourceId: input.datasourceId,
        roleSet: accessContext.roleSet ?? []
      });
      for (const table of lookedUp ?? []) {
        const normalized = this.normalizeIdentifierChain(String(table ?? ""));
        if (normalized) {
          allowed.add(normalized);
        }
      }
    }

    if (allowed.size === 0) {
      throw new DomainError(
        "TABLE_PERMISSIONS_FORBIDDEN",
        "当前工作空间未配置可用表授权策略，已拒绝执行。",
        403,
        {
          datasourceId: input.datasourceId,
          workspaceId: accessContext.workspaceId,
          actorId: accessContext.actorId,
          reason: "policy_unavailable"
        }
      );
    }

    const forbiddenTables = extraction.tables.filter((table) =>
      !this.isTableAllowed(table, allowed)
    );

    if (forbiddenTables.length > 0) {
      throw new DomainError(
        "TABLE_PERMISSIONS_FORBIDDEN",
        `当前工作空间无权访问表: ${forbiddenTables.join(", ")}`,
        403,
        {
          datasourceId: input.datasourceId,
          workspaceId: accessContext.workspaceId,
          actorId: accessContext.actorId,
          tables: forbiddenTables
        }
      );
    }

    const columnHookTriggered = this.hasColumnPolicyHook({
      sql: input.sql,
      referencedTables: extraction.tables,
      allowedColumnsByTable: accessContext.allowedColumnsByTable
    });
    if (columnHookTriggered && this.containsWildcardProjection(input.sql)) {
      throw new DomainError(
        "TABLE_PERMISSIONS_PARSE_REJECTED",
        "检测到列级权限策略与通配符查询组合，当前改写策略无法安全裁剪列集合。",
        400,
        {
          datasourceId: input.datasourceId,
          workspaceId: accessContext.workspaceId
        }
      );
    }

    const rowFilterRewrite = this.rowFilterRewriteService.rewrite({
      sql: input.sql,
      referencedTables: extraction.tables,
      rowFiltersByTable: accessContext.rowFiltersByTable
    });
    if (!rowFilterRewrite.ok) {
      throw new DomainError(
        "TABLE_PERMISSIONS_PARSE_REJECTED",
        rowFilterRewrite.reason,
        400,
        {
          datasourceId: input.datasourceId,
          workspaceId: accessContext.workspaceId
        }
      );
    }

    return {
      sql: rowFilterRewrite.sql,
      referencedTables: extraction.tables,
      rowFilterApplied: rowFilterRewrite.rewritten,
      columnHookTriggered
    };
  }

  private toNormalizedTableSet(input?: Iterable<string>): Set<string> {
    const normalized = new Set<string>();
    for (const table of input ?? []) {
      const value = this.normalizeIdentifierChain(String(table ?? ""));
      if (value) {
        normalized.add(value);
      }
    }
    return normalized;
  }

  private isTableAllowed(table: string, allowSet: Set<string>): boolean {
    if (allowSet.has(table)) {
      return true;
    }
    const lastSegment = this.getLastSegment(table);
    if (!lastSegment) {
      return false;
    }
    return allowSet.has(lastSegment);
  }

  private hasColumnPolicyHook(input: {
    sql: string;
    referencedTables: string[];
    allowedColumnsByTable?: Record<string, string[]>;
  }): boolean {
    if (!input.allowedColumnsByTable) {
      return false;
    }
    return input.referencedTables.some((table) => {
      const normalized = table.trim().toLowerCase();
      const lastSegment = this.getLastSegment(normalized);
      const columns =
        input.allowedColumnsByTable?.[normalized] ??
        (lastSegment ? input.allowedColumnsByTable?.[lastSegment] : undefined);
      return Array.isArray(columns) && columns.length > 0;
    });
  }

  private containsWildcardProjection(sql: string): boolean {
    const normalized = this.stripCommentsAndStringLiterals(sql);
    return /\bselect\s+[\s\S]*\*/i.test(normalized);
  }

  private getLastSegment(table: string): string | undefined {
    const parts = table.split(".").filter(Boolean);
    return parts.at(-1);
  }

  private stripCommentsAndStringLiterals(sql: string): string {
    return sql
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/--[^\n\r]*/g, " ")
      .replace(/'(?:''|[^'])*'/g, "''");
  }

  private extractCteNames(sql: string): Set<string> {
    const names = new Set<string>();
    let cursor = this.skipWhitespace(sql, 0);
    if (!this.matchesKeyword(sql, cursor, "with")) {
      return names;
    }
    cursor += "with".length;
    cursor = this.skipWhitespace(sql, cursor);
    if (this.matchesKeyword(sql, cursor, "recursive")) {
      cursor += "recursive".length;
    }

    while (cursor < sql.length) {
      cursor = this.skipWhitespace(sql, cursor);
      const identifier = this.readIdentifier(sql, cursor);
      if (!identifier) {
        return names;
      }
      names.add(identifier.normalized);
      cursor = this.skipWhitespace(sql, identifier.next);

      if (sql[cursor] === "(") {
        const next = this.skipBalancedParentheses(sql, cursor);
        if (next === -1) {
          return names;
        }
        cursor = this.skipWhitespace(sql, next);
      }

      if (!this.matchesKeyword(sql, cursor, "as")) {
        return names;
      }
      cursor += "as".length;
      cursor = this.skipWhitespace(sql, cursor);
      if (sql[cursor] !== "(") {
        return names;
      }
      const next = this.skipBalancedParentheses(sql, cursor);
      if (next === -1) {
        return names;
      }
      cursor = this.skipWhitespace(sql, next);
      if (sql[cursor] !== ",") {
        break;
      }
      cursor += 1;
    }

    return names;
  }

  private normalizeIdentifierChain(raw: string): string {
    const segments: string[] = [];
    let cursor = this.skipWhitespace(raw, 0);
    while (cursor < raw.length) {
      const identifier = this.readIdentifier(raw, cursor);
      if (!identifier) {
        return "";
      }
      segments.push(identifier.normalized);
      cursor = this.skipWhitespace(raw, identifier.next);
      if (cursor >= raw.length) {
        break;
      }
      if (raw[cursor] !== ".") {
        return "";
      }
      cursor = this.skipWhitespace(raw, cursor + 1);
    }
    return segments.join(".");
  }

  private readIdentifier(
    source: string,
    index: number
  ): { normalized: string; next: number } | null {
    const cursor = this.skipWhitespace(source, index);
    const start = source[cursor];
    if (!start) {
      return null;
    }
    if (start === '"' || start === "`" || start === "[") {
      const end = this.findClosingQuote(source, cursor, start);
      if (end === -1) {
        return null;
      }
      const raw = source.slice(cursor, end + 1);
      return {
        normalized: this.normalizeIdentifierSegment(raw),
        next: end + 1
      };
    }
    const bare = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(source.slice(cursor));
    if (!bare) {
      return null;
    }
    return {
      normalized: bare[0].toLowerCase(),
      next: cursor + bare[0].length
    };
  }

  private normalizeIdentifierSegment(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed.slice(1, -1).replace(/""/g, '"').toLowerCase();
    }
    if (trimmed.startsWith("`") && trimmed.endsWith("`")) {
      return trimmed.slice(1, -1).replace(/``/g, "`").toLowerCase();
    }
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      return trimmed.slice(1, -1).replace(/]]/g, "]").toLowerCase();
    }
    return trimmed.toLowerCase();
  }

  private findClosingQuote(
    source: string,
    index: number,
    opener: '"' | "`" | "["
  ): number {
    const closer = opener === "[" ? "]" : opener;
    let cursor = index + 1;
    while (cursor < source.length) {
      const char = source[cursor];
      if (char === closer) {
        const nextChar = source[cursor + 1];
        if (nextChar === closer && closer !== "]") {
          cursor += 2;
          continue;
        }
        if (nextChar === "]" && closer === "]") {
          cursor += 2;
          continue;
        }
        return cursor;
      }
      cursor += 1;
    }
    return -1;
  }

  private skipBalancedParentheses(source: string, openIndex: number): number {
    if (source[openIndex] !== "(") {
      return -1;
    }
    let depth = 0;
    let cursor = openIndex;
    while (cursor < source.length) {
      const char = source[cursor];
      if (char === "(") {
        depth += 1;
        cursor += 1;
        continue;
      }
      if (char === ")") {
        depth -= 1;
        cursor += 1;
        if (depth === 0) {
          return cursor;
        }
        continue;
      }
      if (char === '"' || char === "`" || char === "[") {
        const next = this.findClosingQuote(source, cursor, char);
        if (next === -1) {
          return -1;
        }
        cursor = next + 1;
        continue;
      }
      cursor += 1;
    }
    return -1;
  }

  private skipWhitespace(source: string, cursor: number): number {
    let index = cursor;
    while (index < source.length && /\s/.test(source[index] ?? "")) {
      index += 1;
    }
    return index;
  }

  private matchesKeyword(source: string, index: number, keyword: string): boolean {
    const segment = source.slice(index, index + keyword.length);
    if (segment.toLowerCase() !== keyword) {
      return false;
    }
    const before = index === 0 ? "" : source[index - 1] ?? "";
    const after = source[index + keyword.length] ?? "";
    if (/[A-Za-z0-9_$]/.test(before)) {
      return false;
    }
    if (/[A-Za-z0-9_$]/.test(after)) {
      return false;
    }
    return true;
  }
}
