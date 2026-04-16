import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { v4 as uuidv4 } from "uuid";
import { AppConfigService } from "../../config/app-config.service";

export type DatasourcePolicySubjectType = "role" | "user";
export type DatasourcePolicyEffect = "allow" | "deny";
export type DatasourcePolicyRole = "admin" | "member" | "system_admin";

export type WorkspaceDatasourceBinding = {
  id: string;
  workspaceId: string;
  datasourceId: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceDatasourceTablePolicyRule = {
  id: string;
  workspaceId: string;
  datasourceId: string;
  subjectType: DatasourcePolicySubjectType;
  subjectId: string;
  tableName: string;
  effect: DatasourcePolicyEffect;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceDatasourceBindingDiff = {
  addedDatasourceIds: string[];
  removedDatasourceIds: string[];
  retainedDatasourceIds: string[];
};

export type WorkspaceDatasourceTablePermission = {
  id: string;
  workspaceId: string;
  datasourceId: string;
  tableName: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceDatasourceTablePermissionSet = {
  workspaceId: string;
  datasourceId: string;
  policyVersion: number;
  tableNames: string[];
};

type WorkspaceDatasourceTablePermissionUpsertInput = {
  id?: string;
  workspaceId: string;
  datasourceId: string;
  tableName: string;
  createdAt?: string;
  updatedAt?: string;
};

type WorkspaceDatasourceBindingUpsertInput = {
  id?: string;
  workspaceId: string;
  datasourceId: string;
  createdAt?: string;
  updatedAt?: string;
};

type TablePolicyRuleUpsertInput = {
  id?: string;
  workspaceId: string;
  datasourceId: string;
  subjectType: DatasourcePolicySubjectType;
  subjectId: string;
  tableName: string;
  effect: DatasourcePolicyEffect;
  createdAt?: string;
  updatedAt?: string;
};

type PrismaModelLike = {
  findMany?: (args: Record<string, unknown>) => Promise<unknown[]>;
  findFirst?: (args: Record<string, unknown>) => Promise<unknown | null>;
  upsert?: (args: Record<string, unknown>) => Promise<unknown>;
  update?: (args: Record<string, unknown>) => Promise<unknown>;
  create?: (args: Record<string, unknown>) => Promise<unknown>;
  deleteMany?: (args: Record<string, unknown>) => Promise<unknown>;
};

type PrismaClientLike = {
  workspaceDatasourceBinding?: PrismaModelLike;
  workspaceDatasourceBindings?: PrismaModelLike;
  workspaceDatasource?: PrismaModelLike;
  workspaceDatasourcePolicy?: PrismaModelLike;
  workspaceDatasourceTableAcl?: PrismaModelLike;
  workspaceDatasourceTablePolicy?: PrismaModelLike;
  workspaceTableAcl?: PrismaModelLike;
  workspaceDatasourceTablePermissionSet?: PrismaModelLike;
  workspaceDatasourceTablePermissionSets?: PrismaModelLike;
  workspaceDatasourceTablePermission?: PrismaModelLike;
  workspaceDatasourceTablePermissions?: PrismaModelLike;
  workspaceTablePermissionSet?: PrismaModelLike;
  workspaceTablePermission?: PrismaModelLike;
  $disconnect: () => Promise<void>;
};

const ROLE_VALUES: ReadonlySet<string> = new Set(["admin", "member", "system_admin"]);
const SUBJECT_TYPE_VALUES: ReadonlySet<string> = new Set(["role", "user"]);
const EFFECT_VALUES: ReadonlySet<string> = new Set(["allow", "deny"]);

const asNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
};

const toBindingKey = (workspaceId: string, datasourceId: string): string =>
  `${workspaceId}::${datasourceId}`;

const toRuleKey = (
  workspaceId: string,
  datasourceId: string,
  subjectType: DatasourcePolicySubjectType,
  subjectId: string,
  tableName: string
): string => `${workspaceId}::${datasourceId}::${subjectType}::${subjectId}::${tableName}`;

const toTablePermissionSetKey = (workspaceId: string, datasourceId: string): string =>
  `${workspaceId}::${datasourceId}`;

const toTablePermissionKey = (
  workspaceId: string,
  datasourceId: string,
  tableName: string
): string => `${workspaceId}::${datasourceId}::${tableName}`;

@Injectable()
export class WorkspaceDatasourcePolicyRepository implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkspaceDatasourcePolicyRepository.name);
  private prisma?: PrismaClientLike;
  private readonly bindings = new Map<string, WorkspaceDatasourceBinding>();
  private readonly rules = new Map<string, WorkspaceDatasourceTablePolicyRule>();
  private readonly tablePermissions = new Map<string, WorkspaceDatasourceTablePermission>();
  private readonly tablePermissionVersions = new Map<string, number>();

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
      this.logger.log("Workspace datasource policy 仓储已启用 PostgreSQL 持久化。");
    } catch (error) {
      this.logger.warn(
        `Workspace datasource policy 仓储初始化失败，降级为内存模式: ${
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

  async listWorkspaceDatasourceBindings(
    workspaceId: string
  ): Promise<WorkspaceDatasourceBinding[]> {
    const normalizedWorkspaceId = this.normalizeWorkspaceId(workspaceId);
    const fromMemory = Array.from(this.bindings.values()).filter(
      (item) => item.workspaceId === normalizedWorkspaceId
    );

    const model = this.getBindingModel();
    if (!this.isPrimaryPersistenceConfigured() || !this.prisma || !model?.findMany) {
      return this.sortBindings(fromMemory);
    }

    const rows = (await this.tryPrismaRead(async () =>
      model.findMany!({
        where: {
          workspaceId: normalizedWorkspaceId
        }
      })
    )) as unknown[] | null;

    if (!rows) {
      return this.sortBindings(fromMemory);
    }

    const merged = new Map<string, WorkspaceDatasourceBinding>();
    for (const row of rows) {
      const mapped = this.fromBindingRow(row);
      if (!mapped) {
        continue;
      }
      const key = toBindingKey(mapped.workspaceId, mapped.datasourceId);
      merged.set(key, mapped);
      this.bindings.set(key, mapped);
    }
    for (const item of fromMemory) {
      merged.set(toBindingKey(item.workspaceId, item.datasourceId), item);
    }
    return this.sortBindings(Array.from(merged.values()));
  }

  async listWorkspaceDatasourceIds(workspaceId: string): Promise<string[]> {
    const bindings = await this.listWorkspaceDatasourceBindings(workspaceId);
    return bindings.map((item) => item.datasourceId);
  }

  async isDatasourceBound(workspaceId: string, datasourceId: string): Promise<boolean> {
    const normalizedWorkspaceId = this.normalizeWorkspaceId(workspaceId);
    const normalizedDatasourceId = this.normalizeDatasourceId(datasourceId);
    const key = toBindingKey(normalizedWorkspaceId, normalizedDatasourceId);
    if (this.bindings.has(key)) {
      return true;
    }
    const bindings = await this.listWorkspaceDatasourceBindings(normalizedWorkspaceId);
    return bindings.some((item) => item.datasourceId === normalizedDatasourceId);
  }

  async listWorkspaceDatasourceTablePermissions(input: {
    workspaceId: string;
    datasourceId: string;
  }): Promise<WorkspaceDatasourceTablePermission[]> {
    const normalizedWorkspaceId = this.normalizeWorkspaceId(input.workspaceId);
    const normalizedDatasourceId = this.normalizeDatasourceId(input.datasourceId);
    const fromMemory = Array.from(this.tablePermissions.values()).filter((item) => {
      return (
        item.workspaceId === normalizedWorkspaceId &&
        item.datasourceId === normalizedDatasourceId
      );
    });

    const model = this.getTablePermissionModel();
    if (!this.isPrimaryPersistenceConfigured() || !this.prisma || !model?.findMany) {
      return this.sortTablePermissions(fromMemory);
    }

    const rows = (await this.tryPrismaRead(async () =>
      model.findMany!({
        where: {
          workspaceId: normalizedWorkspaceId,
          datasourceId: normalizedDatasourceId
        }
      })
    )) as unknown[] | null;
    if (!rows) {
      return this.sortTablePermissions(fromMemory);
    }

    const merged = new Map<string, WorkspaceDatasourceTablePermission>();
    for (const row of rows) {
      const mapped = this.fromTablePermissionRow(row);
      if (!mapped) {
        continue;
      }
      const key = toTablePermissionKey(
        mapped.workspaceId,
        mapped.datasourceId,
        mapped.tableName
      );
      merged.set(key, mapped);
      this.tablePermissions.set(key, mapped);
    }
    for (const item of fromMemory) {
      merged.set(toTablePermissionKey(item.workspaceId, item.datasourceId, item.tableName), item);
    }
    return this.sortTablePermissions(Array.from(merged.values()));
  }

  async getWorkspaceDatasourceTablePermissionSet(input: {
    workspaceId: string;
    datasourceId: string;
  }): Promise<WorkspaceDatasourceTablePermissionSet> {
    const normalizedWorkspaceId = this.normalizeWorkspaceId(input.workspaceId);
    const normalizedDatasourceId = this.normalizeDatasourceId(input.datasourceId);
    const tablePermissions = await this.listWorkspaceDatasourceTablePermissions({
      workspaceId: normalizedWorkspaceId,
      datasourceId: normalizedDatasourceId
    });
    const policyVersion = await this.readWorkspaceDatasourceTablePermissionVersion({
      workspaceId: normalizedWorkspaceId,
      datasourceId: normalizedDatasourceId
    });
    return {
      workspaceId: normalizedWorkspaceId,
      datasourceId: normalizedDatasourceId,
      policyVersion,
      tableNames: tablePermissions.map((item) => item.tableName)
    };
  }

  async replaceWorkspaceDatasourceTablePermissions(input: {
    workspaceId: string;
    datasourceId: string;
    tableNames: string[];
    expectedPolicyVersion?: number;
  }): Promise<{
    workspaceId: string;
    datasourceId: string;
    policyVersion: number;
    tableNames: string[];
    beforeCount: number;
    afterCount: number;
    addedTables: string[];
    removedTables: string[];
    retainedTables: string[];
  }> {
    const normalizedWorkspaceId = this.normalizeWorkspaceId(input.workspaceId);
    const normalizedDatasourceId = this.normalizeDatasourceId(input.datasourceId);
    const normalizedTableNames = this.normalizeTableNames(input.tableNames);
    const current = await this.getWorkspaceDatasourceTablePermissionSet({
      workspaceId: normalizedWorkspaceId,
      datasourceId: normalizedDatasourceId
    });
    if (
      typeof input.expectedPolicyVersion === "number" &&
      input.expectedPolicyVersion !== current.policyVersion
    ) {
      throw new Error("workspace datasource table permission policy version mismatch");
    }

    const currentSet = new Set(current.tableNames);
    const nextSet = new Set(normalizedTableNames);

    const addedTables = normalizedTableNames.filter((tableName) => !currentSet.has(tableName));
    const removedTables = current.tableNames.filter((tableName) => !nextSet.has(tableName));
    const retainedTables = normalizedTableNames.filter((tableName) => currentSet.has(tableName));
    const changed = addedTables.length > 0 || removedTables.length > 0;
    const nextPolicyVersion = changed ? current.policyVersion + 1 : current.policyVersion;

    if (changed) {
      for (const key of Array.from(this.tablePermissions.keys())) {
        const [workspaceId, datasourceId] = key.split("::");
        if (workspaceId === normalizedWorkspaceId && datasourceId === normalizedDatasourceId) {
          this.tablePermissions.delete(key);
        }
      }
      const now = new Date().toISOString();
      for (const tableName of normalizedTableNames) {
        const normalized = this.normalizeTablePermissionInput({
          workspaceId: normalizedWorkspaceId,
          datasourceId: normalizedDatasourceId,
          tableName,
          createdAt: now,
          updatedAt: now
        });
        this.tablePermissions.set(
          toTablePermissionKey(
            normalized.workspaceId,
            normalized.datasourceId,
            normalized.tableName
          ),
          normalized
        );
      }
      this.tablePermissionVersions.set(
        toTablePermissionSetKey(normalizedWorkspaceId, normalizedDatasourceId),
        nextPolicyVersion
      );
    }

    const tablePermissionModel = this.getTablePermissionModel();
    const tablePermissionSetModel = this.getTablePermissionSetModel();
    if (
      this.isPrimaryPersistenceConfigured() &&
      this.prisma &&
      tablePermissionModel?.deleteMany &&
      tablePermissionSetModel?.upsert
    ) {
      await this.tryPrismaWrite(async () => {
        if (changed) {
          await tablePermissionModel.deleteMany?.({
            where: {
              workspaceId: normalizedWorkspaceId,
              datasourceId: normalizedDatasourceId
            }
          });
          for (const tableName of normalizedTableNames) {
            const now = new Date();
            await tablePermissionModel.upsert?.({
              where: {
                workspaceId_datasourceId_tableName: {
                  workspaceId: normalizedWorkspaceId,
                  datasourceId: normalizedDatasourceId,
                  tableName
                }
              },
              update: {
                updatedAt: now
              },
              create: {
                id: uuidv4(),
                workspaceId: normalizedWorkspaceId,
                datasourceId: normalizedDatasourceId,
                tableName,
                createdAt: now,
                updatedAt: now
              }
            });
          }
        }
        if (changed || current.policyVersion === 0) {
          await tablePermissionSetModel.upsert?.({
            where: {
              workspaceId_datasourceId: {
                workspaceId: normalizedWorkspaceId,
                datasourceId: normalizedDatasourceId
              }
            },
            update: {
              policyVersion: nextPolicyVersion,
              updatedAt: new Date()
            },
            create: {
              id: uuidv4(),
              workspaceId: normalizedWorkspaceId,
              datasourceId: normalizedDatasourceId,
              policyVersion: nextPolicyVersion,
              createdAt: new Date(),
              updatedAt: new Date()
            }
          });
        }
      });
    }

    return {
      workspaceId: normalizedWorkspaceId,
      datasourceId: normalizedDatasourceId,
      policyVersion: nextPolicyVersion,
      tableNames: normalizedTableNames,
      beforeCount: current.tableNames.length,
      afterCount: normalizedTableNames.length,
      addedTables,
      removedTables,
      retainedTables
    };
  }

  private async readWorkspaceDatasourceTablePermissionVersion(input: {
    workspaceId: string;
    datasourceId: string;
  }): Promise<number> {
    const normalizedWorkspaceId = this.normalizeWorkspaceId(input.workspaceId);
    const normalizedDatasourceId = this.normalizeDatasourceId(input.datasourceId);
    const key = toTablePermissionSetKey(normalizedWorkspaceId, normalizedDatasourceId);
    const fromMemory = this.tablePermissionVersions.get(key);

    const model = this.getTablePermissionSetModel();
    if (
      !this.isPrimaryPersistenceConfigured() ||
      !this.prisma ||
      (!model?.findFirst && !model?.findMany)
    ) {
      return fromMemory ?? 0;
    }

    const row = await this.tryPrismaRead(async () => {
      if (model.findFirst) {
        return model.findFirst({
          where: {
            workspaceId: normalizedWorkspaceId,
            datasourceId: normalizedDatasourceId
          }
        });
      }
      const rows = await model.findMany?.({
        where: {
          workspaceId: normalizedWorkspaceId,
          datasourceId: normalizedDatasourceId
        },
        take: 1
      });
      return rows?.[0] ?? null;
    });
    if (!row) {
      return fromMemory ?? 0;
    }

    const parsed = this.readPolicyVersionFromRow(row);
    if (typeof parsed === "number") {
      this.tablePermissionVersions.set(key, parsed);
      return parsed;
    }
    return fromMemory ?? 0;
  }

  async upsertWorkspaceDatasourceBindings(
    inputs: WorkspaceDatasourceBindingUpsertInput[]
  ): Promise<WorkspaceDatasourceBinding[]> {
    const now = new Date().toISOString();
    const normalized = inputs.map((input) => this.normalizeBindingInput(input));

    for (const item of normalized) {
      const key = toBindingKey(item.workspaceId, item.datasourceId);
      this.bindings.set(key, item);
    }

    const model = this.getBindingModel();
    if (!this.isPrimaryPersistenceConfigured() || !this.prisma || !model?.upsert) {
      return normalized;
    }

    await this.tryPrismaWrite(async () => {
      for (const item of normalized) {
        await model.upsert?.({
          where: {
            workspaceId_datasourceId: {
              workspaceId: item.workspaceId,
              datasourceId: item.datasourceId
            }
          },
          update: {
            updatedAt: new Date(item.updatedAt)
          },
          create: {
            id: item.id,
            workspaceId: item.workspaceId,
            datasourceId: item.datasourceId,
            createdAt: new Date(item.createdAt || now),
            updatedAt: new Date(item.updatedAt)
          }
        });
      }
    });

    return normalized;
  }

  async replaceWorkspaceDatasourceBindings(
    workspaceId: string,
    datasourceIds: string[]
  ): Promise<WorkspaceDatasourceBindingDiff> {
    const normalizedWorkspaceId = this.normalizeWorkspaceId(workspaceId);
    const nextIds = this.normalizeDatasourceIds(datasourceIds);
    const currentBindings = await this.listWorkspaceDatasourceBindings(normalizedWorkspaceId);
    const currentIds = new Set(currentBindings.map((item) => item.datasourceId));
    const nextSet = new Set(nextIds);

    const addedDatasourceIds = nextIds.filter((id) => !currentIds.has(id));
    const removedDatasourceIds = Array.from(currentIds).filter((id) => !nextSet.has(id));
    const retainedDatasourceIds = nextIds.filter((id) => currentIds.has(id));

    if (addedDatasourceIds.length > 0) {
      await this.upsertWorkspaceDatasourceBindings(
        addedDatasourceIds.map((datasourceId) => ({
          workspaceId: normalizedWorkspaceId,
          datasourceId
        }))
      );
    }

    if (removedDatasourceIds.length > 0) {
      await this.deleteWorkspaceDatasourceBindings(normalizedWorkspaceId, removedDatasourceIds);
    }

    return {
      addedDatasourceIds,
      removedDatasourceIds,
      retainedDatasourceIds
    };
  }

  async deleteWorkspaceDatasourceBindings(
    workspaceId: string,
    datasourceIds: string[]
  ): Promise<number> {
    const normalizedWorkspaceId = this.normalizeWorkspaceId(workspaceId);
    const normalizedDatasourceIds = this.normalizeDatasourceIds(datasourceIds);
    let removedCount = 0;
    for (const datasourceId of normalizedDatasourceIds) {
      const key = toBindingKey(normalizedWorkspaceId, datasourceId);
      if (this.bindings.delete(key)) {
        removedCount += 1;
      }
    }

    const model = this.getBindingModel();
    if (
      !normalizedDatasourceIds.length ||
      !this.isPrimaryPersistenceConfigured() ||
      !this.prisma ||
      !model?.deleteMany
    ) {
      return removedCount;
    }

    await this.tryPrismaWrite(async () => {
      await model.deleteMany?.({
        where: {
          workspaceId: normalizedWorkspaceId,
          datasourceId: {
            in: normalizedDatasourceIds
          }
        }
      });
    });

    return removedCount;
  }

  async listTablePolicyRules(options: {
    workspaceId: string;
    datasourceId?: string;
  }): Promise<WorkspaceDatasourceTablePolicyRule[]> {
    const normalizedWorkspaceId = this.normalizeWorkspaceId(options.workspaceId);
    const normalizedDatasourceId = options.datasourceId
      ? this.normalizeDatasourceId(options.datasourceId)
      : undefined;

    const fromMemory = Array.from(this.rules.values()).filter((item) => {
      if (item.workspaceId !== normalizedWorkspaceId) {
        return false;
      }
      if (normalizedDatasourceId && item.datasourceId !== normalizedDatasourceId) {
        return false;
      }
      return true;
    });

    const model = this.getTablePolicyModel();
    if (!this.isPrimaryPersistenceConfigured() || !this.prisma || !model?.findMany) {
      return this.sortRules(fromMemory);
    }

    const rows = (await this.tryPrismaRead(async () =>
      model.findMany!({
        where: {
          workspaceId: normalizedWorkspaceId,
          ...(normalizedDatasourceId ? { datasourceId: normalizedDatasourceId } : {})
        }
      })
    )) as unknown[] | null;

    if (!rows) {
      return this.sortRules(fromMemory);
    }

    const merged = new Map<string, WorkspaceDatasourceTablePolicyRule>();
    for (const row of rows) {
      const mapped = this.fromRuleRow(row);
      if (!mapped) {
        continue;
      }
      const key = toRuleKey(
        mapped.workspaceId,
        mapped.datasourceId,
        mapped.subjectType,
        mapped.subjectId,
        mapped.tableName
      );
      merged.set(key, mapped);
      this.rules.set(key, mapped);
    }
    for (const item of fromMemory) {
      merged.set(
        toRuleKey(
          item.workspaceId,
          item.datasourceId,
          item.subjectType,
          item.subjectId,
          item.tableName
        ),
        item
      );
    }
    return this.sortRules(Array.from(merged.values()));
  }

  async upsertTablePolicyRules(
    inputs: TablePolicyRuleUpsertInput[]
  ): Promise<WorkspaceDatasourceTablePolicyRule[]> {
    const normalized = inputs.map((input) => this.normalizeRuleInput(input));

    for (const item of normalized) {
      const key = toRuleKey(
        item.workspaceId,
        item.datasourceId,
        item.subjectType,
        item.subjectId,
        item.tableName
      );
      this.rules.set(key, item);
    }

    const model = this.getTablePolicyModel();
    if (!this.isPrimaryPersistenceConfigured() || !this.prisma || !model?.upsert) {
      return normalized;
    }

    await this.tryPrismaWrite(async () => {
      for (const item of normalized) {
        await model.upsert?.({
          where: {
            workspaceId_datasourceId_subjectType_subjectId_tableName: {
              workspaceId: item.workspaceId,
              datasourceId: item.datasourceId,
              subjectType: item.subjectType,
              subjectId: item.subjectId,
              tableName: item.tableName
            }
          },
          update: {
            effect: item.effect,
            updatedAt: new Date(item.updatedAt)
          },
          create: {
            id: item.id,
            workspaceId: item.workspaceId,
            datasourceId: item.datasourceId,
            subjectType: item.subjectType,
            subjectId: item.subjectId,
            tableName: item.tableName,
            effect: item.effect,
            createdAt: new Date(item.createdAt),
            updatedAt: new Date(item.updatedAt)
          }
        });
      }
    });

    return normalized;
  }

  async replaceTablePolicyRules(input: {
    workspaceId: string;
    datasourceId: string;
    subjectType: DatasourcePolicySubjectType;
    subjectId: string;
    effect: DatasourcePolicyEffect;
    tableNames: string[];
  }): Promise<{
    addedTables: string[];
    removedTables: string[];
    retainedTables: string[];
  }> {
    const normalizedWorkspaceId = this.normalizeWorkspaceId(input.workspaceId);
    const normalizedDatasourceId = this.normalizeDatasourceId(input.datasourceId);
    const normalizedSubjectType = this.normalizeSubjectType(input.subjectType);
    const normalizedSubjectId = this.normalizeSubjectId(
      normalizedSubjectType,
      input.subjectId
    );
    const normalizedEffect = this.normalizeEffect(input.effect);
    const nextTables = this.normalizeTableNames(input.tableNames);

    const existing = (await this.listTablePolicyRules({
      workspaceId: normalizedWorkspaceId,
      datasourceId: normalizedDatasourceId
    })).filter(
      (item) =>
        item.subjectType === normalizedSubjectType &&
        item.subjectId === normalizedSubjectId &&
        item.effect === normalizedEffect
    );

    const currentSet = new Set(existing.map((item) => item.tableName));
    const nextSet = new Set(nextTables);

    const addedTables = nextTables.filter((tableName) => !currentSet.has(tableName));
    const removedTables = Array.from(currentSet).filter((tableName) => !nextSet.has(tableName));
    const retainedTables = nextTables.filter((tableName) => currentSet.has(tableName));

    if (addedTables.length > 0) {
      await this.upsertTablePolicyRules(
        addedTables.map((tableName) => ({
          workspaceId: normalizedWorkspaceId,
          datasourceId: normalizedDatasourceId,
          subjectType: normalizedSubjectType,
          subjectId: normalizedSubjectId,
          tableName,
          effect: normalizedEffect
        }))
      );
    }

    if (removedTables.length > 0) {
      await this.deleteTablePolicyRules({
        workspaceId: normalizedWorkspaceId,
        datasourceId: normalizedDatasourceId,
        subjectType: normalizedSubjectType,
        subjectId: normalizedSubjectId,
        tableNames: removedTables,
        effect: normalizedEffect
      });
    }

    return {
      addedTables,
      removedTables,
      retainedTables
    };
  }

  async deleteTablePolicyRules(input: {
    workspaceId: string;
    datasourceId: string;
    subjectType: DatasourcePolicySubjectType;
    subjectId: string;
    tableNames: string[];
    effect?: DatasourcePolicyEffect;
  }): Promise<number> {
    const normalizedWorkspaceId = this.normalizeWorkspaceId(input.workspaceId);
    const normalizedDatasourceId = this.normalizeDatasourceId(input.datasourceId);
    const normalizedSubjectType = this.normalizeSubjectType(input.subjectType);
    const normalizedSubjectId = this.normalizeSubjectId(
      normalizedSubjectType,
      input.subjectId
    );
    const normalizedTableNames = this.normalizeTableNames(input.tableNames);
    const normalizedEffect = input.effect ? this.normalizeEffect(input.effect) : undefined;

    let removedCount = 0;
    for (const tableName of normalizedTableNames) {
      const key = toRuleKey(
        normalizedWorkspaceId,
        normalizedDatasourceId,
        normalizedSubjectType,
        normalizedSubjectId,
        tableName
      );
      const existing = this.rules.get(key);
      if (!existing) {
        continue;
      }
      if (normalizedEffect && existing.effect !== normalizedEffect) {
        continue;
      }
      this.rules.delete(key);
      removedCount += 1;
    }

    const model = this.getTablePolicyModel();
    if (
      !normalizedTableNames.length ||
      !this.isPrimaryPersistenceConfigured() ||
      !this.prisma ||
      !model?.deleteMany
    ) {
      return removedCount;
    }

    await this.tryPrismaWrite(async () => {
      await model.deleteMany?.({
        where: {
          workspaceId: normalizedWorkspaceId,
          datasourceId: normalizedDatasourceId,
          subjectType: normalizedSubjectType,
          subjectId: normalizedSubjectId,
          tableName: {
            in: normalizedTableNames
          },
          ...(normalizedEffect ? { effect: normalizedEffect } : {})
        }
      });
    });

    return removedCount;
  }

  private normalizeBindingInput(
    input: WorkspaceDatasourceBindingUpsertInput
  ): WorkspaceDatasourceBinding {
    const now = input.updatedAt ?? new Date().toISOString();
    return {
      id: input.id ?? uuidv4(),
      workspaceId: this.normalizeWorkspaceId(input.workspaceId),
      datasourceId: this.normalizeDatasourceId(input.datasourceId),
      createdAt: input.createdAt ?? now,
      updatedAt: now
    };
  }

  private normalizeTablePermissionInput(
    input: WorkspaceDatasourceTablePermissionUpsertInput
  ): WorkspaceDatasourceTablePermission {
    const now = input.updatedAt ?? new Date().toISOString();
    return {
      id: input.id ?? uuidv4(),
      workspaceId: this.normalizeWorkspaceId(input.workspaceId),
      datasourceId: this.normalizeDatasourceId(input.datasourceId),
      tableName: this.normalizeTableName(input.tableName),
      createdAt: input.createdAt ?? now,
      updatedAt: now
    };
  }

  private normalizeRuleInput(input: TablePolicyRuleUpsertInput): WorkspaceDatasourceTablePolicyRule {
    const now = input.updatedAt ?? new Date().toISOString();
    const subjectType = this.normalizeSubjectType(input.subjectType);
    return {
      id: input.id ?? uuidv4(),
      workspaceId: this.normalizeWorkspaceId(input.workspaceId),
      datasourceId: this.normalizeDatasourceId(input.datasourceId),
      subjectType,
      subjectId: this.normalizeSubjectId(subjectType, input.subjectId),
      tableName: this.normalizeTableName(input.tableName),
      effect: this.normalizeEffect(input.effect),
      createdAt: input.createdAt ?? now,
      updatedAt: now
    };
  }

  private normalizeWorkspaceId(workspaceId: string): string {
    const normalized = workspaceId.trim();
    if (!normalized) {
      throw new Error("workspaceId 不能为空");
    }
    return normalized;
  }

  private normalizeDatasourceId(datasourceId: string): string {
    const normalized = datasourceId.trim();
    if (!normalized) {
      throw new Error("datasourceId 不能为空");
    }
    return normalized;
  }

  private normalizeSubjectType(subjectType: DatasourcePolicySubjectType): DatasourcePolicySubjectType {
    const normalized = String(subjectType).trim().toLowerCase();
    if (!SUBJECT_TYPE_VALUES.has(normalized)) {
      throw new Error(`不支持的 subjectType: ${subjectType}`);
    }
    return normalized as DatasourcePolicySubjectType;
  }

  private normalizeSubjectId(
    subjectType: DatasourcePolicySubjectType,
    subjectId: string
  ): string {
    const normalized = subjectId.trim();
    if (!normalized) {
      throw new Error("subjectId 不能为空");
    }
    if (subjectType === "role") {
      const role = normalized.toLowerCase();
      if (!ROLE_VALUES.has(role)) {
        throw new Error(`不支持的 role subjectId: ${subjectId}`);
      }
      return role;
    }
    return normalized;
  }

  private normalizeEffect(effect: DatasourcePolicyEffect): DatasourcePolicyEffect {
    const normalized = String(effect).trim().toLowerCase();
    if (!EFFECT_VALUES.has(normalized)) {
      throw new Error(`不支持的 effect: ${effect}`);
    }
    return normalized as DatasourcePolicyEffect;
  }

  private normalizeTableName(tableName: string): string {
    const normalized = tableName.trim().toLowerCase();
    if (!normalized) {
      throw new Error("tableName 不能为空");
    }
    return normalized;
  }

  private normalizeDatasourceIds(datasourceIds: string[]): string[] {
    const deduped = new Set<string>();
    for (const datasourceId of datasourceIds) {
      deduped.add(this.normalizeDatasourceId(datasourceId));
    }
    return Array.from(deduped);
  }

  private normalizeTableNames(tableNames: string[]): string[] {
    const deduped = new Set<string>();
    for (const tableName of tableNames) {
      deduped.add(this.normalizeTableName(tableName));
    }
    return Array.from(deduped);
  }

  private fromBindingRow(row: unknown): WorkspaceDatasourceBinding | undefined {
    if (!row || typeof row !== "object") {
      return undefined;
    }
    const record = row as Record<string, unknown>;
    const workspaceId = asNonEmptyString(record.workspaceId ?? record.workspace_id);
    const datasourceId = asNonEmptyString(record.datasourceId ?? record.datasource_id);
    if (!workspaceId || !datasourceId) {
      return undefined;
    }
    const createdAt = this.toIso(record.createdAt ?? record.created_at);
    const updatedAt = this.toIso(record.updatedAt ?? record.updated_at);
    return {
      id: asNonEmptyString(record.id) ?? uuidv4(),
      workspaceId,
      datasourceId,
      createdAt,
      updatedAt
    };
  }

  private fromTablePermissionRow(row: unknown): WorkspaceDatasourceTablePermission | undefined {
    if (!row || typeof row !== "object") {
      return undefined;
    }
    const record = row as Record<string, unknown>;
    const workspaceId = asNonEmptyString(record.workspaceId ?? record.workspace_id);
    const datasourceId = asNonEmptyString(record.datasourceId ?? record.datasource_id);
    const tableName = asNonEmptyString(record.tableName ?? record.table_name);
    if (!workspaceId || !datasourceId || !tableName) {
      return undefined;
    }
    return {
      id: asNonEmptyString(record.id) ?? uuidv4(),
      workspaceId,
      datasourceId,
      tableName: this.normalizeTableName(tableName),
      createdAt: this.toIso(record.createdAt ?? record.created_at),
      updatedAt: this.toIso(record.updatedAt ?? record.updated_at)
    };
  }

  private readPolicyVersionFromRow(row: unknown): number | undefined {
    if (!row || typeof row !== "object") {
      return undefined;
    }
    const record = row as Record<string, unknown>;
    const raw = record.policyVersion ?? record.policy_version;
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
      return Math.floor(raw);
    }
    if (typeof raw === "string") {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return Math.floor(parsed);
      }
    }
    return undefined;
  }

  private fromRuleRow(row: unknown): WorkspaceDatasourceTablePolicyRule | undefined {
    if (!row || typeof row !== "object") {
      return undefined;
    }
    const record = row as Record<string, unknown>;
    const workspaceId = asNonEmptyString(record.workspaceId ?? record.workspace_id);
    const datasourceId = asNonEmptyString(record.datasourceId ?? record.datasource_id);
    const subjectTypeRaw = asNonEmptyString(record.subjectType ?? record.subject_type);
    const subjectIdRaw =
      asNonEmptyString(record.subjectId ?? record.subject_id ?? record.subject ?? record.role) ??
      undefined;
    const tableNameRaw =
      asNonEmptyString(record.tableName ?? record.table_name ?? record.table) ?? undefined;
    const effectRaw = asNonEmptyString(record.effect);

    if (
      !workspaceId ||
      !datasourceId ||
      !subjectTypeRaw ||
      !subjectIdRaw ||
      !tableNameRaw ||
      !effectRaw
    ) {
      return undefined;
    }

    const subjectType = this.normalizeSubjectType(
      subjectTypeRaw as DatasourcePolicySubjectType
    );
    const effect = this.normalizeEffect(effectRaw as DatasourcePolicyEffect);

    return {
      id: asNonEmptyString(record.id) ?? uuidv4(),
      workspaceId,
      datasourceId,
      subjectType,
      subjectId: this.normalizeSubjectId(subjectType, subjectIdRaw),
      tableName: this.normalizeTableName(tableNameRaw),
      effect,
      createdAt: this.toIso(record.createdAt ?? record.created_at),
      updatedAt: this.toIso(record.updatedAt ?? record.updated_at)
    };
  }

  private toIso(value: unknown): string {
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === "string") {
      const date = new Date(value);
      if (!Number.isNaN(date.valueOf())) {
        return date.toISOString();
      }
    }
    return new Date().toISOString();
  }

  private sortBindings(items: WorkspaceDatasourceBinding[]): WorkspaceDatasourceBinding[] {
    return [...items].sort((a, b) => a.datasourceId.localeCompare(b.datasourceId));
  }

  private sortTablePermissions(
    items: WorkspaceDatasourceTablePermission[]
  ): WorkspaceDatasourceTablePermission[] {
    return [...items].sort((a, b) => a.tableName.localeCompare(b.tableName));
  }

  private sortRules(items: WorkspaceDatasourceTablePolicyRule[]): WorkspaceDatasourceTablePolicyRule[] {
    return [...items].sort((a, b) => {
      const byDatasource = a.datasourceId.localeCompare(b.datasourceId);
      if (byDatasource !== 0) {
        return byDatasource;
      }
      const bySubjectType = a.subjectType.localeCompare(b.subjectType);
      if (bySubjectType !== 0) {
        return bySubjectType;
      }
      const bySubjectId = a.subjectId.localeCompare(b.subjectId);
      if (bySubjectId !== 0) {
        return bySubjectId;
      }
      return a.tableName.localeCompare(b.tableName);
    });
  }

  private getBindingModel(): PrismaModelLike | undefined {
    if (!this.prisma) {
      return undefined;
    }
    const prismaRecord = this.prisma as Record<string, unknown>;
    const candidates = [
      prismaRecord.workspaceDatasourceBinding,
      prismaRecord.workspaceDatasourceBindings,
      prismaRecord.workspaceDatasource
    ];
    return candidates.find((candidate) => this.isModelLike(candidate)) as PrismaModelLike;
  }

  private getTablePermissionSetModel(): PrismaModelLike | undefined {
    if (!this.prisma) {
      return undefined;
    }
    const prismaRecord = this.prisma as Record<string, unknown>;
    const candidates = [
      prismaRecord.workspaceDatasourceTablePermissionSet,
      prismaRecord.workspaceDatasourceTablePermissionSets,
      prismaRecord.workspaceTablePermissionSet
    ];
    return candidates.find((candidate) => this.isModelLike(candidate)) as PrismaModelLike;
  }

  private getTablePermissionModel(): PrismaModelLike | undefined {
    if (!this.prisma) {
      return undefined;
    }
    const prismaRecord = this.prisma as Record<string, unknown>;
    const candidates = [
      prismaRecord.workspaceDatasourceTablePermission,
      prismaRecord.workspaceDatasourceTablePermissions,
      prismaRecord.workspaceTablePermission
    ];
    return candidates.find((candidate) => this.isModelLike(candidate)) as PrismaModelLike;
  }

  private getTablePolicyModel(): PrismaModelLike | undefined {
    if (!this.prisma) {
      return undefined;
    }
    const prismaRecord = this.prisma as Record<string, unknown>;
    const candidates = [
      prismaRecord.workspaceDatasourceTableAcl,
      prismaRecord.workspaceDatasourceTablePolicy,
      prismaRecord.workspaceDatasourcePolicy,
      prismaRecord.workspaceTableAcl
    ];
    return candidates.find((candidate) => this.isModelLike(candidate)) as PrismaModelLike;
  }

  private isModelLike(value: unknown): value is PrismaModelLike {
    if (!value || typeof value !== "object") {
      return false;
    }
    const record = value as Record<string, unknown>;
    return (
      typeof record.findMany === "function" ||
      typeof record.findFirst === "function" ||
      typeof record.upsert === "function" ||
      typeof record.update === "function" ||
      typeof record.create === "function" ||
      typeof record.deleteMany === "function"
    );
  }

  private isPrimaryPersistenceConfigured(): boolean {
    return Boolean(this.appConfig.databaseUrl);
  }

  private async tryPrismaRead<T>(read: () => Promise<T>): Promise<T | null> {
    try {
      return await read();
    } catch (error) {
      this.logger.warn(
        `Workspace datasource policy 仓储读取失败，已使用内存结果: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }

  private async tryPrismaWrite(write: () => Promise<void>): Promise<void> {
    try {
      await write();
    } catch (error) {
      this.logger.warn(
        `Workspace datasource policy 仓储写入失败，仅写入内存: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
