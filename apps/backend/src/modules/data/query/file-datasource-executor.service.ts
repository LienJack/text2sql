import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { Injectable } from "@nestjs/common";
import type { Datasource } from "@text2sql/shared-types";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "../../../common/domain-error";
import type { QueryExecutionResult, QueryExecutor } from "./query-executor.interface";

const execFileAsync = promisify(execFile);

interface XlsxModuleLike {
  readFile: (filePath: string) => {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  };
  utils: {
    sheet_to_csv: (sheet: unknown) => string;
  };
}

@Injectable()
export class FileDatasourceExecutorService implements QueryExecutor {
  readonly type = "csv" as const;

  async execute(input: {
    datasource: Datasource;
    sql: string;
    abortSignal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<QueryExecutionResult> {
    if (input.datasource.type === "csv") {
      return this.executeCsvDatasource(input.datasource, input.sql);
    }
    if (input.datasource.type === "excel") {
      return this.executeExcelDatasource(input.datasource, input.sql);
    }

    throw new DomainError("DATASOURCE_TYPE_UNSUPPORTED", "文件数据源类型不受支持", 400, {
      datasourceId: input.datasource.id,
      type: input.datasource.type
    });
  }

  private async executeCsvDatasource(
    datasource: Datasource,
    sql: string
  ): Promise<QueryExecutionResult> {
    const config = this.requireFileConfig(datasource);
    const tableName = this.resolveTableName(datasource);
    const headers = await this.readCsvHeaders(config.path);
    const createTableSql = this.buildCreateTableSql(tableName, headers);

    try {
      const quotedPath = `'${config.path.replace(/'/g, "''")}'`;
      const { stdout, stderr } = await execFileAsync("sqlite3", [
        "-json",
        "-cmd",
        ".mode csv",
        "-cmd",
        createTableSql,
        "-cmd",
        `.import --skip 1 ${quotedPath} ${tableName}`,
        ":memory:",
        sql
      ]);
      if (stderr?.trim()) {
        throw new DomainError("SQL_EXECUTION_ERROR", stderr.trim(), 400, {
          datasourceId: datasource.id
        });
      }

      const rows = stdout.trim()
        ? this.normalizeRows(JSON.parse(stdout))
        : [];
      const columns = rows[0] ? Object.keys(rows[0]) : [];

      return {
        columns,
        rows
      };
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }
      throw new DomainError(
        "SQL_EXECUTION_ERROR",
        `CSV 数据源查询失败: ${error instanceof Error ? error.message : String(error)}`,
        400,
        {
          datasourceId: datasource.id
        }
      );
    }
  }

  private async executeExcelDatasource(
    datasource: Datasource,
    sql: string
  ): Promise<QueryExecutionResult> {
    const config = this.requireFileConfig(datasource);
    const xlsx = await this.loadXlsxModule();

    const workbook = xlsx.readFile(config.path);
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw new DomainError("DATASOURCE_FILE_INVALID", "Excel 文件没有可用工作表", 400, {
        datasourceId: datasource.id
      });
    }

    const sheet = workbook.Sheets[firstSheetName];
    const csvContent = xlsx.utils.sheet_to_csv(sheet);
    const tempCsvPath = join(tmpdir(), `text2sql-excel-${uuidv4()}.csv`);

    await writeFile(tempCsvPath, csvContent, "utf8");
    try {
      const tempDatasource: Datasource = {
        ...datasource,
        type: "csv",
        config: {
          ...(datasource.config ?? {}),
          path: tempCsvPath
        }
      };
      return await this.executeCsvDatasource(tempDatasource, sql);
    } finally {
      await rm(tempCsvPath, { force: true }).catch(() => undefined);
    }
  }

  private async loadXlsxModule(): Promise<XlsxModuleLike> {
    try {
      const dynamicImport = new Function(
        "modulePath",
        "return import(modulePath);"
      ) as (modulePath: string) => Promise<unknown>;
      return (await dynamicImport("xlsx")) as XlsxModuleLike;
    } catch {
      throw new DomainError(
        "DATASOURCE_DRIVER_MISSING",
        "当前环境缺少 xlsx 依赖，无法执行 Excel 数据源查询。",
        500
      );
    }
  }

  private requireFileConfig(datasource: Datasource): { path: string } {
    const path =
      datasource.config && typeof datasource.config.path === "string"
        ? datasource.config.path
        : "";

    if (!path) {
      throw new DomainError("DATASOURCE_CONFIG_INVALID", "文件数据源缺少文件路径", 400, {
        datasourceId: datasource.id
      });
    }

    return { path };
  }

  private resolveTableName(datasource: Datasource): string {
    const configTableName =
      datasource.config && typeof datasource.config.tableName === "string"
        ? datasource.config.tableName
        : "";
    if (configTableName) {
      return configTableName;
    }

    const filePath =
      datasource.config && typeof datasource.config.path === "string"
        ? datasource.config.path
        : "uploaded_data";
    const fromFileName = basename(filePath)
      .replace(/\.[^/.]+$/, "")
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .toLowerCase();
    return fromFileName || "uploaded_data";
  }

  private async readCsvHeaders(filePath: string): Promise<string[]> {
    const content = await readFile(filePath, "utf8");
    const firstLine = content
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/, 1)[0]
      ?.trim();
    if (!firstLine) {
      throw new DomainError("DATASOURCE_FILE_INVALID", "CSV 文件缺少表头", 400);
    }
    return this.normalizeHeaders(this.parseCsvLine(firstLine));
  }

  private parseCsvLine(line: string): string[] {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === "\"") {
        const nextChar = line[index + 1];
        if (inQuotes && nextChar === "\"") {
          current += "\"";
          index += 1;
          continue;
        }
        inQuotes = !inQuotes;
        continue;
      }
      if (char === "," && !inQuotes) {
        values.push(current.trim());
        current = "";
        continue;
      }
      current += char;
    }
    values.push(current.trim());
    return values;
  }

  private normalizeHeaders(headers: string[]): string[] {
    const used = new Set<string>();
    const normalized: string[] = [];
    for (const header of headers) {
      const base =
        header
          .replace(/^["']|["']$/g, "")
          .trim()
          .replace(/[^a-zA-Z0-9_]/g, "_")
          .replace(/_+/g, "_")
          .replace(/^_+|_+$/g, "")
          .toLowerCase() || "column";
      let candidate = base;
      let suffix = 1;
      while (used.has(candidate)) {
        candidate = `${base}_${suffix}`;
        suffix += 1;
      }
      used.add(candidate);
      normalized.push(candidate);
    }
    return normalized;
  }

  private buildCreateTableSql(tableName: string, headers: string[]): string {
    const quotedTableName = this.quoteIdentifier(tableName);
    const columnList = headers
      .map((header) => `${this.quoteIdentifier(header)} TEXT`)
      .join(", ");
    return `CREATE TABLE ${quotedTableName} (${columnList});`;
  }

  private quoteIdentifier(input: string): string {
    return `"${input.replace(/"/g, "\"\"")}"`;
  }

  private normalizeRows(parsed: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(parsed)) {
      return parsed as Array<Record<string, unknown>>;
    }
    if (parsed && typeof parsed === "object") {
      return [parsed as Record<string, unknown>];
    }
    if (
      typeof parsed === "number" ||
      typeof parsed === "string" ||
      typeof parsed === "boolean"
    ) {
      return [{ value: parsed }];
    }
    return [];
  }
}
