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
      abortSignal?: AbortSignal;
      timeoutMs?: number;
    }
  ): Promise<{
    columns: string[];
    rows: Array<Record<string, unknown>>;
  }> {
    const safeSql = this.ensureSelectQuery(sql);
    const finalSql = this.withLimit(safeSql);
    const dbPath = options?.filePath?.trim() || this.dbPath;
    try {
      const { stdout, stderr } = await execFileAsync(
        "sqlite3",
        ["-readonly", "-json", "-cmd", "PRAGMA query_only=ON;", dbPath, finalSql],
        {
          timeout: options?.timeoutMs,
          signal: options?.abortSignal,
          maxBuffer: 4 * 1024 * 1024
        }
      );
      if (stderr?.trim()) {
        throw new DomainError("SQL_EXECUTION_ERROR", stderr.trim(), 400);
      }
      const rows = stdout.trim()
        ? (JSON.parse(stdout) as Array<Record<string, unknown>>)
        : [];
      const columns = rows[0] ? Object.keys(rows[0]) : [];
      return { columns, rows };
    } catch (error) {
      throw this.normalizeSqliteError(error, {
        fallbackCode: "SQL_EXECUTION_ERROR",
        fallbackMessage: "SQLite 查询执行失败",
        dbPath
      });
    }
  }

  async dryRun(
    sql: string,
    options?: {
      filePath?: string;
      abortSignal?: AbortSignal;
      timeoutMs?: number;
    }
  ): Promise<void> {
    const safeSql = this.ensureSelectQuery(sql);
    const finalSql = this.withLimit(safeSql);
    const dbPath = options?.filePath?.trim() || this.dbPath;
    try {
      const { stderr } = await execFileAsync(
        "sqlite3",
        ["-readonly", "-cmd", "PRAGMA query_only=ON;", dbPath, `EXPLAIN QUERY PLAN ${finalSql}`],
        {
          timeout: options?.timeoutMs,
          signal: options?.abortSignal,
          maxBuffer: 1024 * 1024
        }
      );
      if (stderr?.trim()) {
        throw new DomainError("SQL_DRY_RUN_FAILED", stderr.trim(), 400);
      }
    } catch (error) {
      throw this.normalizeSqliteError(error, {
        fallbackCode: "SQL_DRY_RUN_FAILED",
        fallbackMessage: "SQLite dry-run 校验失败",
        dbPath
      });
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

  private normalizeSqliteError(
    error: unknown,
    input: {
      fallbackCode: string;
      fallbackMessage: string;
      dbPath: string;
    }
  ): DomainError {
    if (error instanceof DomainError) {
      return error;
    }

    const originalMessage =
      error instanceof Error ? error.message : String(error);
    const normalizedMessage = originalMessage.trim();
    const missingColumnMatch = normalizedMessage.match(
      /no such column:\s*("?)([\w.]+)\1/i
    );
    if (missingColumnMatch) {
      const missingColumn = missingColumnMatch[2];
      return new DomainError(
        "SQL_MISSING_COLUMN",
        `missing column ${missingColumn}`,
        400,
        {
          dbPath: input.dbPath,
          originalMessage: normalizedMessage,
          missingColumn
        }
      );
    }

    return new DomainError(input.fallbackCode, input.fallbackMessage, 400, {
      dbPath: input.dbPath,
      originalMessage: normalizedMessage
    });
  }
}
