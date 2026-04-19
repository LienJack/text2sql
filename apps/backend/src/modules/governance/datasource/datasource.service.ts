import { Injectable } from "@nestjs/common";
import type {
  Datasource,
  DatasourceStatus,
  DatasourceType,
  DatasourceUpsertPayload,
  PreviewDatasourceTablesResponse
} from "@text2sql/shared-types";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "../../../common/domain-error";
import { encryptSecret } from "../../../common/secret-crypto";
import { AppConfigService } from "../../config/app-config.service";
import { DatasourceRepository } from "../../platform/data/persistence/index";
import { QueryExecutorRouterService } from "../../platform/data/query/index";
import type { AccessContext } from "../access/datasource-access-policy.service";
import { PolicyEvaluatorService } from "../access/policy-evaluator.service";

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

type DatasourceMutationActor = {
  id: string;
  role: "admin" | "user";
  isSystemAdmin?: boolean;
};

type DatasourceUpdateInput = {
  name?: string;
  type?: DatasourceType;
  shared?: boolean;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  filePath?: string;
};

type PreviewDatasourceTablesInput = {
  mode: "create" | "edit";
  datasourceId?: string;
  datasource?: DatasourceUpsertPayload;
};

@Injectable()
export class DatasourceService {
  constructor(
    private readonly datasourceRepository: DatasourceRepository,
    private readonly policyEvaluatorService: PolicyEvaluatorService,
    private readonly appConfig: AppConfigService,
    private readonly queryExecutorRouter: QueryExecutorRouterService
  ) {}

  async listDatasources(options?: {
    includeUnavailable?: boolean;
    includeDeleted?: boolean;
    accessContext?: AccessContext;
  }): Promise<Datasource[]> {
    const includeUnavailable = options?.includeUnavailable ?? true;
    const statuses: DatasourceStatus[] = includeUnavailable
      ? ["available", "unavailable"]
      : ["available"];

    let list = await this.datasourceRepository.listDatasources({
      includeDeleted: options?.includeDeleted ?? false,
      statuses
    });

    if (options?.accessContext) {
      const visible = await this.policyEvaluatorService.listVisibleDatasources({
        context: options.accessContext
      });
      const visibleIds = new Set(visible.ids);
      list = list.filter((item) => visibleIds.has(item.id));
    }

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

  async updateDatasource(
    actor: DatasourceMutationActor | undefined,
    datasourceId: string,
    patch: DatasourceUpdateInput
  ): Promise<Datasource> {
    this.assertSystemAdmin(actor);
    const normalizedDatasourceId = datasourceId.trim();
    if (!normalizedDatasourceId) {
      throw new DomainError("VALIDATION_ERROR", "datasourceId 不能为空。", 400, {
        field: "datasourceId"
      });
    }

    const existing = await this.getDatasourceOrThrow(normalizedDatasourceId);
    if (patch.type !== undefined) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "数据源类型创建后不可修改。",
        400,
        {
          field: "type",
          datasourceId: normalizedDatasourceId
        }
      );
    }

    const normalizedName = patch.name?.trim();
    if (patch.name !== undefined && !normalizedName) {
      throw new DomainError("VALIDATION_ERROR", "数据源名称不能为空。", 400, {
        field: "name"
      });
    }

    const nextConfig = await this.buildUpdatedConfig(existing, patch);
    const updated = await this.datasourceRepository.upsertDatasource({
      id: existing.id,
      name: normalizedName ?? existing.name,
      type: existing.type,
      status: existing.status,
      readonly: existing.readonly,
      shared: patch.shared ?? existing.shared,
      config: nextConfig,
      fileMeta: existing.fileMeta ?? null,
      unavailableAt: existing.unavailableAt ?? null,
      deletedAt: existing.deletedAt ?? null
    });
    return this.sanitizeDatasource(updated);
  }

  async previewDatasourceTables(
    actor: DatasourceMutationActor | undefined,
    input: PreviewDatasourceTablesInput
  ): Promise<PreviewDatasourceTablesResponse> {
    this.assertSystemAdmin(actor);

    const mode = input.mode;
    if (mode !== "create" && mode !== "edit") {
      throw new DomainError("VALIDATION_ERROR", "mode 仅支持 create/edit。", 400, {
        field: "mode"
      });
    }

    const datasource = await this.resolvePreviewDatasource(input);
    const result = await this.queryExecutorRouter.execute({
      datasource,
      sql: this.buildTableDiscoverySql(datasource.type),
      limit: 500
    });

    const tableSet = new Set<string>();
    for (const row of result.rows) {
      const tableName = this.readTableName(row);
      if (!tableName) {
        continue;
      }
      tableSet.add(tableName.toLowerCase());
    }

    return {
      mode,
      datasourceId: mode === "edit" ? datasource.id : undefined,
      items: Array.from(tableSet).sort((a, b) => a.localeCompare(b))
    };
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

  private async buildUpdatedConfig(
    existing: Datasource,
    patch: DatasourceUpdateInput
  ): Promise<Record<string, unknown> | null> {
    if (existing.type === "mysql" || existing.type === "postgresql") {
      this.assertNoFileDatasourceFields(patch, existing.type);
      return this.buildUpdatedRelationalConfig(existing, patch);
    }

    if (existing.type === "sqlite") {
      this.assertNoRelationalDatasourceFields(patch, existing.type);
      const filePath = patch.filePath?.trim();
      if (patch.filePath !== undefined && !filePath) {
        throw new DomainError("VALIDATION_ERROR", "filePath 不能为空。", 400, {
          field: "filePath"
        });
      }
      return {
        ...(existing.config ?? {}),
        ...(filePath ? { path: filePath } : {})
      };
    }

    this.assertNoRelationalDatasourceFields(patch, existing.type);
    if (patch.filePath !== undefined) {
      throw new DomainError(
        "VALIDATION_ERROR",
        `${existing.type} 类型数据源不支持修改 filePath。`,
        400,
        {
          field: "filePath",
          datasourceType: existing.type
        }
      );
    }
    return existing.config ?? null;
  }

  private async buildUpdatedRelationalConfig(
    existing: Datasource,
    patch: DatasourceUpdateInput
  ): Promise<Record<string, unknown>> {
    const relationalType = existing.type as RelationalDatasourceType;
    const existingConfig = (existing.config ?? {}) as Record<string, unknown>;
    const hasConnectionFieldPatch =
      patch.host !== undefined ||
      patch.port !== undefined ||
      patch.database !== undefined ||
      patch.username !== undefined ||
      patch.password !== undefined;
    if (!hasConnectionFieldPatch) {
      return existingConfig;
    }

    const host = patch.host?.trim() ?? this.readConfigString(existingConfig, "host");
    const database =
      patch.database?.trim() ?? this.readConfigString(existingConfig, "database");
    const username =
      patch.username?.trim() ?? this.readConfigString(existingConfig, "username");
    const port = patch.port ?? this.readConfigPort(existingConfig, relationalType);
    const password = patch.password?.trim();

    if (!password) {
      throw new DomainError(
        "CONNECTION_CONFIG_INVALID",
        "修改数据库连接字段时必须提供 password 以执行连接校验。",
        400,
        {
          datasourceId: existing.id,
          datasourceType: existing.type,
          suggestedAction: "previous",
          field: "password"
        }
      );
    }

    await this.preflightDatasourceConnection({
      type: relationalType,
      host,
      port,
      database,
      username,
      password
    });

    return this.buildConnectionConfig({
      type: relationalType,
      host,
      port,
      database,
      username,
      password
    });
  }

  private assertNoRelationalDatasourceFields(
    patch: DatasourceUpdateInput,
    datasourceType: DatasourceType
  ): void {
    const restrictedFields = ["host", "port", "database", "username", "password"] as const;
    for (const field of restrictedFields) {
      if (patch[field] === undefined) {
        continue;
      }
      throw new DomainError(
        "VALIDATION_ERROR",
        `${datasourceType} 类型数据源不支持字段 ${field} 更新。`,
        400,
        {
          field,
          datasourceType
        }
      );
    }
  }

  private assertNoFileDatasourceFields(
    patch: DatasourceUpdateInput,
    datasourceType: DatasourceType
  ): void {
    if (patch.filePath === undefined) {
      return;
    }
    throw new DomainError(
      "VALIDATION_ERROR",
      `${datasourceType} 类型数据源不支持字段 filePath 更新。`,
      400,
      {
        field: "filePath",
        datasourceType
      }
    );
  }

  private readConfigString(
    config: Record<string, unknown>,
    field: "host" | "database" | "username"
  ): string {
    const value = config[field];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    throw new DomainError(
      "CONNECTION_CONFIG_INVALID",
      `当前数据源缺少 ${field}，无法执行更新前连接校验。`,
      400,
      {
        field,
        suggestedAction: "previous"
      }
    );
  }

  private readConfigPort(
    config: Record<string, unknown>,
    type: RelationalDatasourceType
  ): number {
    const value = config.port;
    if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535) {
      return value;
    }
    if (
      typeof value === "string" &&
      Number.isInteger(Number(value)) &&
      Number(value) >= 1 &&
      Number(value) <= 65535
    ) {
      return Number(value);
    }
    return type === "mysql" ? 3306 : 5432;
  }

  private async resolvePreviewDatasource(
    input: PreviewDatasourceTablesInput
  ): Promise<Datasource> {
    if (input.mode === "edit") {
      const datasourceId = input.datasourceId?.trim();
      if (!datasourceId) {
        throw new DomainError("VALIDATION_ERROR", "edit 预览必须提供 datasourceId。", 400, {
          field: "datasourceId"
        });
      }

      const existing = await this.getDatasourceOrThrow(datasourceId);
      const patch = input.datasource ?? {};
      if (patch.type !== undefined) {
        throw new DomainError(
          "VALIDATION_ERROR",
          "预览阶段不允许修改数据源类型。",
          400,
          {
            field: "type",
            datasourceId
          }
        );
      }

      if (!patch || Object.keys(patch).length === 0) {
        return existing;
      }

      const normalizedName = patch.name?.trim();
      if (patch.name !== undefined && !normalizedName) {
        throw new DomainError("VALIDATION_ERROR", "数据源名称不能为空。", 400, {
          field: "name"
        });
      }

      const nextConfig = await this.buildUpdatedConfig(existing, patch);
      return {
        ...existing,
        name: normalizedName ?? existing.name,
        shared: patch.shared ?? existing.shared,
        config: nextConfig
      };
    }

    const datasourcePayload = input.datasource;
    if (!datasourcePayload?.type) {
      throw new DomainError("VALIDATION_ERROR", "create 预览必须提供 datasource.type。", 400, {
        field: "datasource.type"
      });
    }

    const type = datasourcePayload.type;
    if ((type === "csv" || type === "excel") && !input.datasourceId?.trim()) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "文件数据源预览前请先上传文件并提供 datasourceId。",
        400,
        {
          field: "datasourceId"
        }
      );
    }

    if (input.datasourceId?.trim()) {
      const existing = await this.getDatasourceOrThrow(input.datasourceId.trim());
      const nextConfig = await this.buildUpdatedConfig(existing, datasourcePayload);
      return {
        ...existing,
        name: datasourcePayload.name?.trim() || existing.name,
        shared: datasourcePayload.shared ?? existing.shared,
        config: nextConfig
      };
    }

    const config = this.buildConnectionConfig({
      type,
      host: datasourcePayload.host,
      port: datasourcePayload.port,
      database: datasourcePayload.database,
      username: datasourcePayload.username,
      password: datasourcePayload.password,
      filePath: datasourcePayload.filePath
    });

    return {
      id: `preview-${uuidv4()}`,
      name: datasourcePayload.name?.trim() || "预览数据源",
      type,
      status: "available",
      readonly: true,
      shared: true,
      config,
      fileMeta: null,
      unavailableAt: null,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  private buildTableDiscoverySql(type: DatasourceType): string {
    if (type === "mysql") {
      return `
SELECT table_name AS tableName
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_type = 'BASE TABLE'
ORDER BY table_name
      `.trim();
    }
    if (type === "postgresql") {
      return `
SELECT table_name AS tableName
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name
      `.trim();
    }
    return `
SELECT name AS tableName
FROM sqlite_master
WHERE type = 'table'
  AND name NOT LIKE 'sqlite_%'
ORDER BY name
    `.trim();
  }

  private readTableName(row: Record<string, unknown>): string | null {
    const candidateKeys = ["tableName", "table_name", "name", "TABLE_NAME"];
    for (const key of candidateKeys) {
      const value = row[key];
      if (typeof value !== "string") {
        continue;
      }
      const normalized = value.trim();
      if (normalized) {
        return normalized;
      }
    }
    return null;
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

  private assertSystemAdmin(actor: DatasourceMutationActor | undefined): void {
    const systemAdmin = actor?.role === "admin" || actor?.isSystemAdmin === true;
    if (systemAdmin) {
      return;
    }
    throw new DomainError("FORBIDDEN", "仅系统管理员可修改数据源。", 403);
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
