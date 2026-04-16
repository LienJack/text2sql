import { Injectable } from "@nestjs/common";
import type { Datasource } from "@text2sql/shared-types";
import { DomainError } from "../../../common/domain-error";
import { decryptSecret } from "../../../common/secret-crypto";
import { AppConfigService } from "../../config/app-config.service";
import type { QueryExecutionResult, QueryExecutor } from "./query-executor.interface";

interface PostgresClientLike {
  connect: () => Promise<void>;
  query: (
    sql: string
  ) => Promise<{ rows: Array<Record<string, unknown>>; fields: Array<{ name: string }> }>;
  end: () => Promise<void>;
}

interface PostgresModuleLike {
  Client: new (config: Record<string, unknown>) => PostgresClientLike;
}

@Injectable()
export class PostgresExecutorService implements QueryExecutor {
  readonly type = "postgresql" as const;

  constructor(private readonly appConfig: AppConfigService) {}

  async execute(input: {
    datasource: Datasource;
    sql: string;
  }): Promise<QueryExecutionResult> {
    const pg = await this.loadPgModule();
    const config = this.requireConnectionConfig(input.datasource);

    const client = new pg.Client({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      database: config.database,
      connectionTimeoutMillis: this.appConfig.datasourceConnectTimeoutMs,
      query_timeout: this.appConfig.datasourceQueryTimeoutMs
    });

    try {
      await client.connect();
      const result = await client.query(input.sql);
      return {
        columns: result.fields.map((field: { name: string }) => field.name),
        rows: result.rows
      };
    } catch (error) {
      throw new DomainError(
        "SQL_EXECUTION_ERROR",
        `PostgreSQL 查询失败: ${error instanceof Error ? error.message : String(error)}`,
        400,
        {
          datasourceId: input.datasource.id
        }
      );
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  private async loadPgModule(): Promise<PostgresModuleLike> {
    try {
      const dynamicImport = new Function(
        "modulePath",
        "return import(modulePath);"
      ) as (modulePath: string) => Promise<unknown>;
      return (await dynamicImport("pg")) as PostgresModuleLike;
    } catch {
      throw new DomainError(
        "DATASOURCE_DRIVER_MISSING",
        "当前环境缺少 pg 依赖，无法执行 PostgreSQL 查询。",
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
          : 5432;

    if (!host || !database || !username || !password || !Number.isFinite(port)) {
      throw new DomainError("DATASOURCE_CONFIG_INVALID", "PostgreSQL 数据源配置不完整", 400, {
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
        "PostgreSQL 数据源凭据解密失败，请重新配置连接。",
        400
      );
    }
  }
}
