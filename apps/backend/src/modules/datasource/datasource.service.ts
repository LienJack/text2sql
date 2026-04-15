import { Injectable } from "@nestjs/common";
import type { Datasource, DatasourceStatus, DatasourceType } from "@text2sql/shared-types";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "../../common/domain-error";
import { encryptSecret } from "../../common/secret-crypto";
import { AppConfigService } from "../config/app-config.service";
import { DatasourceRepository } from "../data/persistence/datasource.repository";

type UploadedFile = {
  originalname: string;
  mimetype: string;
  size: number;
  path: string;
};

type RelationalDatasourceType = "mysql" | "postgresql";

type RelationalConnectionInput = {
  type: RelationalDatasourceType;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
};

type NormalizedRelationalConnection = {
  type: RelationalDatasourceType;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
};

type DriverErrorMeta = {
  code: string;
  errno?: number;
  sqlState: string;
  message: string;
};

interface MysqlPreflightConnection {
  end: () => Promise<void>;
}

interface MysqlPreflightModule {
  createConnection: (config: Record<string, unknown>) => Promise<MysqlPreflightConnection>;
}

interface PostgresPreflightClient {
  connect: () => Promise<void>;
  end: () => Promise<void>;
}

interface PostgresPreflightModule {
  Client: new (config: Record<string, unknown>) => PostgresPreflightClient;
}

@Injectable()
export class DatasourceService {
  constructor(
    private readonly datasourceRepository: DatasourceRepository,
    private readonly appConfig: AppConfigService
  ) {}

  async listDatasources(options?: {
    includeUnavailable?: boolean;
    includeDeleted?: boolean;
  }): Promise<Datasource[]> {
    const includeUnavailable = options?.includeUnavailable ?? true;
    const statuses: DatasourceStatus[] = includeUnavailable
      ? ["available", "unavailable"]
      : ["available"];

    const list = await this.datasourceRepository.listDatasources({
      includeDeleted: options?.includeDeleted ?? false,
      statuses
    });

    return list.map((item) => this.sanitizeDatasource(item));
  }

  async getDatasourceOrThrow(datasourceId: string): Promise<Datasource> {
    let datasource = await this.datasourceRepository.getDatasourceById(datasourceId);
    if (!datasource && datasourceId === "sqlite_main") {
      datasource = await this.datasourceRepository.ensureBaselineSqliteDatasource(
        this.appConfig.sqlitePath
      );
    }
    if (!datasource || datasource.status === "deleted") {
      throw new DomainError("DATASOURCE_NOT_FOUND", "数据源不存在", 404, {
        datasourceId
      });
    }
    return datasource;
  }

  async getDatasourceById(
    datasourceId: string,
    options?: { includeDeleted?: boolean }
  ): Promise<Datasource | undefined> {
    const datasource = await this.datasourceRepository.getDatasourceById(
      datasourceId,
      options
    );
    if (!datasource && datasourceId === "sqlite_main") {
      return this.datasourceRepository.ensureBaselineSqliteDatasource(
        this.appConfig.sqlitePath
      );
    }
    return datasource;
  }

  async createDatasource(input: {
    name: string;
    type: DatasourceType;
    host?: string;
    port?: number;
    database?: string;
    username?: string;
    password?: string;
    filePath?: string;
    shared?: boolean;
  }): Promise<Datasource> {
    const name = input.name.trim();
    if (!name) {
      throw new DomainError("VALIDATION_ERROR", "数据源名称不能为空", 400);
    }

    const normalizedType = input.type;
    if (normalizedType === "mysql" || normalizedType === "postgresql") {
      await this.preflightDatasourceConnection({
        type: normalizedType,
        host: input.host,
        port: input.port,
        database: input.database,
        username: input.username,
        password: input.password
      });
    }

    const config = this.buildConnectionConfig({
      type: normalizedType,
      host: input.host,
      port: input.port,
      database: input.database,
      username: input.username,
      password: input.password,
      filePath: input.filePath
    });

    const datasource = await this.datasourceRepository.upsertDatasource({
      id: `ds-${uuidv4()}`,
      name,
      type: normalizedType,
      status: "available",
      readonly: true,
      shared: input.shared ?? true,
      config
    });

    return this.sanitizeDatasource(datasource);
  }

  async preflightDatasourceConnection(input: RelationalConnectionInput): Promise<void> {
    const normalized = this.normalizeRelationalConnectionInput(input);

    try {
      if (normalized.type === "mysql") {
        await this.preflightMysqlConnection(normalized);
        return;
      }
      await this.preflightPostgresConnection(normalized);
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }
      throw this.mapConnectionPreflightError(normalized, error);
    }
  }

  async createDatasourceFromUpload(input: {
    name?: string;
    uploadedFile: UploadedFile;
  }): Promise<Datasource> {
    const extension = this.fileExtension(input.uploadedFile.originalname);
    const type = extension === "csv" ? "csv" : "excel";
    const normalizedName = input.name?.trim() || this.removeFileExtension(input.uploadedFile.originalname);
    const tableName = this.toSafeTableName(normalizedName);

    if (!normalizedName) {
      throw new DomainError("VALIDATION_ERROR", "上传文件缺少可用名称", 400);
    }

    const datasource = await this.datasourceRepository.upsertDatasource({
      id: `ds-file-${uuidv4()}`,
      name: normalizedName,
      type,
      status: "available",
      readonly: true,
      shared: true,
      config: {
        path: input.uploadedFile.path,
        uploadDir: this.appConfig.datasourceUploadDir,
        tableName
      },
      fileMeta: {
        originalName: input.uploadedFile.originalname,
        mimeType: input.uploadedFile.mimetype,
        size: input.uploadedFile.size,
        uploadedAt: new Date().toISOString()
      }
    });

    return this.sanitizeDatasource(datasource);
  }

  async assertDatasourceAvailable(datasourceId: string): Promise<Datasource> {
    const datasource = await this.getDatasourceOrThrow(datasourceId);
    if (datasource.status !== "available") {
      throw new DomainError(
        "DATASOURCE_UNAVAILABLE",
        "当前会话绑定的数据源不可用，请先重新选择数据源。",
        409,
        {
          datasourceId,
          status: datasource.status
        }
      );
    }
    return datasource;
  }

  private buildConnectionConfig(input: {
    type: DatasourceType;
    host?: string;
    port?: number;
    database?: string;
    username?: string;
    password?: string;
    filePath?: string;
  }): Record<string, unknown> {
    if (input.type === "sqlite") {
      const path = input.filePath?.trim() || this.appConfig.sqlitePath;
      if (!path) {
        throw new DomainError("VALIDATION_ERROR", "SQLite 文件路径不能为空", 400);
      }
      return { path };
    }

    const host = input.host?.trim();
    const database = input.database?.trim();
    const username = input.username?.trim();
    const password = input.password?.trim();
    if (!host || !database || !username || !password) {
      throw new DomainError("VALIDATION_ERROR", "连接配置缺少 host/database/username/password", 400, {
        type: input.type
      });
    }

    const defaultPort = input.type === "mysql" ? 3306 : 5432;
    const passwordCiphertext = encryptSecret(
      password,
      this.appConfig.datasourceSecretKey
    );
    return {
      host,
      port: input.port ?? defaultPort,
      database,
      username,
      passwordCiphertext,
      passwordMasked: this.maskSecret(password),
      connectTimeoutMs: this.appConfig.datasourceConnectTimeoutMs
    };
  }

  protected async loadMysqlModule(): Promise<MysqlPreflightModule> {
    try {
      const dynamicImport = new Function(
        "modulePath",
        "return import(modulePath);"
      ) as (modulePath: string) => Promise<unknown>;
      return (await dynamicImport("mysql2/promise")) as MysqlPreflightModule;
    } catch {
      throw new DomainError(
        "CONNECTION_CONFIG_INVALID",
        "当前环境缺少 mysql2 依赖，无法执行连接校验。",
        400,
        {
          suggestedAction: "previous"
        }
      );
    }
  }

  protected async loadPostgresModule(): Promise<PostgresPreflightModule> {
    try {
      const dynamicImport = new Function(
        "modulePath",
        "return import(modulePath);"
      ) as (modulePath: string) => Promise<unknown>;
      return (await dynamicImport("pg")) as PostgresPreflightModule;
    } catch {
      throw new DomainError(
        "CONNECTION_CONFIG_INVALID",
        "当前环境缺少 pg 依赖，无法执行连接校验。",
        400,
        {
          suggestedAction: "previous"
        }
      );
    }
  }

  private async preflightMysqlConnection(
    normalized: NormalizedRelationalConnection
  ): Promise<void> {
    const mysql = await this.loadMysqlModule();
    let connection: MysqlPreflightConnection | undefined;
    try {
      connection = await mysql.createConnection({
        host: normalized.host,
        port: normalized.port,
        database: normalized.database,
        user: normalized.username,
        password: normalized.password,
        connectTimeout: this.appConfig.datasourceConnectTimeoutMs
      });
    } finally {
      await connection?.end().catch(() => undefined);
    }
  }

  private async preflightPostgresConnection(
    normalized: NormalizedRelationalConnection
  ): Promise<void> {
    const pg = await this.loadPostgresModule();
    const client = new pg.Client({
      host: normalized.host,
      port: normalized.port,
      user: normalized.username,
      password: normalized.password,
      database: normalized.database,
      connectionTimeoutMillis: this.appConfig.datasourceConnectTimeoutMs
    });

    try {
      await client.connect();
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  private normalizeRelationalConnectionInput(
    input: RelationalConnectionInput
  ): NormalizedRelationalConnection {
    const host = input.host?.trim() ?? "";
    const database = input.database?.trim() ?? "";
    const username = input.username?.trim() ?? "";
    const password = input.password?.trim() ?? "";
    const defaultPort = input.type === "mysql" ? 3306 : 5432;
    const port = input.port ?? defaultPort;

    if (!host || !database || !username || !password) {
      throw new DomainError(
        "CONNECTION_CONFIG_INVALID",
        "连接配置缺少 host/database/username/password",
        400,
        {
          type: input.type,
          suggestedAction: "previous"
        }
      );
    }

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new DomainError("CONNECTION_CONFIG_INVALID", "连接端口不合法", 400, {
        type: input.type,
        port,
        suggestedAction: "previous"
      });
    }

    return {
      type: input.type,
      host,
      port,
      database,
      username,
      password
    };
  }

  private mapConnectionPreflightError(
    normalized: NormalizedRelationalConnection,
    error: unknown
  ): DomainError {
    const meta = this.extractDriverErrorMeta(error);
    const classification = this.classifyConnectionFailure(meta);
    const messageByCode: Record<string, string> = {
      CONNECTION_AUTH_FAILED: "连接认证失败，请确认用户名或密码后重试。",
      CONNECTION_NETWORK_UNREACHABLE: "连接目标不可达，请检查网络、主机或端口后重试。",
      CONNECTION_DATABASE_NOT_FOUND: "目标数据库不存在，请确认数据库名后重试。",
      CONNECTION_CONFIG_INVALID: "连接配置无效，请返回上一步检查连接参数。"
    };
    const suggestedAction =
      classification === "CONNECTION_AUTH_FAILED" ||
      classification === "CONNECTION_NETWORK_UNREACHABLE"
        ? "retry"
        : "previous";

    return new DomainError(classification, messageByCode[classification], 400, {
      datasourceType: normalized.type,
      host: normalized.host,
      port: normalized.port,
      database: normalized.database,
      driverCode: meta.code || undefined,
      errno: Number.isFinite(meta.errno ?? NaN) ? meta.errno : undefined,
      sqlState: meta.sqlState || undefined,
      suggestedAction
    });
  }

  private classifyConnectionFailure(meta: DriverErrorMeta): string {
    const message = meta.message.toLowerCase();
    const code = meta.code.toUpperCase();
    const sqlState = meta.sqlState.toUpperCase();
    const errno = meta.errno;

    const authFailed =
      code === "ER_ACCESS_DENIED_ERROR" ||
      code === "28P01" ||
      sqlState === "28000" ||
      errno === 1045 ||
      message.includes("access denied") ||
      message.includes("authentication failed") ||
      message.includes("password authentication failed");
    if (authFailed) {
      return "CONNECTION_AUTH_FAILED";
    }

    const networkUnreachable =
      code === "ECONNREFUSED" ||
      code === "ENOTFOUND" ||
      code === "ETIMEDOUT" ||
      code === "EHOSTUNREACH" ||
      code === "ENETUNREACH" ||
      code === "EAI_AGAIN" ||
      message.includes("econnrefused") ||
      message.includes("enotfound") ||
      message.includes("timeout") ||
      message.includes("network");
    if (networkUnreachable) {
      return "CONNECTION_NETWORK_UNREACHABLE";
    }

    const databaseNotFound =
      code === "ER_BAD_DB_ERROR" ||
      code === "3D000" ||
      errno === 1049 ||
      message.includes("unknown database") ||
      (message.includes("database") && message.includes("does not exist"));
    if (databaseNotFound) {
      return "CONNECTION_DATABASE_NOT_FOUND";
    }

    return "CONNECTION_CONFIG_INVALID";
  }

  private extractDriverErrorMeta(error: unknown): DriverErrorMeta {
    const unknownError =
      typeof error === "object" && error !== null
        ? (error as Record<string, unknown>)
        : {};
    const rawCode = unknownError.code;
    const rawErrno = unknownError.errno;
    const rawSqlState = unknownError.sqlState;
    const message =
      error instanceof Error
        ? error.message
        : typeof unknownError.message === "string"
          ? unknownError.message
          : String(error);
    const code = typeof rawCode === "string" ? rawCode : "";
    const sqlState = typeof rawSqlState === "string" ? rawSqlState : "";
    const errno =
      typeof rawErrno === "number"
        ? rawErrno
        : typeof rawErrno === "string" && Number.isFinite(Number(rawErrno))
          ? Number(rawErrno)
          : undefined;

    return {
      code,
      errno,
      sqlState,
      message
    };
  }

  private sanitizeDatasource(datasource: Datasource): Datasource {
    if (!datasource.config) {
      return datasource;
    }

    const redacted: Record<string, unknown> = { ...datasource.config };
    delete redacted.password;
    delete redacted.passwordCiphertext;
    if (typeof redacted.passwordMasked !== "string") {
      redacted.passwordMasked = "***";
    }

    return {
      ...datasource,
      config: redacted
    };
  }

  private fileExtension(fileName: string): "csv" | "xls" | "xlsx" {
    const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
    const ext = match?.[1];
    if (ext === "csv" || ext === "xls" || ext === "xlsx") {
      return ext;
    }
    throw new DomainError("UNSUPPORTED_FILE_TYPE", "仅支持上传 CSV 或 Excel 文件", 400, {
      fileName
    });
  }

  private removeFileExtension(fileName: string): string {
    return fileName.replace(/\.[^/.]+$/, "");
  }

  private toSafeTableName(name: string): string {
    return (
      name
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "") || "uploaded_data"
    );
  }

  private maskSecret(raw: string): string {
    if (!raw) {
      return "";
    }
    if (raw.length <= 4) {
      return "*".repeat(raw.length);
    }
    return `${raw.slice(0, 2)}***${raw.slice(-2)}`;
  }
}
