import { createHash } from "node:crypto";
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "../../../common/domain-error";
import { AppConfigService } from "../../config/app-config.service";
import {
  type PublishSemanticSpineSnapshotInput,
  SEMANTIC_SPINE_DEGRADED_RISK_TAG,
  SEMANTIC_SPINE_SNAPSHOT_INVALID_REASON,
  SEMANTIC_SPINE_SNAPSHOT_NOT_FOUND_REASON,
  type SemanticSpineCalculatedFieldDefinition,
  type SemanticSpineMetricDefinition,
  type SemanticSpineModelDefinition,
  type SemanticSpineRelationshipDefinition,
  type SemanticSpineSnapshotDocument,
  type SemanticSpineSnapshotLookupInput,
  type SemanticSpineSnapshotLookupResult,
  type SemanticSpineSnapshotRecord,
  type SemanticSpineSnapshotStatus
} from "./semantic-spine.types";

type PrismaClientLike = {
  semanticSpineSnapshot?: {
    create?: (args: Record<string, unknown>) => Promise<unknown>;
    updateMany?: (args: Record<string, unknown>) => Promise<{ count: number }>;
    findMany?: (args: Record<string, unknown>) => Promise<unknown[]>;
    findFirst?: (args: Record<string, unknown>) => Promise<unknown>;
  };
  $transaction?: <T>(fn: (tx: PrismaTransactionClientLike) => Promise<T>) => Promise<T>;
  $disconnect: () => Promise<void>;
};

type PrismaTransactionClientLike = Omit<PrismaClientLike, "$disconnect" | "$transaction">;

type SemanticSpineSnapshotRow = {
  id: string;
  domain: string;
  semanticVersion: number;
  status: string;
  releaseSummary: string;
  auditSummary: string;
  riskTags: string[];
  snapshot: string;
  checksum: string | null;
  publishedByRunId: string | null;
  activatedByRunId: string | null;
  activatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class SemanticSpineRepository implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SemanticSpineRepository.name);
  private prisma?: PrismaClientLike;
  private readonly snapshotsByDomain = new Map<string, SemanticSpineSnapshotRecord[]>();

  constructor(private readonly appConfig: AppConfigService) {}

  buildDatasourceScopedDomain(domain: string, datasourceId: string): string {
    const normalizedDomain = this.normalize(domain);
    const normalizedDatasourceId = this.normalizeOptional(datasourceId)?.toLowerCase();
    if (!normalizedDomain || !normalizedDatasourceId) {
      return normalizedDomain;
    }
    return `${normalizedDomain}::datasource::${normalizedDatasourceId}`;
  }

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
      this.logger.log("Semantic Spine 仓储已启用 PostgreSQL 持久化。");
    } catch (error) {
      this.logger.warn(
        `Semantic Spine 仓储初始化失败，降级为内存模式: ${
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

  async publishSnapshot(
    input: PublishSemanticSpineSnapshotInput
  ): Promise<SemanticSpineSnapshotRecord> {
    const domain = this.normalize(input.domain);
    if (!domain) {
      throw new DomainError("SEMANTIC_SPINE_DOMAIN_REQUIRED", "domain 不能为空", 400);
    }

    const snapshot = this.validateAndNormalizeSnapshot(input.snapshot);
    const latest = await this.getLatestSnapshot(domain);
    const semanticVersion = input.semanticVersion ?? (latest?.semanticVersion ?? 0) + 1;
    if (!Number.isInteger(semanticVersion) || semanticVersion <= 0) {
      throw new DomainError(
        "SEMANTIC_SPINE_VERSION_INVALID",
        "semanticVersion 必须是正整数",
        400,
        { semanticVersion }
      );
    }
    if (latest && semanticVersion <= latest.semanticVersion) {
      throw new DomainError(
        "SEMANTIC_SPINE_VERSION_NOT_MONOTONIC",
        "semanticVersion 必须单调递增",
        409,
        {
          latestSemanticVersion: latest.semanticVersion,
          requestedSemanticVersion: semanticVersion
        }
      );
    }

    const releaseSummary = this.normalizeOptional(input.releaseSummary);
    if (!releaseSummary) {
      throw new DomainError(
        "SEMANTIC_SPINE_RELEASE_SUMMARY_REQUIRED",
        "releaseSummary 不能为空",
        400
      );
    }
    const auditSummary = this.normalizeOptional(input.auditSummary);
    if (!auditSummary) {
      throw new DomainError(
        "SEMANTIC_SPINE_AUDIT_SUMMARY_REQUIRED",
        "auditSummary 不能为空",
        400
      );
    }

    const now = new Date().toISOString();
    const status: SemanticSpineSnapshotStatus = input.status ?? "active";
    const serializedSnapshot = JSON.stringify(snapshot);
    const checksum =
      this.normalizeOptional(input.checksum) ?? this.createSnapshotChecksum(serializedSnapshot);
    const record: SemanticSpineSnapshotRecord = {
      id: uuidv4(),
      domain,
      semanticVersion,
      status,
      releaseSummary,
      auditSummary,
      riskTags: this.unique(input.riskTags ?? []),
      snapshot,
      checksum,
      publishedByRunId: this.normalizeOptional(input.publishedByRunId),
      activatedByRunId: this.normalizeOptional(input.activatedByRunId),
      activatedAt: input.activatedAt ? this.toIso(input.activatedAt) : undefined,
      createdAt: now,
      updatedAt: now
    };

    this.upsertSnapshotInMemory(record);

    const snapshotModel = this.prisma?.semanticSpineSnapshot;
    const tx = this.prisma?.$transaction;
    if (
      this.isPrimaryPersistenceConfigured() &&
      this.prisma &&
      tx &&
      snapshotModel?.create &&
      snapshotModel?.updateMany
    ) {
      await this.tryPrismaWrite(async () => {
        await tx(async (trx) => {
          if (status === "active") {
            await trx.semanticSpineSnapshot?.updateMany?.({
              where: {
                domain: record.domain,
                status: "active"
              },
              data: {
                status: "deprecated"
              }
            });
          }
          await trx.semanticSpineSnapshot?.create?.({
            data: {
              id: record.id,
              domain: record.domain,
              semanticVersion: record.semanticVersion,
              status: record.status,
              releaseSummary: record.releaseSummary,
              auditSummary: record.auditSummary,
              riskTags: record.riskTags,
              snapshot: serializedSnapshot,
              checksum: record.checksum ?? null,
              publishedByRunId: record.publishedByRunId ?? null,
              activatedByRunId: record.activatedByRunId ?? null,
              activatedAt: record.activatedAt ? new Date(record.activatedAt) : null,
              createdAt: new Date(record.createdAt),
              updatedAt: new Date(record.updatedAt)
            }
          });
        });
      });
    }

    return this.cloneSnapshotRecord(record);
  }

  async resolveSnapshot(
    input: SemanticSpineSnapshotLookupInput
  ): Promise<SemanticSpineSnapshotLookupResult> {
    const domain = this.normalize(input.domain);
    if (!domain) {
      throw new DomainError("SEMANTIC_SPINE_DOMAIN_REQUIRED", "domain 不能为空", 400);
    }

    const lookupDomains = this.buildLookupDomains(domain, input.datasourceId);
    for (const lookupDomain of lookupDomains) {
      const snapshot = Number.isInteger(input.semanticVersion)
        ? await this.getSnapshot(lookupDomain, input.semanticVersion as number)
        : await this.getActiveSnapshot(lookupDomain);
      if (!snapshot) {
        continue;
      }
      return {
        status: "ready",
        semantic_version: snapshot.semanticVersion,
        snapshot: this.cloneSnapshot(snapshot.snapshot),
        release_summary: snapshot.releaseSummary,
        audit_summary: snapshot.auditSummary,
        checksum: snapshot.checksum,
        published_by_run_id: snapshot.publishedByRunId,
        activated_by_run_id: snapshot.activatedByRunId,
        activated_at: snapshot.activatedAt,
        risk_tags: [...snapshot.riskTags],
        matched_scope: lookupDomain.includes("::datasource::") ? "datasource" : "global",
        matched_domain: snapshot.domain
      };
    }

    return {
      status: "degraded",
      degrade_reason: SEMANTIC_SPINE_SNAPSHOT_NOT_FOUND_REASON,
      risk_tags: [SEMANTIC_SPINE_DEGRADED_RISK_TAG]
    };
  }

  async getSnapshot(
    domain: string,
    semanticVersion: number
  ): Promise<SemanticSpineSnapshotRecord | undefined> {
    const normalizedDomain = this.normalize(domain);
    if (!normalizedDomain || !Number.isInteger(semanticVersion) || semanticVersion <= 0) {
      return undefined;
    }
    const snapshots = await this.listSnapshots(normalizedDomain);
    const matched = snapshots.find((item) => item.semanticVersion === semanticVersion);
    return matched ? this.cloneSnapshotRecord(matched) : undefined;
  }

  async listSnapshots(domain: string): Promise<SemanticSpineSnapshotRecord[]> {
    const normalizedDomain = this.normalize(domain);
    if (!normalizedDomain) {
      return [];
    }

    const memory = this.snapshotsByDomain.get(normalizedDomain);
    if (memory) {
      return memory.map((item) => this.cloneSnapshotRecord(item));
    }

    const snapshotModel = this.prisma?.semanticSpineSnapshot;
    if (!this.isPrimaryPersistenceConfigured() || !this.prisma || !snapshotModel?.findMany) {
      return [];
    }

    const rows = (await this.tryPrismaRead(async () =>
      snapshotModel.findMany?.({
        where: { domain: normalizedDomain },
        orderBy: [{ semanticVersion: "asc" }]
      })
    )) as SemanticSpineSnapshotRow[] | null;
    if (!rows) {
      return [];
    }

    const snapshots = rows.map((row) => this.fromSnapshotRow(row));
    this.snapshotsByDomain.set(normalizedDomain, snapshots);
    return snapshots.map((item) => this.cloneSnapshotRecord(item));
  }

  private async getActiveSnapshot(
    domain: string
  ): Promise<SemanticSpineSnapshotRecord | undefined> {
    const snapshots = await this.listSnapshots(domain);
    const active = snapshots
      .filter((item) => item.status === "active")
      .sort((left, right) => right.semanticVersion - left.semanticVersion)
      .at(0);
    return active ? this.cloneSnapshotRecord(active) : undefined;
  }

  private async getLatestSnapshot(
    domain: string
  ): Promise<SemanticSpineSnapshotRecord | undefined> {
    const snapshots = await this.listSnapshots(domain);
    if (snapshots.length === 0) {
      return undefined;
    }
    const sorted = [...snapshots].sort(
      (left, right) => right.semanticVersion - left.semanticVersion
    );
    return this.cloneSnapshotRecord(sorted[0]);
  }

  private validateAndNormalizeSnapshot(
    snapshot: SemanticSpineSnapshotDocument
  ): SemanticSpineSnapshotDocument {
    if (!snapshot || typeof snapshot !== "object") {
      throw new DomainError(
        "SEMANTIC_SPINE_SNAPSHOT_REQUIRED",
        "snapshot 不能为空",
        400,
        { reason: SEMANTIC_SPINE_SNAPSHOT_INVALID_REASON }
      );
    }

    const models = this.normalizeModels(snapshot.models);
    const relationships = this.normalizeRelationships(snapshot.relationships);
    const metrics = this.normalizeMetrics(snapshot.metrics);
    const calculatedFields = this.normalizeCalculatedFields(
      snapshot.calculatedFields ?? snapshot.calculated_fields
    );

    const modelKeys = new Set(models.map((item) => item.key));
    for (const relationship of relationships) {
      if (!modelKeys.has(relationship.fromModel) || !modelKeys.has(relationship.toModel)) {
        throw new DomainError(
          "SEMANTIC_SPINE_RELATIONSHIP_MODEL_NOT_FOUND",
          "relationship 引用了不存在的 model",
          400,
          {
            relationshipKey: relationship.key,
            fromModel: relationship.fromModel,
            toModel: relationship.toModel
          }
        );
      }
    }
    for (const metric of metrics) {
      if (!modelKeys.has(metric.model)) {
        throw new DomainError(
          "SEMANTIC_SPINE_METRIC_MODEL_NOT_FOUND",
          "metric 引用了不存在的 model",
          400,
          {
            metricKey: metric.key,
            model: metric.model
          }
        );
      }
      if (!metric.binding) {
        throw new DomainError("SEMANTIC_SPINE_METRIC_BINDING_REQUIRED", "metric.binding 不能为空", 400, {
          metricKey: metric.key
        });
      }
    }
    for (const calculatedField of calculatedFields) {
      if (!modelKeys.has(calculatedField.model)) {
        throw new DomainError(
          "SEMANTIC_SPINE_CALCULATED_FIELD_MODEL_NOT_FOUND",
          "calculated field 引用了不存在的 model",
          400,
          {
            calculatedFieldKey: calculatedField.key,
            model: calculatedField.model
          }
        );
      }
      if (!calculatedField.binding) {
        throw new DomainError(
          "SEMANTIC_SPINE_CALCULATED_FIELD_BINDING_REQUIRED",
          "calculatedField.binding 不能为空",
          400,
          {
            calculatedFieldKey: calculatedField.key
          }
        );
      }
    }

    return {
      models,
      relationships,
      metrics,
      calculatedFields,
      metadata: this.normalizeMetadata(snapshot.metadata)
    };
  }

  private normalizeModels(values: unknown): SemanticSpineModelDefinition[] {
    if (!Array.isArray(values) || values.length === 0) {
      throw new DomainError(
        "SEMANTIC_SPINE_MODELS_REQUIRED",
        "snapshot.models 不能为空",
        400,
        { reason: SEMANTIC_SPINE_SNAPSHOT_INVALID_REASON }
      );
    }
    const normalized = values.map((item, index) => {
      const model = this.normalizeObject(item, `snapshot.models[${index}]`);
      return {
        key: this.requiredField(model.key, "model.key", "SEMANTIC_SPINE_MODEL_KEY_REQUIRED"),
        name: this.requiredField(model.name, "model.name", "SEMANTIC_SPINE_MODEL_NAME_REQUIRED"),
        binding: this.requiredField(
          model.binding,
          "model.binding",
          "SEMANTIC_SPINE_MODEL_BINDING_REQUIRED"
        ),
        description: this.normalizeOptionalString(model.description),
        metadata: this.normalizeMetadata(model.metadata)
      } satisfies SemanticSpineModelDefinition;
    });
    this.assertUniqueKeys(normalized.map((item) => item.key), "model");
    return normalized;
  }

  private normalizeRelationships(values: unknown): SemanticSpineRelationshipDefinition[] {
    if (!Array.isArray(values)) {
      return [];
    }
    const normalized = values.map((item, index) => {
      const relationship = this.normalizeObject(item, `snapshot.relationships[${index}]`);
      return {
        key: this.requiredField(
          relationship.key,
          "relationship.key",
          "SEMANTIC_SPINE_RELATIONSHIP_KEY_REQUIRED"
        ),
        name: this.requiredField(
          relationship.name,
          "relationship.name",
          "SEMANTIC_SPINE_RELATIONSHIP_NAME_REQUIRED"
        ),
        fromModel: this.requiredField(
          relationship.fromModel,
          "relationship.fromModel",
          "SEMANTIC_SPINE_RELATIONSHIP_FROM_MODEL_REQUIRED"
        ),
        toModel: this.requiredField(
          relationship.toModel,
          "relationship.toModel",
          "SEMANTIC_SPINE_RELATIONSHIP_TO_MODEL_REQUIRED"
        ),
        relationshipType: this.normalizeOptionalString(relationship.relationshipType),
        condition: this.normalizeOptionalString(relationship.condition),
        binding: this.normalizeOptionalString(relationship.binding),
        metadata: this.normalizeMetadata(relationship.metadata)
      } satisfies SemanticSpineRelationshipDefinition;
    });
    this.assertUniqueKeys(normalized.map((item) => item.key), "relationship");
    return normalized;
  }

  private normalizeMetrics(values: unknown): SemanticSpineMetricDefinition[] {
    if (!Array.isArray(values)) {
      return [];
    }
    const normalized = values.map((item, index) => {
      const metric = this.normalizeObject(item, `snapshot.metrics[${index}]`);
      return {
        key: this.requiredField(metric.key, "metric.key", "SEMANTIC_SPINE_METRIC_KEY_REQUIRED"),
        name: this.requiredField(
          metric.name,
          "metric.name",
          "SEMANTIC_SPINE_METRIC_NAME_REQUIRED"
        ),
        model: this.requiredField(
          metric.model,
          "metric.model",
          "SEMANTIC_SPINE_METRIC_MODEL_REQUIRED"
        ),
        expression: this.normalizeOptionalString(metric.expression),
        aggregation: this.normalizeOptionalString(metric.aggregation),
        binding: this.requiredField(
          metric.binding,
          "metric.binding",
          "SEMANTIC_SPINE_METRIC_BINDING_REQUIRED"
        ),
        description: this.normalizeOptionalString(metric.description),
        metadata: this.normalizeMetadata(metric.metadata)
      } satisfies SemanticSpineMetricDefinition;
    });
    this.assertUniqueKeys(normalized.map((item) => item.key), "metric");
    return normalized;
  }

  private normalizeCalculatedFields(values: unknown): SemanticSpineCalculatedFieldDefinition[] {
    if (!Array.isArray(values)) {
      return [];
    }
    const normalized = values.map((item, index) => {
      const calculatedField = this.normalizeObject(
        item,
        `snapshot.calculatedFields[${index}]`
      );
      return {
        key: this.requiredField(
          calculatedField.key,
          "calculatedField.key",
          "SEMANTIC_SPINE_CALCULATED_FIELD_KEY_REQUIRED"
        ),
        name: this.requiredField(
          calculatedField.name,
          "calculatedField.name",
          "SEMANTIC_SPINE_CALCULATED_FIELD_NAME_REQUIRED"
        ),
        model: this.requiredField(
          calculatedField.model,
          "calculatedField.model",
          "SEMANTIC_SPINE_CALCULATED_FIELD_MODEL_REQUIRED"
        ),
        expression: this.normalizeOptionalString(calculatedField.expression),
        dataType: this.normalizeOptionalString(calculatedField.dataType),
        binding: this.requiredField(
          calculatedField.binding,
          "calculatedField.binding",
          "SEMANTIC_SPINE_CALCULATED_FIELD_BINDING_REQUIRED"
        ),
        description: this.normalizeOptionalString(calculatedField.description),
        metadata: this.normalizeMetadata(calculatedField.metadata)
      } satisfies SemanticSpineCalculatedFieldDefinition;
    });
    this.assertUniqueKeys(normalized.map((item) => item.key), "calculated_field");
    return normalized;
  }

  private normalizeObject(
    value: unknown,
    fieldName: string
  ): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new DomainError(
        "SEMANTIC_SPINE_OBJECT_INVALID",
        `${fieldName} 必须是对象`,
        400,
        { fieldName, reason: SEMANTIC_SPINE_SNAPSHOT_INVALID_REASON }
      );
    }
    return value as Record<string, unknown>;
  }

  private requiredField(value: unknown, fieldName: string, code: string): string {
    const normalized = this.normalizeOptionalString(value);
    if (!normalized) {
      throw new DomainError(code, `${fieldName} 不能为空`, 400, {
        fieldName,
        reason: SEMANTIC_SPINE_SNAPSHOT_INVALID_REASON
      });
    }
    return normalized;
  }

  private normalizeOptionalString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const normalized = value.trim();
    return normalized ? normalized : undefined;
  }

  private normalizeMetadata(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    return { ...(value as Record<string, unknown>) };
  }

  private assertUniqueKeys(keys: string[], objectType: string): void {
    const seen = new Set<string>();
    for (const key of keys) {
      if (seen.has(key)) {
        throw new DomainError(
          "SEMANTIC_SPINE_OBJECT_KEY_DUPLICATED",
          `${objectType}.key 必须唯一`,
          409,
          { objectType, key }
        );
      }
      seen.add(key);
    }
  }

  private upsertSnapshotInMemory(snapshot: SemanticSpineSnapshotRecord): void {
    const snapshots = this.snapshotsByDomain.get(snapshot.domain) ?? [];
    const withoutCurrent = snapshots.filter(
      (item) => item.semanticVersion !== snapshot.semanticVersion
    );
    if (snapshot.status === "active") {
      for (const item of withoutCurrent) {
        if (item.status === "active") {
          item.status = "deprecated";
          item.updatedAt = snapshot.updatedAt;
        }
      }
    }
    withoutCurrent.push(this.cloneSnapshotRecord(snapshot));
    withoutCurrent.sort((left, right) => left.semanticVersion - right.semanticVersion);
    this.snapshotsByDomain.set(snapshot.domain, withoutCurrent);
  }

  private fromSnapshotRow(row: SemanticSpineSnapshotRow): SemanticSpineSnapshotRecord {
    return {
      id: row.id,
      domain: row.domain,
      semanticVersion: row.semanticVersion,
      status: row.status === "active" ? "active" : "deprecated",
      releaseSummary: row.releaseSummary,
      auditSummary: row.auditSummary,
      riskTags: Array.isArray(row.riskTags) ? row.riskTags : [],
      snapshot: this.parseSnapshotFromRow(row.snapshot),
      checksum: row.checksum ?? undefined,
      publishedByRunId: row.publishedByRunId ?? undefined,
      activatedByRunId: row.activatedByRunId ?? undefined,
      activatedAt: row.activatedAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private parseSnapshotFromRow(snapshot: string): SemanticSpineSnapshotDocument {
    try {
      const parsed = JSON.parse(snapshot) as SemanticSpineSnapshotDocument;
      return this.validateAndNormalizeSnapshot(parsed);
    } catch (error) {
      this.logger.warn(
        `Semantic Spine snapshot 反序列化失败，回退空快照: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return {
        models: [],
        relationships: [],
        metrics: [],
        calculatedFields: []
      };
    }
  }

  private cloneSnapshotRecord(snapshot: SemanticSpineSnapshotRecord): SemanticSpineSnapshotRecord {
    return {
      ...snapshot,
      riskTags: [...snapshot.riskTags],
      snapshot: this.cloneSnapshot(snapshot.snapshot)
    };
  }

  private cloneSnapshot(snapshot: SemanticSpineSnapshotDocument): SemanticSpineSnapshotDocument {
    return JSON.parse(JSON.stringify(snapshot)) as SemanticSpineSnapshotDocument;
  }

  private buildLookupDomains(domain: string, datasourceId?: string): string[] {
    if (domain.includes("::datasource::")) {
      return [domain];
    }
    const normalizedDatasourceId = this.normalizeOptional(datasourceId)?.toLowerCase();
    if (!normalizedDatasourceId) {
      return [domain];
    }
    return [this.buildDatasourceScopedDomain(domain, normalizedDatasourceId), domain];
  }

  private normalize(value: string): string {
    return value.trim().toLowerCase();
  }

  private normalizeOptional(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }
    const normalized = value.trim();
    return normalized ? normalized : undefined;
  }

  private toIso(input: string): string {
    const parsed = Date.parse(input);
    if (Number.isNaN(parsed)) {
      throw new DomainError("SEMANTIC_SPINE_INVALID_TIMESTAMP", `非法时间格式: ${input}`, 400);
    }
    return new Date(parsed).toISOString();
  }

  private unique(values: string[]): string[] {
    return Array.from(
      new Set(values.map((item) => item.trim()).filter((item) => item.length > 0))
    );
  }

  private createSnapshotChecksum(snapshot: string): string {
    return createHash("sha256").update(snapshot).digest("hex");
  }

  private isPrimaryPersistenceConfigured(): boolean {
    return Boolean(this.appConfig.databaseUrl);
  }

  private async tryPrismaRead<T>(op: () => Promise<T | undefined>): Promise<T | null> {
    try {
      const result = await op();
      return result ?? null;
    } catch (error) {
      this.logger.warn(
        `Semantic Spine 读取失败，回退内存模式: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }

  private async tryPrismaWrite<T>(op: () => Promise<T | undefined>): Promise<T | null> {
    try {
      const result = await op();
      return result ?? null;
    } catch (error) {
      this.logger.warn(
        `Semantic Spine 写入失败，回退内存模式: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }
}
