import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type {
  Datasource,
  DatasourceStatus,
  DatasourceType
} from "@text2sql/shared-types";
import { v4 as uuidv4 } from "uuid";
import { AppConfigService } from "../../config/app-config.service";

type PrismaClientLike = {
  datasource: {
    upsert: (args: Record<string, unknown>) => Promise<unknown>;
    findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
    findUnique: (args: Record<string, unknown>) => Promise<unknown>;
    update: (args: Record<string, unknown>) => Promise<unknown>;
  };
  $disconnect: () => Promise<void>;
};

type DatasourceRow = {
  id: string;
  name: string;
  type: string;
  status: string;
  readonly: boolean;
  shared: boolean;
  config: string | null;
  fileMeta: string | null;
  unavailableAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type DatasourceUpsertInput = {
  id?: string;
  name: string;
  type: DatasourceType;
  status?: DatasourceStatus;
  readonly?: boolean;
  shared?: boolean;
  config?: Record<string, unknown> | null;
  fileMeta?: Record<string, unknown> | null;
  unavailableAt?: string | null;
  deletedAt?: string | null;
};

const DATASOURCE_TYPES: ReadonlySet<string> = new Set([
  "sqlite",
  "mysql",
  "postgresql",
  "excel",
  "csv"
]);

const DATASOURCE_STATUSES: ReadonlySet<string> = new Set([
  "available",
  "unavailable",
  "deleted"
]);

@Injectable()
export class DatasourceRepository implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatasourceRepository.name);
  private prisma?: PrismaClientLike;
  private readonly datasources = new Map<string, Datasource>();

  constructor(private readonly appConfig: AppConfigService) {}

  async onModuleInit(): Promise<void> {
    if (!this.isPrimaryPersistenceConfigured()) {
      return;
    }

    try {
      const prismaClientModulePath = "../../../generated/prisma/client";
      const prismaModule = (await import(prismaClientModulePath)) as unknown as {
        PrismaClient?: new (...args: unknown[]) => PrismaClientLike;
        default?: {
          PrismaClient?: new (...args: unknown[]) => PrismaClientLike;
        };
      };
      const adapterModule = (await import("@prisma/adapter-pg")) as unknown as {
        PrismaPg?: new (...args: unknown[]) => unknown;
        default?: {
          PrismaPg?: new (...args: unknown[]) => unknown;
        };
      };
      const PrismaCtor = prismaModule.PrismaClient ?? prismaModule.default?.PrismaClient;
      const PrismaPgCtor = adapterModule.PrismaPg ?? adapterModule.default?.PrismaPg;
      if (!PrismaCtor) {
        throw new Error("PrismaClient 未生成，请先执行 prisma generate");
      }
      if (!PrismaPgCtor) {
        throw new Error("Prisma PostgreSQL adapter 未安装");
      }
      const adapter = new PrismaPgCtor({
        connectionString: this.appConfig.databaseUrl
      });
      this.prisma = new PrismaCtor({
        adapter
      }) as PrismaClientLike;
      this.logger.log("Datasource 仓储已启用 PostgreSQL 持久化。");
    } catch (error) {
      this.logger.warn(
        `Datasource 仓储初始化失败，降级为内存模式: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.prisma) {
      await this.prisma.$disconnect();
    }
  }

  async ensureBaselineSqliteDatasource(sqlitePath: string): Promise<Datasource> {
    return this.upsertDatasource({
      id: "sqlite_main",
      name: "SQLite 主数据源",
      type: "sqlite",
      status: "available",
      readonly: true,
      shared: true,
      config: {
        path: sqlitePath
      },
      deletedAt: null,
      unavailableAt: null
    });
  }

  async upsertDatasource(input: DatasourceUpsertInput): Promise<Datasource> {
    const now = new Date().toISOString();
    const id = input.id ?? uuidv4();
    const existing = await this.getDatasourceById(id, {
      includeDeleted: true
    });

    const datasource: Datasource = {
      id,
      name: input.name.trim() || existing?.name || id,
      type: input.type,
      status: input.status ?? existing?.status ?? "available",
      readonly: input.readonly ?? existing?.readonly ?? true,
      shared: input.shared ?? existing?.shared ?? true,
      config: input.config ?? existing?.config ?? null,
      fileMeta: input.fileMeta ?? existing?.fileMeta ?? null,
      unavailableAt: input.unavailableAt ?? existing?.unavailableAt ?? null,
      deletedAt: input.deletedAt ?? existing?.deletedAt ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    this.datasources.set(datasource.id, datasource);

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return datasource;
    }

    await this.tryPrismaWrite(async () => {
      await this.prisma?.datasource.upsert({
        where: { id: datasource.id },
        update: this.toDatasourceWriteData(datasource),
        create: {
          id: datasource.id,
          ...this.toDatasourceWriteData(datasource)
        }
      });
    });

    return datasource;
  }

  async listDatasources(options?: {
    includeDeleted?: boolean;
    statuses?: DatasourceStatus[];
    types?: DatasourceType[];
  }): Promise<Datasource[]> {
    const includeDeleted = options?.includeDeleted ?? false;
    const statusFilter = options?.statuses;
    const typeFilter = options?.types;

    const memory = Array.from(this.datasources.values());
    const fromMemory = this.filterAndSort(memory, includeDeleted, statusFilter, typeFilter);

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return fromMemory;
    }

    const rows = (await this.tryPrismaRead(async () =>
      this.prisma?.datasource.findMany({
        where: includeDeleted ? {} : { deletedAt: null }
      })
    )) as DatasourceRow[] | null;

    if (!rows) {
      return fromMemory;
    }

    const merged = new Map<string, Datasource>();
    for (const row of rows) {
      const item = this.fromDatasourceRow(row);
      merged.set(item.id, item);
      this.datasources.set(item.id, item);
    }
    for (const item of fromMemory) {
      merged.set(item.id, item);
    }

    return this.filterAndSort(Array.from(merged.values()), includeDeleted, statusFilter, typeFilter);
  }

  async getDatasourceById(
    datasourceId: string,
    options?: { includeDeleted?: boolean }
  ): Promise<Datasource | undefined> {
    const includeDeleted = options?.includeDeleted ?? false;

    const memory = this.datasources.get(datasourceId);
    if (memory) {
      if (!includeDeleted && memory.deletedAt) {
        return undefined;
      }
      return memory;
    }

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return undefined;
    }

    const row = (await this.tryPrismaRead(async () =>
      this.prisma?.datasource.findUnique({
        where: { id: datasourceId }
      })
    )) as DatasourceRow | null;

    if (!row) {
      return undefined;
    }

    const datasource = this.fromDatasourceRow(row);
    this.datasources.set(datasource.id, datasource);
    if (!includeDeleted && datasource.deletedAt) {
      return undefined;
    }
    return datasource;
  }

  async markDatasourceUnavailable(
    datasourceId: string,
    details?: Record<string, unknown>
  ): Promise<Datasource | undefined> {
    const datasource = await this.getDatasourceById(datasourceId, {
      includeDeleted: true
    });
    if (!datasource) {
      return undefined;
    }
    return this.patchDatasource(datasourceId, {
      status: "unavailable",
      unavailableAt: new Date().toISOString(),
      config: details ? { ...(datasource.config ?? {}), lastError: details } : datasource.config
    });
  }

  async markDatasourceAvailable(datasourceId: string): Promise<Datasource | undefined> {
    return this.patchDatasource(datasourceId, {
      status: "available",
      unavailableAt: null
    });
  }

  async softDeleteDatasource(datasourceId: string): Promise<Datasource | undefined> {
    return this.patchDatasource(datasourceId, {
      status: "deleted",
      deletedAt: new Date().toISOString()
    });
  }

  private async patchDatasource(
    datasourceId: string,
    patch: Partial<Datasource>
  ): Promise<Datasource | undefined> {
    const current = await this.getDatasourceById(datasourceId, {
      includeDeleted: true
    });
    if (!current) {
      return undefined;
    }

    const next: Datasource = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    };

    this.datasources.set(next.id, next);

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma) {
      return next;
    }

    await this.tryPrismaWrite(async () => {
      await this.prisma?.datasource.update({
        where: { id: datasourceId },
        data: this.toDatasourceWriteData(next)
      });
    });

    return next;
  }

  private fromDatasourceRow(row: DatasourceRow): Datasource {
    return {
      id: row.id,
      name: row.name,
      type: this.toDatasourceType(row.type),
      status: this.toDatasourceStatus(row.status),
      readonly: row.readonly,
      shared: row.shared,
      config: this.parseJsonSafely<Record<string, unknown>>(row.config) ?? null,
      fileMeta: this.parseJsonSafely<Record<string, unknown>>(row.fileMeta) ?? null,
      unavailableAt: row.unavailableAt ? row.unavailableAt.toISOString() : null,
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private toDatasourceWriteData(datasource: Datasource): Record<string, unknown> {
    return {
      name: datasource.name,
      type: datasource.type,
      status: datasource.status,
      readonly: datasource.readonly,
      shared: datasource.shared,
      config: datasource.config ? JSON.stringify(datasource.config) : null,
      fileMeta: datasource.fileMeta ? JSON.stringify(datasource.fileMeta) : null,
      unavailableAt: datasource.unavailableAt ? new Date(datasource.unavailableAt) : null,
      deletedAt: datasource.deletedAt ? new Date(datasource.deletedAt) : null,
      createdAt: new Date(datasource.createdAt),
      updatedAt: new Date(datasource.updatedAt)
    };
  }

  private toDatasourceType(value: string): DatasourceType {
    if (!DATASOURCE_TYPES.has(value)) {
      return "sqlite";
    }
    return value as DatasourceType;
  }

  private toDatasourceStatus(value: string): DatasourceStatus {
    if (!DATASOURCE_STATUSES.has(value)) {
      return "available";
    }
    return value as DatasourceStatus;
  }

  private filterAndSort(
    datasources: Datasource[],
    includeDeleted: boolean,
    statuses?: DatasourceStatus[],
    types?: DatasourceType[]
  ): Datasource[] {
    const filtered = datasources.filter((item) => {
      if (!includeDeleted && item.deletedAt) {
        return false;
      }
      if (statuses && statuses.length > 0 && !statuses.includes(item.status)) {
        return false;
      }
      if (types && types.length > 0 && !types.includes(item.type)) {
        return false;
      }
      return true;
    });

    return filtered.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private parseJsonSafely<T>(value: string | null): T | undefined {
    if (!value) {
      return undefined;
    }
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      this.logger.warn(
        `Datasource JSON 反序列化失败: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return undefined;
    }
  }

  private isPrimaryPersistenceConfigured(): boolean {
    return Boolean(this.appConfig.databaseUrl);
  }

  private async tryPrismaRead<T>(fn: () => Promise<T | undefined>): Promise<T | null> {
    try {
      const result = await fn();
      return (result as T | undefined) ?? null;
    } catch (error) {
      this.logger.warn(
        `Datasource 读取失败，回退内存结果: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }

  private async tryPrismaWrite(fn: () => Promise<void>): Promise<boolean> {
    try {
      await fn();
      return true;
    } catch (error) {
      this.logger.warn(
        `Datasource 写入失败，仅保留内存数据: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return false;
    }
  }
}
