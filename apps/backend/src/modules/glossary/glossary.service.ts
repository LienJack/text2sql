import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import type {
  CreateGlossaryAnchorRequest,
  CreateGlossaryTermRequest,
  GlossaryAnchor,
  GlossaryAnchorType,
  GlossaryConflictDecision,
  GlossaryConflictResolution,
  GlossaryScope,
  GlossaryTerm,
  GlossaryTermStatus,
  RollbackGlossaryAnchorResponse,
  UpdateGlossaryTermRequest,
  UpsertGlossaryTermResponse
} from "@text2sql/shared-types";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "../../common/domain-error";
import { AppConfigService } from "../config/app-config.service";
import {
  AuditLogRepository,
  DatasourceRepository
} from "../platform/data/persistence/index";
import { RagReplayRepository } from "../knowledge/rag/observability/rag-replay.repository";
import { SemanticRegistryService } from "../knowledge/semantic-registry/semantic-registry.service";
import { ListGlossaryTermsQueryDto } from "./dto/list-glossary-terms.query.dto";
import { RollbackGlossaryAnchorDto } from "./dto/rollback-glossary-anchor.dto";

type GlossaryActor = {
  id?: string;
  role?: string;
};

type PrismaClientLike = {
  glossaryTerm?: {
    create?: (args: Record<string, unknown>) => Promise<unknown>;
    update?: (args: Record<string, unknown>) => Promise<unknown>;
    findUnique?: (args: Record<string, unknown>) => Promise<unknown>;
    findMany?: (args: Record<string, unknown>) => Promise<unknown[]>;
  };
  glossaryAnchor?: {
    create?: (args: Record<string, unknown>) => Promise<unknown>;
    update?: (args: Record<string, unknown>) => Promise<unknown>;
    findUnique?: (args: Record<string, unknown>) => Promise<unknown>;
    findMany?: (args: Record<string, unknown>) => Promise<unknown[]>;
  };
  $disconnect: () => Promise<void>;
};

type GlossaryTermRow = {
  id: string;
  term: string;
  normalizedTerm: string;
  definition: string;
  synonyms: string[];
  scope: string;
  scopeKey: string;
  datasourceId: string | null;
  priority: number;
  conflictResolution: string;
  status: string;
  version: number;
  versionAnchorId: string | null;
  rollbackAnchorId: string | null;
  metadata: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type GlossaryAnchorRow = {
  id: string;
  scope: string;
  scopeKey: string;
  datasourceId: string | null;
  version: number;
  anchorType: string;
  status: string;
  summary: string | null;
  rollbackFromAnchorId: string | null;
  rollbackReason: string | null;
  createdByRunId: string | null;
  metadata: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type GlossarySemanticSnapshot = {
  versionId: string;
  domain: string;
  semanticVersion: number;
  status: "active" | "deprecated";
  riskTags: string[];
};

const GLOSSARY_SCOPES: ReadonlySet<string> = new Set(["global", "datasource"]);
const GLOSSARY_TERM_STATUSES: ReadonlySet<string> = new Set(["active", "inactive"]);
const GLOSSARY_CONFLICT_RESOLUTION: GlossaryConflictResolution = "priority_then_updated_at";
const GLOSSARY_ANCHOR_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "superseded",
  "rolled_back"
]);
const GLOSSARY_ANCHOR_TYPES: ReadonlySet<string> = new Set(["release", "rollback"]);
const DEFAULT_PRIORITY = 50;
const MIN_PRIORITY = 0;
const MAX_PRIORITY = 100;
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

@Injectable()
export class GlossaryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GlossaryService.name);
  private prisma?: PrismaClientLike;
  private readonly terms = new Map<string, GlossaryTerm>();
  private readonly anchors = new Map<string, GlossaryAnchor>();
  private semanticRegistryService?: SemanticRegistryService;
  private ragReplayRepository?: RagReplayRepository;

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly datasourceRepository: DatasourceRepository,
    private readonly auditLogRepository: AuditLogRepository,
    private readonly moduleRef?: ModuleRef
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.isPrimaryPersistenceConfigured()) {
      return;
    }
    try {
      const prismaClientModulePath = "../../generated/prisma/client";
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
      this.logger.log("Glossary 服务已启用 PostgreSQL 持久化。");
    } catch (error) {
      this.logger.warn(
        `Glossary 服务初始化失败，降级为内存模式: ${
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

  async listTerms(
    query: ListGlossaryTermsQueryDto
  ): Promise<{
    items: GlossaryTerm[];
    page: number;
    pageSize: number;
    total: number;
  }> {
    const page = this.normalizePage(query.page);
    const pageSize = this.normalizePageSize(query.pageSize);
    const scope = query.scope;
    const datasourceId = query.datasourceId?.trim() || undefined;
    const status = query.status;
    const version = query.version;
    const keyword = query.query?.trim().toLowerCase() || undefined;

    const fromMemory = this.filterTerms(Array.from(this.terms.values()), {
      scope,
      datasourceId,
      status,
      version,
      keyword
    });

    const termModel = this.prisma?.glossaryTerm;
    if (
      !this.isPrimaryPersistenceConfigured() ||
      !this.prisma ||
      !termModel?.findMany
    ) {
      return this.paginateTerms(fromMemory, page, pageSize);
    }

    const where: Record<string, unknown> = {};
    if (scope) {
      where.scope = scope;
    }
    if (datasourceId) {
      where.datasourceId = datasourceId;
    }
    if (status) {
      where.status = status;
    }
    if (typeof version === "number") {
      where.version = version;
    }
    if (keyword) {
      where.OR = [
        {
          term: {
            contains: keyword,
            mode: "insensitive"
          }
        },
        {
          definition: {
            contains: keyword,
            mode: "insensitive"
          }
        },
        {
          synonyms: {
            hasSome: [keyword]
          }
        }
      ];
    }

    const rows = (await this.tryPrismaRead(async () =>
      termModel.findMany?.({
        where,
        orderBy: [{ priority: "desc" }, { updatedAt: "desc" }]
      })
    )) as GlossaryTermRow[] | null;

    if (!rows) {
      return this.paginateTerms(fromMemory, page, pageSize);
    }

    const merged = new Map<string, GlossaryTerm>();
    for (const row of rows) {
      const term = this.fromGlossaryTermRow(row);
      merged.set(term.id, term);
      this.terms.set(term.id, term);
    }
    for (const term of fromMemory) {
      merged.set(term.id, term);
    }

    const filtered = this.filterTerms(Array.from(merged.values()), {
      scope,
      datasourceId,
      status,
      version,
      keyword
    });
    return this.paginateTerms(filtered, page, pageSize);
  }

  async createTerm(
    input: CreateGlossaryTermRequest,
    actor: GlossaryActor | undefined,
    idempotencyKeyRaw: string | undefined,
    requestId?: string
  ): Promise<UpsertGlossaryTermResponse> {
    const termText = this.normalizeTerm(input.term);
    const definition = this.normalizeDefinition(input.definition);
    const scope = this.normalizeScope(input.scope);
    const datasourceId = await this.normalizeDatasourceId(scope, input.datasourceId);
    const scopeKey = this.buildScopeKey(scope, datasourceId);
    const normalizedTerm = termText.toLowerCase();
    const activeAnchor = await this.getActiveAnchor(scopeKey);
    const version = activeAnchor?.version ?? 1;

    const existing = await this.findByScopeKeyAndNormalizedTerm(scopeKey, normalizedTerm, version);
    if (existing) {
      throw new DomainError("GLOSSARY_TERM_DUPLICATE", "同作用域下术语已存在。", 409, {
        term: termText,
        scope,
        scopeKey,
        version
      });
    }

    const now = new Date().toISOString();
    const term: GlossaryTerm = {
      id: `gterm-${uuidv4()}`,
      term: termText,
      normalizedTerm,
      definition,
      synonyms: this.normalizeSynonyms(input.synonyms),
      scope,
      scopeKey,
      datasourceId,
      priority: this.normalizePriority(input.priority),
      conflictResolution: GLOSSARY_CONFLICT_RESOLUTION,
      status: "active",
      version,
      versionAnchorId: null,
      rollbackAnchorId: null,
      metadata: this.normalizeMetadata(input.metadata),
      createdAt: now,
      updatedAt: now
    };

    this.terms.set(term.id, term);
    const termModel = this.prisma?.glossaryTerm;
    if (
      this.isPrimaryPersistenceConfigured() &&
      this.prisma &&
      termModel?.create
    ) {
      await this.tryPrismaWrite(async () => {
        await termModel.create?.({
          data: this.toGlossaryTermWriteData(term)
        });
      });
    }

    const conflictDecision = await this.resolveConflictDecision(term);
    const latestActiveAnchor = await this.getActiveAnchor(scopeKey);
    const idempotencyKey = this.normalizeIdempotencyKey(
      idempotencyKeyRaw,
      `create:${term.id}`
    );
    await this.writeTermAudit({
      operation: "create",
      actor,
      term,
      requestId,
      idempotencyKey,
      conflictDecision
    });

    return {
      term,
      linkageStatus: "success",
      conflictDecision,
      activeAnchor: latestActiveAnchor
    };
  }

  async updateTerm(
    termIdRaw: string,
    patch: UpdateGlossaryTermRequest,
    actor: GlossaryActor | undefined,
    idempotencyKeyRaw: string | undefined,
    requestId?: string
  ): Promise<UpsertGlossaryTermResponse> {
    const termId = termIdRaw.trim();
    if (!termId) {
      throw new DomainError("VALIDATION_ERROR", "termId 不能为空。", 400);
    }
    const current = await this.getTermOrThrow(termId);

    const next: GlossaryTerm = {
      ...current,
      definition:
        patch.definition !== undefined
          ? this.normalizeDefinition(patch.definition)
          : current.definition,
      synonyms:
        patch.synonyms !== undefined
          ? this.normalizeSynonyms(patch.synonyms)
          : current.synonyms,
      priority:
        patch.priority !== undefined
          ? this.normalizePriority(patch.priority)
          : current.priority,
      status:
        patch.status !== undefined
          ? this.normalizeStatus(patch.status)
          : current.status,
      conflictResolution: GLOSSARY_CONFLICT_RESOLUTION,
      metadata:
        patch.metadata !== undefined
          ? this.normalizeMetadata(patch.metadata)
          : current.metadata,
      updatedAt: new Date().toISOString()
    };

    this.terms.set(next.id, next);

    const termModel = this.prisma?.glossaryTerm;
    if (
      this.isPrimaryPersistenceConfigured() &&
      this.prisma &&
      termModel?.update
    ) {
      await this.tryPrismaWrite(async () => {
        await termModel.update?.({
          where: {
            id: next.id
          },
          data: this.toGlossaryTermWriteData(next)
        });
      });
    }

    const conflictDecision = await this.resolveConflictDecision(next);
    const activeAnchor = await this.getActiveAnchor(next.scopeKey);
    const idempotencyKey = this.normalizeIdempotencyKey(
      idempotencyKeyRaw,
      `update:${next.id}`
    );
    await this.writeTermAudit({
      operation: "update",
      actor,
      term: next,
      requestId,
      idempotencyKey,
      conflictDecision
    });

    return {
      term: next,
      linkageStatus: "success",
      conflictDecision,
      activeAnchor
    };
  }

  async toggleTerm(
    termIdRaw: string,
    actor: GlossaryActor | undefined,
    idempotencyKeyRaw: string | undefined,
    requestId?: string
  ): Promise<UpsertGlossaryTermResponse> {
    const current = await this.getTermOrThrow(termIdRaw.trim());
    const nextStatus: GlossaryTermStatus =
      current.status === "active" ? "inactive" : "active";
    return this.updateTerm(
      current.id,
      {
        status: nextStatus
      },
      actor,
      idempotencyKeyRaw,
      requestId
    );
  }

  async listAnchors(query: {
    scope?: string;
    datasourceId?: string;
    anchorType?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{
    items: GlossaryAnchor[];
    page: number;
    pageSize: number;
    total: number;
  }> {
    const scope = query.scope ? this.normalizeScope(query.scope) : undefined;
    const datasourceId = query.datasourceId?.trim() || undefined;
    const anchorType = query.anchorType
      ? this.normalizeAnchorType(query.anchorType)
      : undefined;
    const page = this.normalizePage(query.page);
    const pageSize = this.normalizePageSize(query.pageSize);

    const fromMemory = this.filterAnchors(Array.from(this.anchors.values()), {
      scope,
      datasourceId,
      anchorType
    });

    const anchorModel = this.prisma?.glossaryAnchor;
    if (
      !this.isPrimaryPersistenceConfigured() ||
      !this.prisma ||
      !anchorModel?.findMany
    ) {
      return this.paginateAnchors(fromMemory, page, pageSize);
    }

    const where: Record<string, unknown> = {};
    if (scope) {
      where.scope = scope;
    }
    if (datasourceId) {
      where.datasourceId = datasourceId;
    }
    if (anchorType) {
      where.anchorType = anchorType;
    }

    const rows = (await this.tryPrismaRead(async () =>
      anchorModel.findMany?.({
        where,
        orderBy: [{ createdAt: "desc" }, { version: "desc" }]
      })
    )) as GlossaryAnchorRow[] | null;
    if (!rows) {
      return this.paginateAnchors(fromMemory, page, pageSize);
    }

    const merged = new Map<string, GlossaryAnchor>();
    for (const row of rows) {
      const anchor = this.fromGlossaryAnchorRow(row);
      this.anchors.set(anchor.id, anchor);
      merged.set(anchor.id, anchor);
    }
    for (const anchor of fromMemory) {
      merged.set(anchor.id, anchor);
    }

    const filtered = this.filterAnchors(Array.from(merged.values()), {
      scope,
      datasourceId,
      anchorType
    });
    return this.paginateAnchors(filtered, page, pageSize);
  }

  async createAnchor(
    input: CreateGlossaryAnchorRequest,
    actor: GlossaryActor | undefined,
    idempotencyKeyRaw: string | undefined,
    requestId?: string
  ): Promise<{
    anchor: GlossaryAnchor;
    previousAnchorId?: string | null;
    replayed: boolean;
    idempotencyKey: string;
  }> {
    const scope = this.normalizeScope(input.scope);
    const datasourceId = await this.normalizeDatasourceId(scope, input.datasourceId);
    const scopeKey = this.buildScopeKey(scope, datasourceId);
    const version = this.normalizeVersion(input.version);
    const summary = this.normalizeOptionalSummary(input.summary);
    const metadata = this.normalizeMetadata(input.metadata);
    const idempotencyKey = this.normalizeIdempotencyKey(
      idempotencyKeyRaw,
      `anchor:create:${scopeKey}:${version}`
    );
    const requestContextId = requestId?.trim() || `glossary-req:${idempotencyKey}`;

    const existing = await this.getAnchorByScopeKeyAndVersion(scopeKey, version);
    if (existing) {
      return {
        anchor: existing,
        previousAnchorId: existing.id,
        replayed: true,
        idempotencyKey
      };
    }

    const previousAnchor = await this.getActiveAnchor(scopeKey);
    if (previousAnchor) {
      await this.setAnchorStatus(previousAnchor.id, "superseded");
    }

    const runId = this.resolveRunContext({
      scopeKey,
      requestId: requestContextId,
      metadata
    });
    const anchor: GlossaryAnchor = {
      id: `ganchor-${uuidv4()}`,
      scope,
      scopeKey,
      datasourceId,
      version,
      anchorType: "release",
      status: "active",
      summary,
      rollbackFromAnchorId: null,
      rollbackReason: null,
      createdByRunId: runId,
      metadata,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.anchors.set(anchor.id, anchor);
    await this.persistAnchor(anchor);

    const activeTerms = await this.listTermsByScopeAndVersion({
      scopeKey,
      version: anchor.version,
      status: "active"
    });
    await this.publishSemanticAnchorSnapshot({
      anchor,
      runId,
      terms: activeTerms
    });

    const replayKey = `glossary:anchor:release:${anchor.id}`;
    await this.writeAnchorReplay({
      runId,
      replayKey,
      stage: "glossary_anchor_release",
      anchor,
      requestId: requestContextId,
      status: "processed",
      idempotencyKey
    });

    const eventId = `g-anchor-release-${uuidv4()}`;
    await this.writeAnchorAudit({
      eventId,
      runId,
      requestId: requestContextId,
      eventType: "glossary.anchor.created",
      eventCode: "GLOSSARY_ANCHOR_CREATED",
      severity: "info",
      actor,
      anchor,
      idempotencyKey,
      message: `glossary release anchor created (version=${anchor.version})`,
      replayKey
    });

    return {
      anchor,
      previousAnchorId: previousAnchor?.id ?? null,
      replayed: false,
      idempotencyKey
    };
  }

  async rollbackAnchor(
    body: RollbackGlossaryAnchorDto,
    actor: GlossaryActor | undefined,
    idempotencyKeyRaw: string | undefined,
    requestId?: string
  ): Promise<RollbackGlossaryAnchorResponse> {
    const scope = this.normalizeScope(body.scope);
    const datasourceId = await this.normalizeDatasourceId(scope, body.datasourceId);
    const scopeKey = this.buildScopeKey(scope, datasourceId);
    const targetAnchorId = body.targetAnchorId?.trim();
    if (!targetAnchorId) {
      throw new DomainError("VALIDATION_ERROR", "targetAnchorId 不能为空。", 400, {
        field: "targetAnchorId"
      });
    }
    const idempotencyKey = this.normalizeIdempotencyKey(
      idempotencyKeyRaw,
      `rollback:${scopeKey}:${targetAnchorId}`
    );
    const requestContextId = requestId?.trim() || `glossary-req:${idempotencyKey}`;
    const fallbackRunId = this.resolveRunContext({
      scopeKey,
      requestId: requestContextId,
      fallbackSeed: targetAnchorId
    });
    let targetAnchor: GlossaryAnchor;
    try {
      targetAnchor = await this.getAnchorOrThrow(targetAnchorId);
    } catch (error) {
      if (
        error instanceof DomainError &&
        error.code === "GLOSSARY_ANCHOR_NOT_FOUND"
      ) {
        await this.writeRollbackRejectedAudit({
          runId: fallbackRunId,
          requestId: requestContextId,
          actor,
          scope,
          scopeKey,
          datasourceId,
          targetAnchorId,
          rollbackReason: body.rollbackReason?.trim() || null,
          idempotencyKey,
          reasonCode: error.code,
          reasonMessage: error.message
        });
      }
      throw error;
    }
    const runId = this.resolveRunContext({
      scopeKey,
      requestId: requestContextId,
      metadata: targetAnchor.metadata,
      fallbackSeed: targetAnchor.id
    });
    if (targetAnchor.scopeKey !== scopeKey) {
      const scopeMismatchError = new DomainError(
        "GLOSSARY_ANCHOR_SCOPE_MISMATCH",
        "目标锚点不属于当前作用域。",
        409,
        {
          scope,
          scopeKey,
          targetAnchorId
        }
      );
      await this.writeRollbackRejectedAudit({
        runId,
        requestId: requestContextId,
        actor,
        scope,
        scopeKey,
        datasourceId,
        targetAnchorId,
        rollbackReason: body.rollbackReason?.trim() || null,
        idempotencyKey,
        reasonCode: scopeMismatchError.code,
        reasonMessage: scopeMismatchError.message
      });
      throw scopeMismatchError;
    }

    const previousAnchor = await this.getActiveAnchor(scopeKey);
    const rollbackReason = body.rollbackReason?.trim() || null;
    const noop = previousAnchor?.version === targetAnchor.version;
    if (noop && previousAnchor) {
      const replayKey = `glossary:anchor:rollback:noop:${previousAnchor.id}:${idempotencyKey}`;
      const eventId = `g-anchor-rollback-noop-${uuidv4()}`;
      await this.writeAnchorReplay({
        runId,
        replayKey,
        stage: "glossary_anchor_rollback_noop",
        anchor: previousAnchor,
        requestId: requestContextId,
        status: "noop",
        idempotencyKey,
        eventId,
        rollbackFromAnchorId: targetAnchor.id,
        rollbackReason
      });
      await this.writeAnchorAudit({
        eventId,
        runId,
        requestId: requestContextId,
        eventType: "glossary.anchor.rollback.noop",
        eventCode: "GLOSSARY_ANCHOR_ROLLBACK_NOOP",
        severity: "info",
        actor,
        anchor: previousAnchor,
        idempotencyKey,
        message: `rollback noop: target version ${targetAnchor.version} already active`,
        replayKey,
        rollbackFromAnchorId: targetAnchor.id,
        rollbackReason
      });
      return {
        activeAnchor: previousAnchor,
        previousAnchorId: previousAnchor.id,
        replayed: true,
        idempotencyKey
      };
    }

    if (previousAnchor) {
      await this.setAnchorStatus(previousAnchor.id, "rolled_back");
    }

    const rollbackAnchor: GlossaryAnchor = {
      id: `ganchor-${uuidv4()}`,
      scope,
      scopeKey,
      datasourceId,
      version: targetAnchor.version,
      anchorType: "rollback",
      status: "active",
      summary: `rollback to ${targetAnchor.id}`,
      rollbackFromAnchorId: targetAnchor.id,
      rollbackReason,
      createdByRunId: runId,
      metadata: {
        ...(targetAnchor.metadata ?? {}),
        rollbackTargetAnchorId: targetAnchor.id
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.anchors.set(rollbackAnchor.id, rollbackAnchor);
    await this.persistAnchor(rollbackAnchor);

    const activeTerms = await this.listTermsByScopeAndVersion({
      scopeKey,
      version: targetAnchor.version,
      status: "active"
    });
    await this.publishSemanticAnchorSnapshot({
      anchor: rollbackAnchor,
      runId,
      terms: activeTerms,
      rollbackFromAnchorId: targetAnchor.id,
      rollbackReason
    });

    const replayKey = `glossary:anchor:rollback:${rollbackAnchor.id}`;
    const eventId = `g-anchor-rollback-${uuidv4()}`;
    await this.writeAnchorReplay({
      runId,
      replayKey,
      stage: "glossary_anchor_rollback",
      anchor: rollbackAnchor,
      requestId: requestContextId,
      status: "processed",
      idempotencyKey,
      eventId,
      rollbackFromAnchorId: targetAnchor.id,
      rollbackReason
    });

    await this.writeAnchorAudit({
      eventId,
      runId,
      requestId: requestContextId,
      eventType: "glossary.anchor.rollback.applied",
      eventCode: "GLOSSARY_ANCHOR_ROLLBACK_APPLIED",
      severity: "warning",
      actor,
      anchor: rollbackAnchor,
      idempotencyKey,
      message: `rollback to glossary anchor ${targetAnchor.id}`,
      replayKey,
      rollbackFromAnchorId: targetAnchor.id,
      rollbackReason
    });

    return {
      activeAnchor: rollbackAnchor,
      previousAnchorId: previousAnchor?.id ?? null,
      replayed: false,
      idempotencyKey
    };
  }

  private async getTermOrThrow(termId: string): Promise<GlossaryTerm> {
    const fromMemory = this.terms.get(termId);
    if (fromMemory) {
      return fromMemory;
    }

    const termModel = this.prisma?.glossaryTerm;
    if (
      this.isPrimaryPersistenceConfigured() &&
      this.prisma &&
      termModel?.findUnique
    ) {
      const row = (await this.tryPrismaRead(async () =>
        termModel.findUnique?.({
          where: { id: termId }
        })
      )) as GlossaryTermRow | null;
      if (row) {
        const term = this.fromGlossaryTermRow(row);
        this.terms.set(term.id, term);
        return term;
      }
    }

    throw new DomainError("GLOSSARY_TERM_NOT_FOUND", "术语不存在。", 404, {
      termId
    });
  }

  private async findByScopeKeyAndNormalizedTerm(
    scopeKey: string,
    normalizedTerm: string,
    version: number
  ): Promise<GlossaryTerm | undefined> {
    const fromMemory = Array.from(this.terms.values()).find(
      (item) =>
        item.scopeKey === scopeKey &&
        item.normalizedTerm === normalizedTerm &&
        item.version === version
    );
    if (fromMemory) {
      return fromMemory;
    }

    const termModel = this.prisma?.glossaryTerm;
    if (
      !this.isPrimaryPersistenceConfigured() ||
      !this.prisma ||
      !termModel?.findMany
    ) {
      return undefined;
    }

    const rows = (await this.tryPrismaRead(async () =>
      termModel.findMany?.({
        where: {
          scopeKey,
          normalizedTerm,
          version
        },
        take: 1
      })
    )) as GlossaryTermRow[] | null;

    const row = rows?.[0];
    if (!row) {
      return undefined;
    }
    const term = this.fromGlossaryTermRow(row);
    this.terms.set(term.id, term);
    return term;
  }

  private async getAnchorOrThrow(anchorIdRaw: string): Promise<GlossaryAnchor> {
    const anchorId = anchorIdRaw.trim();
    if (!anchorId) {
      throw new DomainError("VALIDATION_ERROR", "anchorId 不能为空。", 400, {
        field: "anchorId"
      });
    }

    const fromMemory = this.anchors.get(anchorId);
    if (fromMemory) {
      return fromMemory;
    }

    const anchorModel = this.prisma?.glossaryAnchor;
    if (
      this.isPrimaryPersistenceConfigured() &&
      this.prisma &&
      anchorModel?.findUnique
    ) {
      const row = (await this.tryPrismaRead(async () =>
        anchorModel.findUnique?.({
          where: { id: anchorId }
        })
      )) as GlossaryAnchorRow | null;
      if (row) {
        const anchor = this.fromGlossaryAnchorRow(row);
        this.anchors.set(anchor.id, anchor);
        return anchor;
      }
    }

    throw new DomainError("GLOSSARY_ANCHOR_NOT_FOUND", "锚点不存在。", 404, {
      anchorId
    });
  }

  private async getAnchorByScopeKeyAndVersion(
    scopeKey: string,
    version: number
  ): Promise<GlossaryAnchor | undefined> {
    const fromMemory = Array.from(this.anchors.values()).find(
      (item) => item.scopeKey === scopeKey && item.version === version
    );
    if (fromMemory) {
      return fromMemory;
    }

    const anchorModel = this.prisma?.glossaryAnchor;
    if (
      !this.isPrimaryPersistenceConfigured() ||
      !this.prisma ||
      !anchorModel?.findMany
    ) {
      return undefined;
    }

    const rows = (await this.tryPrismaRead(async () =>
      anchorModel.findMany?.({
        where: {
          scopeKey,
          version
        },
        orderBy: [{ updatedAt: "desc" }],
        take: 1
      })
    )) as GlossaryAnchorRow[] | null;

    const row = rows?.[0];
    if (!row) {
      return undefined;
    }
    const anchor = this.fromGlossaryAnchorRow(row);
    this.anchors.set(anchor.id, anchor);
    return anchor;
  }

  private async listTermsByScopeAndVersion(input: {
    scopeKey: string;
    version: number;
    status?: GlossaryTermStatus;
  }): Promise<GlossaryTerm[]> {
    const fromMemory = Array.from(this.terms.values()).filter(
      (item) =>
        item.scopeKey === input.scopeKey &&
        item.version === input.version &&
        (!input.status || item.status === input.status)
    );

    const termModel = this.prisma?.glossaryTerm;
    if (
      !this.isPrimaryPersistenceConfigured() ||
      !this.prisma ||
      !termModel?.findMany
    ) {
      return fromMemory;
    }

    const rows = (await this.tryPrismaRead(async () =>
      termModel.findMany?.({
        where: {
          scopeKey: input.scopeKey,
          version: input.version,
          ...(input.status ? { status: input.status } : {})
        },
        orderBy: [{ priority: "desc" }, { updatedAt: "desc" }]
      })
    )) as GlossaryTermRow[] | null;
    if (!rows) {
      return fromMemory;
    }

    const merged = new Map<string, GlossaryTerm>();
    for (const row of rows) {
      const term = this.fromGlossaryTermRow(row);
      this.terms.set(term.id, term);
      merged.set(term.id, term);
    }
    for (const item of fromMemory) {
      merged.set(item.id, item);
    }
    return Array.from(merged.values());
  }

  private async resolveConflictDecision(
    target: GlossaryTerm
  ): Promise<GlossaryConflictDecision | null> {
    const candidates = await this.listTermsByConflictKey({
      scopeKey: target.scopeKey,
      normalizedTerm: target.normalizedTerm,
      version: target.version
    });
    const active = candidates.filter((item) => item.status === "active");
    if (active.length === 0) {
      return null;
    }
    active.sort((left, right) => {
      if (left.priority !== right.priority) {
        return right.priority - left.priority;
      }
      const timestampDiff =
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      if (timestampDiff !== 0) {
        return timestampDiff;
      }
      return left.id.localeCompare(right.id);
    });
    const winner = active[0]!;
    return {
      resolution: GLOSSARY_CONFLICT_RESOLUTION,
      winnerTermId: winner.id,
      loserTermIds: active.slice(1).map((item) => item.id),
      winnerPriority: winner.priority,
      winnerUpdatedAt: winner.updatedAt
    };
  }

  private async listTermsByConflictKey(input: {
    scopeKey: string;
    normalizedTerm: string;
    version: number;
  }): Promise<GlossaryTerm[]> {
    const fromMemory = Array.from(this.terms.values()).filter(
      (item) =>
        item.scopeKey === input.scopeKey &&
        item.normalizedTerm === input.normalizedTerm &&
        item.version === input.version
    );

    const termModel = this.prisma?.glossaryTerm;
    if (
      !this.isPrimaryPersistenceConfigured() ||
      !this.prisma ||
      !termModel?.findMany
    ) {
      return fromMemory;
    }

    const rows = (await this.tryPrismaRead(async () =>
      termModel.findMany?.({
        where: {
          scopeKey: input.scopeKey,
          normalizedTerm: input.normalizedTerm,
          version: input.version
        }
      })
    )) as GlossaryTermRow[] | null;
    if (!rows) {
      return fromMemory;
    }

    const merged = new Map<string, GlossaryTerm>();
    for (const row of rows) {
      const term = this.fromGlossaryTermRow(row);
      merged.set(term.id, term);
      this.terms.set(term.id, term);
    }
    for (const item of fromMemory) {
      merged.set(item.id, item);
    }
    return Array.from(merged.values());
  }

  private async getActiveAnchor(scopeKey: string): Promise<GlossaryAnchor | null> {
    const fromMemory = Array.from(this.anchors.values()).filter(
      (item) => item.scopeKey === scopeKey && item.status === "active"
    );
    if (fromMemory.length > 0) {
      fromMemory.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      return fromMemory[0]!;
    }

    const anchorModel = this.prisma?.glossaryAnchor;
    if (
      !this.isPrimaryPersistenceConfigured() ||
      !this.prisma ||
      !anchorModel?.findMany
    ) {
      return null;
    }

    const rows = (await this.tryPrismaRead(async () =>
      anchorModel.findMany?.({
        where: {
          scopeKey,
          status: "active"
        },
        orderBy: {
          updatedAt: "desc"
        },
        take: 1
      })
    )) as GlossaryAnchorRow[] | null;

    const row = rows?.[0];
    if (!row) {
      return null;
    }
    const anchor = this.fromGlossaryAnchorRow(row);
    this.anchors.set(anchor.id, anchor);
    return anchor;
  }

  private async writeTermAudit(input: {
    operation: "create" | "update";
    actor: GlossaryActor | undefined;
    term: GlossaryTerm;
    requestId?: string;
    idempotencyKey: string;
    conflictDecision: GlossaryConflictDecision | null;
  }): Promise<void> {
    await this.auditLogRepository.appendEvent({
      phase: "glossary_management",
      severity: "info",
      eventType: "glossary.term.write",
      eventCode: input.operation === "create" ? "GLOSSARY_TERM_CREATED" : "GLOSSARY_TERM_UPDATED",
      requestId: input.requestId,
      message: `glossary term ${input.operation}: ${input.term.term}`,
      metadata: {
        actor: {
          id: input.actor?.id ?? "unknown",
          role: input.actor?.role ?? "unknown"
        },
        actorId: input.actor?.id ?? "unknown",
        actorRole: input.actor?.role ?? "unknown",
        scope: input.term.scope,
        scopeKey: input.term.scopeKey,
        datasourceId: input.term.datasourceId ?? null,
        winnerTerm: input.conflictDecision?.winnerTermId ?? null,
        loserTerms: input.conflictDecision?.loserTermIds ?? [],
        priority: input.term.priority,
        idempotencyKey: input.idempotencyKey,
        termId: input.term.id
      }
    });
  }

  private filterTerms(
    terms: GlossaryTerm[],
    options: {
      scope?: GlossaryScope;
      datasourceId?: string;
      status?: GlossaryTermStatus;
      version?: number;
      keyword?: string;
    }
  ): GlossaryTerm[] {
    const filtered = terms.filter((item) => {
      if (options.scope && item.scope !== options.scope) {
        return false;
      }
      if (options.datasourceId && item.datasourceId !== options.datasourceId) {
        return false;
      }
      if (options.status && item.status !== options.status) {
        return false;
      }
      if (typeof options.version === "number" && item.version !== options.version) {
        return false;
      }
      if (options.keyword) {
        const haystack = `${item.term} ${item.definition} ${item.synonyms.join(" ")}`.toLowerCase();
        if (!haystack.includes(options.keyword)) {
          return false;
        }
      }
      return true;
    });

    return filtered.sort((left, right) => {
      if (left.priority !== right.priority) {
        return right.priority - left.priority;
      }
      const updatedAtDiff = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      if (updatedAtDiff !== 0) {
        return updatedAtDiff;
      }
      return left.term.localeCompare(right.term);
    });
  }

  private filterAnchors(
    anchors: GlossaryAnchor[],
    options: {
      scope?: GlossaryScope;
      datasourceId?: string;
      anchorType?: GlossaryAnchorType;
    }
  ): GlossaryAnchor[] {
    return anchors
      .filter((item) => {
        if (options.scope && item.scope !== options.scope) {
          return false;
        }
        if (options.datasourceId && item.datasourceId !== options.datasourceId) {
          return false;
        }
        if (options.anchorType && item.anchorType !== options.anchorType) {
          return false;
        }
        return true;
      })
      .sort((left, right) => {
        const createdDiff = Date.parse(right.createdAt) - Date.parse(left.createdAt);
        if (createdDiff !== 0) {
          return createdDiff;
        }
        if (left.version !== right.version) {
          return right.version - left.version;
        }
        return left.id.localeCompare(right.id);
      });
  }

  private paginateTerms(
    items: GlossaryTerm[],
    page: number,
    pageSize: number
  ): {
    items: GlossaryTerm[];
    page: number;
    pageSize: number;
    total: number;
  } {
    const total = items.length;
    const offset = (page - 1) * pageSize;
    return {
      items: items.slice(offset, offset + pageSize),
      page,
      pageSize,
      total
    };
  }

  private paginateAnchors(
    items: GlossaryAnchor[],
    page: number,
    pageSize: number
  ): {
    items: GlossaryAnchor[];
    page: number;
    pageSize: number;
    total: number;
  } {
    const total = items.length;
    const offset = (page - 1) * pageSize;
    return {
      items: items.slice(offset, offset + pageSize),
      page,
      pageSize,
      total
    };
  }

  private fromGlossaryTermRow(row: GlossaryTermRow): GlossaryTerm {
    return {
      id: row.id,
      term: row.term,
      normalizedTerm: row.normalizedTerm,
      definition: row.definition,
      synonyms: Array.isArray(row.synonyms) ? row.synonyms : [],
      scope: this.normalizeScope(row.scope),
      scopeKey: row.scopeKey,
      datasourceId: row.datasourceId,
      priority: this.normalizePriority(row.priority),
      conflictResolution: this.toConflictResolution(row.conflictResolution),
      status: this.normalizeStatus(row.status),
      version: row.version,
      versionAnchorId: row.versionAnchorId,
      rollbackAnchorId: row.rollbackAnchorId,
      metadata: this.parseMetadata(row.metadata),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private fromGlossaryAnchorRow(row: GlossaryAnchorRow): GlossaryAnchor {
    return {
      id: row.id,
      scope: this.normalizeScope(row.scope),
      scopeKey: row.scopeKey,
      datasourceId: row.datasourceId,
      version: row.version,
      anchorType: row.anchorType === "rollback" ? "rollback" : "release",
      status: this.toAnchorStatus(row.status),
      summary: row.summary,
      rollbackFromAnchorId: row.rollbackFromAnchorId,
      rollbackReason: row.rollbackReason,
      createdByRunId: row.createdByRunId,
      metadata: this.parseMetadata(row.metadata),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private toGlossaryTermWriteData(term: GlossaryTerm): Record<string, unknown> {
    return {
      id: term.id,
      term: term.term,
      normalizedTerm: term.normalizedTerm,
      definition: term.definition,
      synonyms: term.synonyms,
      scope: term.scope,
      scopeKey: term.scopeKey,
      datasourceId: term.datasourceId ?? null,
      priority: term.priority,
      conflictResolution: term.conflictResolution,
      status: term.status,
      version: term.version,
      versionAnchorId: term.versionAnchorId ?? null,
      rollbackAnchorId: term.rollbackAnchorId ?? null,
      metadata: term.metadata ? JSON.stringify(term.metadata) : null,
      createdAt: new Date(term.createdAt),
      updatedAt: new Date(term.updatedAt)
    };
  }

  private toGlossaryAnchorWriteData(anchor: GlossaryAnchor): Record<string, unknown> {
    return {
      id: anchor.id,
      scope: anchor.scope,
      scopeKey: anchor.scopeKey,
      datasourceId: anchor.datasourceId ?? null,
      version: anchor.version,
      anchorType: anchor.anchorType,
      status: anchor.status,
      summary: anchor.summary ?? null,
      rollbackFromAnchorId: anchor.rollbackFromAnchorId ?? null,
      rollbackReason: anchor.rollbackReason ?? null,
      createdByRunId: anchor.createdByRunId ?? null,
      metadata: anchor.metadata ? JSON.stringify(anchor.metadata) : null,
      createdAt: new Date(anchor.createdAt),
      updatedAt: new Date(anchor.updatedAt)
    };
  }

  private async persistAnchor(anchor: GlossaryAnchor): Promise<void> {
    const anchorModel = this.prisma?.glossaryAnchor;
    if (
      !this.isPrimaryPersistenceConfigured() ||
      !this.prisma ||
      !anchorModel?.create
    ) {
      return;
    }
    await this.tryPrismaWrite(async () => {
      await anchorModel.create?.({
        data: this.toGlossaryAnchorWriteData(anchor)
      });
    });
  }

  private async setAnchorStatus(
    anchorId: string,
    status: "active" | "superseded" | "rolled_back"
  ): Promise<void> {
    const current = await this.getAnchorOrThrow(anchorId);
    if (current.status === status) {
      return;
    }
    const next: GlossaryAnchor = {
      ...current,
      status,
      updatedAt: new Date().toISOString()
    };
    this.anchors.set(next.id, next);

    const anchorModel = this.prisma?.glossaryAnchor;
    if (
      !this.isPrimaryPersistenceConfigured() ||
      !this.prisma ||
      !anchorModel?.update
    ) {
      return;
    }
    await this.tryPrismaWrite(async () => {
      await anchorModel.update?.({
        where: { id: next.id },
        data: this.toGlossaryAnchorWriteData(next)
      });
    });
  }

  private async publishSemanticAnchorSnapshot(input: {
    anchor: GlossaryAnchor;
    runId: string;
    terms: GlossaryTerm[];
    rollbackFromAnchorId?: string;
    rollbackReason?: string | null;
  }): Promise<GlossarySemanticSnapshot | null> {
    const semanticRegistryService = this.getSemanticRegistryService();
    if (!semanticRegistryService) {
      return null;
    }
    try {
      const snapshot = await semanticRegistryService.publishGlossaryAnchorSemantic({
        scope: input.anchor.scope,
        scopeKey: input.anchor.scopeKey,
        datasourceId: input.anchor.datasourceId,
        anchorId: input.anchor.id,
        anchorType: input.anchor.anchorType,
        glossaryVersion: input.anchor.version,
        summary: input.anchor.summary,
        rollbackFromAnchorId: input.rollbackFromAnchorId,
        rollbackReason: input.rollbackReason ?? null,
        runId: input.runId,
        terms: input.terms.map((term) => ({
          term: term.term,
          definition: term.definition,
          synonyms: term.synonyms,
          priority: term.priority,
          updatedAt: term.updatedAt
        }))
      });
      if (!snapshot) {
        return null;
      }
      return {
        versionId: snapshot.id,
        domain: snapshot.domain,
        semanticVersion: snapshot.semanticVersion,
        status: snapshot.status,
        riskTags: snapshot.riskTags
      };
    } catch (error) {
      this.logger.warn(
        `Glossary semantic snapshot 发布失败（忽略，不阻断主流程）: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }

  private async writeAnchorReplay(input: {
    runId: string;
    replayKey: string;
    stage:
      | "glossary_anchor_release"
      | "glossary_anchor_rollback"
      | "glossary_anchor_rollback_noop";
    anchor: GlossaryAnchor;
    requestId?: string;
    eventId?: string;
    idempotencyKey: string;
    status: "processed" | "noop";
    rollbackFromAnchorId?: string;
    rollbackReason?: string | null;
    semanticSnapshot?: GlossarySemanticSnapshot | null;
  }): Promise<void> {
    const replayRepository = this.getRagReplayRepository();
    if (!replayRepository) {
      return;
    }
    try {
      await replayRepository.writeReplay({
        runId: input.runId,
        replayKey: input.replayKey,
        datasourceId: input.anchor.datasourceId ?? "global",
        stage: input.stage,
        payload: {
          eventId: input.eventId ?? `${input.stage}:${input.anchor.id}`,
          eventType:
            input.stage === "glossary_anchor_release"
              ? "glossary.anchor.created"
              : "glossary.anchor.rollback",
          status: input.status,
          requestId: input.requestId ?? null,
          scope: input.anchor.scope,
          scopeKey: input.anchor.scopeKey,
          datasourceId: input.anchor.datasourceId ?? null,
          anchorId: input.anchor.id,
          anchorType: input.anchor.anchorType,
          anchorVersion: input.anchor.version,
          rollbackFromAnchorId: input.rollbackFromAnchorId ?? null,
          rollbackReason: input.rollbackReason ?? null,
          semanticSnapshot: input.semanticSnapshot
            ? {
                versionId: input.semanticSnapshot.versionId,
                domain: input.semanticSnapshot.domain,
                semanticVersion: input.semanticSnapshot.semanticVersion,
                status: input.semanticSnapshot.status,
                riskTags: input.semanticSnapshot.riskTags
              }
            : null,
          idempotencyKey: input.idempotencyKey,
          occurredAt: new Date().toISOString()
        }
      });
    } catch (error) {
      this.logger.warn(
        `Glossary replay 写入失败（忽略，不阻断主流程）: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async writeAnchorAudit(input: {
    eventId: string;
    runId: string;
    requestId?: string;
    eventType: string;
    eventCode: string;
    severity: "info" | "warning" | "error";
    actor: GlossaryActor | undefined;
    anchor: GlossaryAnchor;
    idempotencyKey: string;
    message: string;
    replayKey?: string;
    rollbackFromAnchorId?: string;
    rollbackReason?: string | null;
    semanticSnapshot?: GlossarySemanticSnapshot | null;
  }): Promise<void> {
    await this.auditLogRepository.appendEvent({
      runId: input.runId,
      requestId: input.requestId,
      phase: "glossary_management",
      severity: input.severity,
      eventType: input.eventType,
      eventCode: input.eventCode,
      message: input.message,
      metadata: {
        eventId: input.eventId,
        replayKey: input.replayKey ?? null,
        actor: {
          id: input.actor?.id ?? "unknown",
          role: input.actor?.role ?? "unknown"
        },
        actorId: input.actor?.id ?? "unknown",
        actorRole: input.actor?.role ?? "unknown",
        scope: input.anchor.scope,
        scopeKey: input.anchor.scopeKey,
        datasourceId: input.anchor.datasourceId ?? null,
        anchorId: input.anchor.id,
        anchorType: input.anchor.anchorType,
        anchorVersion: input.anchor.version,
        rollbackFromAnchorId: input.rollbackFromAnchorId ?? null,
        rollbackReason: input.rollbackReason ?? null,
        semanticSnapshot: input.semanticSnapshot
          ? {
              versionId: input.semanticSnapshot.versionId,
              domain: input.semanticSnapshot.domain,
              semanticVersion: input.semanticSnapshot.semanticVersion,
              status: input.semanticSnapshot.status,
              riskTags: input.semanticSnapshot.riskTags
            }
          : null,
        winnerTerm: null,
        loserTerms: [],
        priority: null,
        idempotencyKey: input.idempotencyKey
      }
    });
  }

  private async writeRollbackRejectedAudit(input: {
    runId: string;
    requestId?: string;
    actor: GlossaryActor | undefined;
    scope: GlossaryScope;
    scopeKey: string;
    datasourceId: string | null;
    targetAnchorId: string;
    rollbackReason?: string | null;
    idempotencyKey: string;
    reasonCode: string;
    reasonMessage: string;
  }): Promise<void> {
    await this.auditLogRepository.appendEvent({
      runId: input.runId,
      requestId: input.requestId,
      phase: "glossary_management",
      severity: "warning",
      eventType: "glossary.anchor.rollback.rejected",
      eventCode: input.reasonCode,
      message: `rollback rejected: ${input.reasonMessage}`,
      metadata: {
        actor: {
          id: input.actor?.id ?? "unknown",
          role: input.actor?.role ?? "unknown"
        },
        actorId: input.actor?.id ?? "unknown",
        actorRole: input.actor?.role ?? "unknown",
        scope: input.scope,
        scopeKey: input.scopeKey,
        datasourceId: input.datasourceId ?? null,
        targetAnchorId: input.targetAnchorId,
        rollbackReason: input.rollbackReason ?? null,
        idempotencyKey: input.idempotencyKey,
        winnerTerm: null,
        loserTerms: [],
        priority: null
      }
    });
  }

  private resolveRunContext(input: {
    scopeKey: string;
    requestId?: string;
    metadata?: Record<string, unknown> | null;
    fallbackSeed?: string;
  }): string {
    const metadataRunId = this.readMetadataRunId(input.metadata);
    if (metadataRunId) {
      return metadataRunId;
    }
    if (input.requestId) {
      return `glossary-run:${input.scopeKey}:${input.requestId}`;
    }
    return `glossary-run:${input.scopeKey}:${input.fallbackSeed ?? Date.now()}`;
  }

  private normalizeTerm(value: string): string {
    const normalized = value.trim();
    if (!normalized) {
      throw new DomainError("VALIDATION_ERROR", "term 不能为空。", 400, {
        field: "term"
      });
    }
    return normalized;
  }

  private normalizeDefinition(value: string): string {
    const normalized = value.trim();
    if (!normalized) {
      throw new DomainError("VALIDATION_ERROR", "definition 不能为空。", 400, {
        field: "definition"
      });
    }
    return normalized;
  }

  private normalizeSynonyms(value: string[] | undefined): string[] {
    if (!value || value.length === 0) {
      return [];
    }
    const deduped = new Set<string>();
    for (const item of value) {
      const normalized = item.trim();
      if (!normalized) {
        continue;
      }
      deduped.add(normalized);
    }
    return Array.from(deduped);
  }

  private normalizeScope(value: string): GlossaryScope {
    const normalized = value.trim().toLowerCase();
    if (!GLOSSARY_SCOPES.has(normalized)) {
      throw new DomainError("VALIDATION_ERROR", "scope 非法。", 400, {
        scope: value
      });
    }
    return normalized as GlossaryScope;
  }

  private normalizeAnchorType(value: string): GlossaryAnchorType {
    const normalized = value.trim().toLowerCase();
    if (!GLOSSARY_ANCHOR_TYPES.has(normalized)) {
      throw new DomainError("VALIDATION_ERROR", "anchorType 非法。", 400, {
        anchorType: value
      });
    }
    return normalized as GlossaryAnchorType;
  }

  private normalizeStatus(value: string): GlossaryTermStatus {
    const normalized = value.trim().toLowerCase();
    if (!GLOSSARY_TERM_STATUSES.has(normalized)) {
      throw new DomainError("VALIDATION_ERROR", "status 非法。", 400, {
        status: value
      });
    }
    return normalized as GlossaryTermStatus;
  }

  private toConflictResolution(value: string): GlossaryConflictResolution {
    if (value === GLOSSARY_CONFLICT_RESOLUTION) {
      return value;
    }
    return GLOSSARY_CONFLICT_RESOLUTION;
  }

  private toAnchorStatus(value: string): "active" | "superseded" | "rolled_back" {
    if (!GLOSSARY_ANCHOR_STATUSES.has(value)) {
      return "active";
    }
    return value as "active" | "superseded" | "rolled_back";
  }

  private normalizePriority(value: number | undefined): number {
    if (value === undefined) {
      return DEFAULT_PRIORITY;
    }
    if (!Number.isInteger(value) || value < MIN_PRIORITY || value > MAX_PRIORITY) {
      throw new DomainError(
        "VALIDATION_ERROR",
        `priority 必须为 ${MIN_PRIORITY}-${MAX_PRIORITY} 之间的整数。`,
        400,
        {
          priority: value
        }
      );
    }
    return value;
  }

  private normalizeVersion(value: number): number {
    if (!Number.isInteger(value) || value <= 0) {
      throw new DomainError("VALIDATION_ERROR", "version 必须是正整数。", 400, {
        version: value
      });
    }
    return value;
  }

  private async normalizeDatasourceId(
    scope: GlossaryScope,
    datasourceIdRaw: string | undefined
  ): Promise<string | null> {
    const datasourceId = datasourceIdRaw?.trim() || undefined;
    if (scope === "global") {
      if (datasourceId) {
        throw new DomainError(
          "VALIDATION_ERROR",
          "global scope 不允许指定 datasourceId。",
          400,
          {
            scope,
            datasourceId
          }
        );
      }
      return null;
    }
    if (!datasourceId) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "datasource scope 必须指定 datasourceId。",
        400,
        {
          scope
        }
      );
    }
    const datasource = await this.datasourceRepository.getDatasourceById(datasourceId, {
      includeDeleted: true
    });
    if (!datasource || datasource.status === "deleted") {
      throw new DomainError("DATASOURCE_NOT_FOUND", "数据源不存在或已删除。", 404, {
        datasourceId
      });
    }
    return datasourceId;
  }

  private buildScopeKey(scope: GlossaryScope, datasourceId: string | null): string {
    if (scope === "global") {
      return "global";
    }
    return datasourceId ?? "global";
  }

  private normalizeMetadata(
    metadata: Record<string, unknown> | null | undefined
  ): Record<string, unknown> | null {
    if (!metadata || typeof metadata !== "object") {
      return null;
    }
    return metadata;
  }

  private normalizeOptionalSummary(summary: string | undefined): string | null {
    if (summary === undefined) {
      return null;
    }
    const normalized = summary.trim();
    if (!normalized) {
      return null;
    }
    if (normalized.length > 300) {
      throw new DomainError("VALIDATION_ERROR", "summary 长度不能超过 300。", 400);
    }
    return normalized;
  }

  private readMetadataRunId(
    metadata: Record<string, unknown> | null | undefined
  ): string | undefined {
    if (!metadata) {
      return undefined;
    }
    const value = metadata.runId;
    if (typeof value !== "string") {
      return undefined;
    }
    const normalized = value.trim();
    return normalized || undefined;
  }

  private parseMetadata(value: string | null): Record<string, unknown> | null {
    if (!value) {
      return null;
    }
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch (error) {
      this.logger.warn(
        `Glossary metadata 反序列化失败: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }

  private normalizePage(page: number | undefined): number {
    if (!page || !Number.isInteger(page) || page < 1) {
      return DEFAULT_PAGE;
    }
    return page;
  }

  private normalizePageSize(pageSize: number | undefined): number {
    if (!pageSize || !Number.isInteger(pageSize) || pageSize < 1) {
      return DEFAULT_PAGE_SIZE;
    }
    return Math.min(pageSize, MAX_PAGE_SIZE);
  }

  private normalizeIdempotencyKey(
    raw: string | undefined,
    fallbackSuffix: string
  ): string {
    const normalized = raw?.trim();
    if (!normalized) {
      return `glossary:${fallbackSuffix}:${Date.now()}`;
    }
    if (normalized.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new DomainError(
        "VALIDATION_ERROR",
        `x-idempotency-key 长度不能超过 ${MAX_IDEMPOTENCY_KEY_LENGTH}。`,
        400
      );
    }
    return normalized;
  }

  private getSemanticRegistryService(): SemanticRegistryService | undefined {
    if (this.semanticRegistryService) {
      return this.semanticRegistryService;
    }
    if (!this.moduleRef) {
      return undefined;
    }
    this.semanticRegistryService = this.moduleRef.get(SemanticRegistryService, {
      strict: false
    });
    return this.semanticRegistryService;
  }

  private getRagReplayRepository(): RagReplayRepository | undefined {
    if (this.ragReplayRepository) {
      return this.ragReplayRepository;
    }
    if (!this.moduleRef) {
      return undefined;
    }
    this.ragReplayRepository = this.moduleRef.get(RagReplayRepository, {
      strict: false
    });
    return this.ragReplayRepository;
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
        `Glossary 读取失败，回退内存结果: ${
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
        `Glossary 写入失败，仅保留内存数据: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return false;
    }
  }
}
