import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { v4 as uuidv4 } from "uuid";
import { AppConfigService } from "../../../config/app-config.service";
import { DomainError } from "../../../../common/domain-error";
import type {
  ModelingGraphPayload,
  ModelingGraphRevisionRecord
} from "./modeling-graph.types";

type ModelingGraphRevisionRow = {
  id: string;
  workspaceId: string;
  datasourceId: string;
  revision: number;
  status: string;
  graphHash: string;
  graphPayload: string;
  graphPayloadVersion: number;
  createdByActorId: string | null;
  activatedByActorId: string | null;
  activatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type PrismaModelLike = {
  findMany?: (args: Record<string, unknown>) => Promise<unknown[]>;
  create?: (args: Record<string, unknown>) => Promise<unknown>;
  update?: (args: Record<string, unknown>) => Promise<unknown>;
  updateMany?: (args: Record<string, unknown>) => Promise<unknown>;
};

type PrismaClientLike = {
  workspaceModelingGraphRevision?: PrismaModelLike;
  workspaceModelingGraphRevisions?: PrismaModelLike;
  $disconnect: () => Promise<void>;
};

const toScopeKey = (workspaceId: string, datasourceId: string): string =>
  `${workspaceId}::${datasourceId}`;

@Injectable()
export class ModelingGraphRepository implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ModelingGraphRepository.name);
  private prisma?: PrismaClientLike;
  private readonly revisions = new Map<string, ModelingGraphRevisionRecord[]>();

  constructor(private readonly appConfig: AppConfigService) {}

  async onModuleInit(): Promise<void> {
    if (!this.isPrimaryPersistenceConfigured()) {
      return;
    }
    try {
      const prismaClientModulePath = "../../../../generated/prisma/client";
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
      this.logger.log("Modeling graph revision 仓储已启用 PostgreSQL 持久化。");
    } catch (error) {
      this.logger.warn(
        `Modeling graph revision 仓储初始化失败，降级为内存模式: ${
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

  async appendDraftRevision(input: {
    workspaceId: string;
    datasourceId: string;
    graphHash: string;
    graphPayload: ModelingGraphPayload;
    actorId?: string;
  }): Promise<ModelingGraphRevisionRecord> {
    const workspaceId = this.normalizeRequiredId(input.workspaceId, "workspaceId");
    const datasourceId = this.normalizeRequiredId(input.datasourceId, "datasourceId");
    const revisions = await this.listRevisions({
      workspaceId,
      datasourceId
    });
    const nextRevision = (revisions.at(-1)?.revision ?? 0) + 1;
    const now = new Date().toISOString();
    const record: ModelingGraphRevisionRecord = {
      id: uuidv4(),
      workspaceId,
      datasourceId,
      revision: nextRevision,
      status: "draft",
      graphHash: input.graphHash,
      graphPayload: input.graphPayload,
      graphPayloadVersion: 2,
      createdByActorId: input.actorId?.trim() || null,
      activatedByActorId: null,
      activatedAt: null,
      createdAt: now,
      updatedAt: now
    };

    this.upsertMemoryRecord(record);

    const model = this.getRevisionModel();
    if (
      this.isPrimaryPersistenceConfigured() &&
      this.prisma &&
      model?.create
    ) {
      await this.tryPrismaWrite(async () => {
        await model.create?.({
          data: {
            id: record.id,
            workspaceId: record.workspaceId,
            datasourceId: record.datasourceId,
            revision: record.revision,
            status: record.status,
            graphHash: record.graphHash,
            graphPayload: JSON.stringify(record.graphPayload),
            graphPayloadVersion: record.graphPayloadVersion,
            createdByActorId: record.createdByActorId ?? null,
            activatedByActorId: null,
            activatedAt: null,
            createdAt: new Date(record.createdAt),
            updatedAt: new Date(record.updatedAt)
          }
        });
      });
    }

    return this.cloneRecord(record);
  }

  async listRevisions(input: {
    workspaceId: string;
    datasourceId: string;
  }): Promise<ModelingGraphRevisionRecord[]> {
    const workspaceId = this.normalizeRequiredId(input.workspaceId, "workspaceId");
    const datasourceId = this.normalizeRequiredId(input.datasourceId, "datasourceId");
    const scopeKey = toScopeKey(workspaceId, datasourceId);
    const fromMemory = this.sortRevisions(this.revisions.get(scopeKey) ?? []);
    const model = this.getRevisionModel();

    if (!this.isPrimaryPersistenceConfigured() || !this.prisma || !model?.findMany) {
      return fromMemory.map((item) => this.cloneRecord(item));
    }

    const rows = (await this.tryPrismaRead(async () =>
      model.findMany!({
        where: {
          workspaceId,
          datasourceId
        },
        orderBy: {
          revision: "asc"
        }
      })
    )) as ModelingGraphRevisionRow[] | null;

    if (!rows) {
      return fromMemory.map((item) => this.cloneRecord(item));
    }

    const mergedByRevision = new Map<number, ModelingGraphRevisionRecord>();
    for (const row of rows) {
      const mapped = this.fromRow(row);
      mergedByRevision.set(mapped.revision, mapped);
    }
    for (const item of fromMemory) {
      mergedByRevision.set(item.revision, item);
    }

    const merged = this.sortRevisions(Array.from(mergedByRevision.values()));
    this.revisions.set(scopeKey, merged.map((item) => this.cloneRecord(item)));
    return merged.map((item) => this.cloneRecord(item));
  }

  async findRevision(input: {
    workspaceId: string;
    datasourceId: string;
    revision: number;
  }): Promise<ModelingGraphRevisionRecord | null> {
    const revisions = await this.listRevisions({
      workspaceId: input.workspaceId,
      datasourceId: input.datasourceId
    });
    const matched = revisions.find((item) => item.revision === input.revision);
    return matched ? this.cloneRecord(matched) : null;
  }

  async markActiveRevision(input: {
    workspaceId: string;
    datasourceId: string;
    revision: number;
    actorId?: string;
  }): Promise<ModelingGraphRevisionRecord> {
    const workspaceId = this.normalizeRequiredId(input.workspaceId, "workspaceId");
    const datasourceId = this.normalizeRequiredId(input.datasourceId, "datasourceId");
    const revisions = await this.listRevisions({
      workspaceId,
      datasourceId
    });
    const target = revisions.find((item) => item.revision === input.revision);
    if (!target) {
      throw new DomainError(
        "WORKSPACE_MODELING_GRAPH_REVISION_NOT_FOUND",
        "未找到 modeling graph revision。",
        404,
        {
          workspaceId,
          datasourceId,
          revision: input.revision
        }
      );
    }
    const now = new Date().toISOString();
    const actorId = input.actorId?.trim() || null;
    const scopeKey = toScopeKey(workspaceId, datasourceId);
    const updated = revisions.map((item) => {
      if (item.revision === input.revision) {
        return {
          ...item,
          status: "active" as const,
          activatedAt: now,
          activatedByActorId: actorId,
          updatedAt: now
        };
      }
      if (item.status === "active") {
        return {
          ...item,
          status: "draft" as const,
          updatedAt: now
        };
      }
      return item;
    });
    this.revisions.set(scopeKey, updated.map((item) => this.cloneRecord(item)));

    const model = this.getRevisionModel();
    if (
      this.isPrimaryPersistenceConfigured() &&
      this.prisma &&
      model?.updateMany &&
      model?.update
    ) {
      await this.tryPrismaWrite(async () => {
        await model.updateMany?.({
          where: {
            workspaceId,
            datasourceId,
            status: "active"
          },
          data: {
            status: "draft",
            updatedAt: new Date(now)
          }
        });
        await model.update?.({
          where: {
            workspaceId_datasourceId_revision: {
              workspaceId,
              datasourceId,
              revision: input.revision
            }
          },
          data: {
            status: "active",
            activatedAt: new Date(now),
            activatedByActorId: actorId,
            updatedAt: new Date(now)
          }
        });
      });
    }

    return this.cloneRecord(
      updated.find((item) => item.revision === input.revision) ?? target
    );
  }

  async getLatestScopeState(input: {
    workspaceId: string;
    datasourceId: string;
  }): Promise<{
    draft: ModelingGraphRevisionRecord | null;
    activeRevision?: number;
  }> {
    const revisions = await this.listRevisions({
      workspaceId: input.workspaceId,
      datasourceId: input.datasourceId
    });
    const draft = revisions.at(-1) ?? null;
    const active = revisions
      .filter((item) => item.status === "active")
      .sort((left, right) => left.revision - right.revision)
      .at(-1);
    return {
      draft: draft ? this.cloneRecord(draft) : null,
      activeRevision: active?.revision
    };
  }

  private upsertMemoryRecord(record: ModelingGraphRevisionRecord): void {
    const scopeKey = toScopeKey(record.workspaceId, record.datasourceId);
    const scoped = this.revisions.get(scopeKey) ?? [];
    const withoutCurrent = scoped.filter((item) => item.revision !== record.revision);
    withoutCurrent.push(this.cloneRecord(record));
    this.revisions.set(scopeKey, this.sortRevisions(withoutCurrent));
  }

  private fromRow(row: ModelingGraphRevisionRow): ModelingGraphRevisionRecord {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      datasourceId: row.datasourceId,
      revision: row.revision,
      status: row.status === "active" ? "active" : "draft",
      graphHash: row.graphHash,
      graphPayload: this.parsePayload(row.graphPayload),
      graphPayloadVersion: this.parseGraphPayloadVersion(row.graphPayloadVersion),
      createdByActorId: row.createdByActorId,
      activatedByActorId: row.activatedByActorId,
      activatedAt: row.activatedAt ? row.activatedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private parsePayload(value: string): ModelingGraphPayload {
    try {
      const parsed = JSON.parse(value) as ModelingGraphPayload;
      if (!parsed || typeof parsed !== "object") {
        throw new Error("payload invalid");
      }
      return parsed;
    } catch {
      return {
        models: [],
        relationships: [],
        calculatedFields: [],
        views: [],
        schemaChanges: []
      };
    }
  }

  private parseGraphPayloadVersion(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 2) {
      throw new DomainError(
        "WORKSPACE_MODELING_GRAPH_PAYLOAD_VERSION_UNSUPPORTED",
        "检测到未迁移的 modeling graph payload version，请先完成硬切迁移。",
        409,
        {
          requiredGraphPayloadVersion: 2,
          actualGraphPayloadVersion: value
        }
      );
    }
    return Math.floor(value);
  }

  private sortRevisions(
    revisions: ModelingGraphRevisionRecord[]
  ): ModelingGraphRevisionRecord[] {
    return [...revisions].sort((left, right) => left.revision - right.revision);
  }

  private cloneRecord(record: ModelingGraphRevisionRecord): ModelingGraphRevisionRecord {
    return JSON.parse(JSON.stringify(record)) as ModelingGraphRevisionRecord;
  }

  private normalizeRequiredId(value: string, field: string): string {
    const normalized = value.trim();
    if (!normalized) {
      throw new DomainError("VALIDATION_ERROR", `${field} 不能为空。`, 400, {
        field
      });
    }
    return normalized;
  }

  private getRevisionModel(): PrismaModelLike | undefined {
    return this.prisma?.workspaceModelingGraphRevision ?? this.prisma?.workspaceModelingGraphRevisions;
  }

  private isPrimaryPersistenceConfigured(): boolean {
    return Boolean(this.appConfig.databaseUrl);
  }

  private async tryPrismaRead<T>(read: () => Promise<T>): Promise<T | null> {
    try {
      return await read();
    } catch (error) {
      this.logger.warn(
        `Modeling graph revision 仓储读取失败，已使用内存结果: ${
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
        `Modeling graph revision 仓储写入失败，仅写入内存: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
