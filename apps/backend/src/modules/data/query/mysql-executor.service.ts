import { Injectable } from "@nestjs/common";
import type { Datasource } from "@text2sql/shared-types";
import { DomainError } from "../../../common/domain-error";
import { decryptSecret } from "../../../common/secret-crypto";
import { AppConfigService } from "../../config/app-config.service";
import type { QueryExecutionResult, QueryExecutor } from "./query-executor.interface";

interface MysqlModuleLike {
  createConnection: (config: Record<string, unknown>) => Promise<{
    query: (
      sql:
        | string
        | {
            sql: string;
            timeout: number;
          }
    ) => Promise<[unknown, Array<{ name?: string }>]>
    end: () => Promise<void>;
  }>;
}

@Injectable()
export class MysqlExecutorService implements QueryExecutor {
  readonly type = "mysql" as const;

  constructor(private readonly appConfig: AppConfigService) {}

  async execute(input: {
    datasource: Datasource;
    sql: string;
  }): Promise<QueryExecutionResult> {
    const mysql = await this.loadMysqlModule();
    const config = this.requireConnectionConfig(input.datasource);

    const connection = await mysql.createConnection({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      connectTimeout: this.appConfig.datasourceConnectTimeoutMs
    });

    try {
      const [rowsRaw, fields] = await connection.query({
        sql: input.sql,
        timeout: this.appConfig.datasourceQueryTimeoutMs
      });
      const rows = Array.isArray(rowsRaw)
        ? (rowsRaw as Array<Record<string, unknown>>)
        : [];
      const columns = fields?.map((field) => field.name ?? "")?.filter(Boolean) ?? [];

      return {
        columns,
        rows
      };
    } catch (error) {
      throw new DomainError(
        "SQL_EXECUTION_ERROR",
        `MySQL 查询失败: ${error instanceof Error ? error.message : String(error)}`,
        400,
        {
          datasourceId: input.datasource.id
        }
      );
    } finally {
      await connection.end().catch(() => undefined);
    }
  }

  private async loadMysqlModule(): Promise<MysqlModuleLike> {
    try {
      const dynamicImport = new Function(
        "modulePath",
        "return import(modulePath);"
      ) as (modulePath: string) => Promise<unknown>;
      const mod = (await dynamicImport("mysql2/promise")) as MysqlModuleLike;
      return mod;
    } catch {
      throw new DomainError(
        "DATASOURCE_DRIVER_MISSING",
        "当前环境缺少 mysql2 依赖，无法执行 MySQL 查询。",
        500
      );
    }
  }

  private requireConnectionConfig(datasource: Datasource): {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
  } {
    const config = datasource.config ?? {};
    const host = typeof config.host === "string" ? config.host : "";
    const database = typeof config.database === "string" ? config.database : "";
    const username = typeof config.username === "string" ? config.username : "";
    const passwordCiphertext =
      typeof config.passwordCiphertext === "string" ? config.passwordCiphertext : "";
    const password =
      typeof config.password === "string"
        ? config.password
        : passwordCiphertext
          ? this.decryptPassword(passwordCiphertext)
          : "";
    const port =
      typeof config.port === "number"
        ? config.port
        : typeof config.port === "string"
          ? Number(config.port)
          : 3306;

    if (!host || !database || !username || !password || !Number.isFinite(port)) {
      throw new DomainError("DATASOURCE_CONFIG_INVALID", "MySQL 数据源配置不完整", 400, {
        datasourceId: datasource.id
      });
    }

    return {
      host,
      port,
      database,
      username,
      password
    };
  }

  private decryptPassword(passwordCiphertext: string): string {
    try {
      return decryptSecret(passwordCiphertext, this.appConfig.datasourceSecretKey);
    } catch {
      throw new DomainError(
        "DATASOURCE_CONFIG_INVALID",
        "MySQL 数据源凭据解密失败，请重新配置连接。",
        400
      );
    }
  }
}
