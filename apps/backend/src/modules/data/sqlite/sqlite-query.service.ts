import { Injectable } from "@nestjs/common";
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { promisify } from "node:util";
import { AppConfigService } from "../../config/app-config.service";
import { DomainError } from "../../../common/domain-error";

const execFileAsync = promisify(execFile);
const MAX_QUERY_ROWS = 200;
const READONLY_FORBIDDEN_KEYWORDS = [
  "insert",
  "update",
  "delete",
  "drop",
  "alter",
  "truncate",
  "create",
  "replace",
  "pragma",
  "attach",
  "detach"
] as const;

@Injectable()
export class SqliteQueryService {
  constructor(private readonly appConfig: AppConfigService) {}

  get dbPath(): string {
    return this.appConfig.sqlitePath;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await access(this.dbPath, fsConstants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  async query(
    sql: string,
    options?: {
      filePath?: string;
    }
  ): Promise<{
    columns: string[];
    rows: Array<Record<string, unknown>>;
  }> {
    const safeSql = this.ensureSelectQuery(sql);
    const finalSql = this.withLimit(safeSql);
    const dbPath = options?.filePath?.trim() || this.dbPath;
    try {
      const { stdout, stderr } = await execFileAsync("sqlite3", [
        "-json",
        dbPath,
        finalSql
      ]);
      if (stderr?.trim()) {
        throw new DomainError("SQL_EXECUTION_ERROR", stderr.trim(), 400);
      }
      const rows = stdout.trim()
        ? (JSON.parse(stdout) as Array<Record<string, unknown>>)
        : [];
      const columns = rows[0] ? Object.keys(rows[0]) : [];
      return { columns, rows };
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }
      throw new DomainError(
        "SQL_EXECUTION_ERROR",
        "SQLite 查询执行失败",
        400,
        {
          dbPath,
          originalMessage: error instanceof Error ? error.message : String(error)
        }
      );
    }
  }

  private withLimit(sql: string): string {
    if (/\blimit\s+\d+\b/i.test(sql)) {
      return sql;
    }
    return `${sql.replace(/;+\s*$/, "")} LIMIT ${MAX_QUERY_ROWS};`;
  }

  private ensureSelectQuery(sql: string): string {
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
    for (const keyword of READONLY_FORBIDDEN_KEYWORDS) {
      if (new RegExp(`\\b${keyword}\\b`, "i").test(statementWithoutTailSemicolon)) {
        throw new DomainError(
          "SQL_READONLY_REJECTED",
          `检测到受限关键字 ${keyword.toUpperCase()}，只允许只读查询。`,
          400,
          { sql }
        );
      }
    }
    if (!/^\s*(select\b|with\b)/i.test(normalized)) {
      throw new DomainError(
        "SQL_READONLY_REJECTED",
        "只允许执行 SELECT 或 WITH ... SELECT 的只读查询。",
        400,
        { sql }
      );
    }
    return normalized;
  }
}
