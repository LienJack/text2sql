import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "../../common/domain-error";
import { AppConfigService } from "../config/app-config.service";

export const SEMANTIC_VERSION_NOT_FOUND_REASON = "semantic_version_not_found";
export const SEMANTIC_TERM_NOT_FOUND_REASON = "semantic_term_not_found";
export const SEMANTIC_REGISTRY_DEGRADED_RISK_TAG = "semantic_registry_degraded";

export type SemanticRegistryVersionStatus = "active" | "deprecated";

export interface SemanticRegistryTermInput {
  term: string;
  canonicalKey: string;
  definition: string;
  binding: string;
  metadata?: string;
}

export interface PublishSemanticRegistryVersionInput {
  domain: string;
  semanticVersion?: number;
  releaseSummary: string;
  auditSummary: string;
  terms: SemanticRegistryTermInput[];
  riskTags?: string[];
  publishedByRunId?: string;
  activatedByRunId?: string;
  activatedAt?: string;
  status?: SemanticRegistryVersionStatus;
}

export interface SemanticRegistryVersionRecord {
  id: string;
  domain: string;
  semanticVersion: number;
  status: SemanticRegistryVersionStatus;
  releaseSummary: string;
  auditSummary: string;
  riskTags: string[];
  publishedByRunId?: string;
  activatedByRunId?: string;
  activatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SemanticRegistryTermRecord {
  id: string;
  versionId: string;
  domain: string;
  term: string;
  canonicalKey: string;
  definition: string;
  binding: string;
  metadata?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SemanticRegistryLookupInput {
  domain: string;
  term: string;
  semanticVersion?: number;
  datasourceId?: string;
}

export interface SemanticRegistryLookupResult {
  status: "ready" | "degraded";
  semantic_version?: number;
  term?: {
    term: string;
    canonical_key: string;
    definition: string;
    binding: string;
    metadata?: string;
  };
  release_summary?: string;
  audit_summary?: string;
  published_by_run_id?: string;
  activated_by_run_id?: string;
  activated_at?: string;
  degrade_reason?: string;
  risk_tags: string[];
  matched_scope?: "datasource" | "global";
  matched_domain?: string;
}

export interface PublishGlossaryAnchorSemanticInput {
  scope: "global" | "datasource";
  scopeKey?: string;
  datasourceId?: string | null;
  anchorId: string;
  anchorType?: "release" | "rollback";
  glossaryVersion: number;
  summary?: string | null;
  rollbackFromAnchorId?: string | null;
  rollbackReason?: string | null;
  runId?: string;
  terms: Array<{
    term: string;
    definition: string;
    synonyms?: string[];
    priority: number;
    updatedAt: string;
  }>;
}

type PrismaClientLike = {
  semanticRegistryVersion?: {
    create?: (args: Record<string, unknown>) => Promise<unknown>;
    updateMany?: (args: Record<string, unknown>) => Promise<{ count: number }>;
    findMany?: (args: Record<string, unknown>) => Promise<unknown[]>;
    findFirst?: (args: Record<string, unknown>) => Promise<unknown>;
  };
  semanticRegistryTerm?: {
    createMany?: (args: Record<string, unknown>) => Promise<{ count: number }>;
    findMany?: (args: Record<string, unknown>) => Promise<unknown[]>;
  };
  $transaction?: <T>(fn: (tx: PrismaTransactionClientLike) => Promise<T>) => Promise<T>;
  $disconnect: () => Promise<void>;
};

type PrismaTransactionClientLike = Omit<PrismaClientLike, "$disconnect" | "$transaction">;

type SemanticRegistryVersionRow = {
  id: string;
  domain: string;
  semanticVersion: number;
  status: string;
  releaseSummary: string;
  auditSummary: string;
  riskTags: string[];
  publishedByRunId: string | null;
  activatedByRunId: string | null;
  activatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type SemanticRegistryTermRow = {
  id: string;
  versionId: string;
  domain: string;
  term: string;
  canonicalKey: string;
  definition: string;
  binding: string;
  metadata: string | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class SemanticRegistryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SemanticRegistryService.name);
  private prisma?: PrismaClientLike;
  private readonly versionsByDomain = new Map<string, SemanticRegistryVersionRecord[]>();
  private readonly termsByVersion = new Map<string, SemanticRegistryTermRecord[]>();

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
      this.logger.log("Semantic Registry 已启用 PostgreSQL 持久化。");
    } catch (error) {
      this.logger.warn(
        `Semantic Registry 初始化失败，降级为内存模式: ${
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

  async publishVersion(
    input: PublishSemanticRegistryVersionInput
  ): Promise<SemanticRegistryVersionRecord> {
    const domain = this.normalize(input.domain);
    if (!domain) {
      throw new DomainError("SEMANTIC_REGISTRY_DOMAIN_REQUIRED", "domain 不能为空", 400);
    }
    if (input.terms.length === 0) {
      throw new DomainError("SEMANTIC_REGISTRY_TERMS_REQUIRED", "terms 不能为空", 400);
    }

    const latest = await this.getLatestVersion(domain);
    const semanticVersion = input.semanticVersion ?? (latest?.semanticVersion ?? 0) + 1;
    if (!Number.isInteger(semanticVersion) || semanticVersion <= 0) {
      throw new DomainError(
        "SEMANTIC_REGISTRY_VERSION_INVALID",
        "semanticVersion 必须是正整数",
        400,
        { semanticVersion }
      );
    }
    if (latest && semanticVersion <= latest.semanticVersion) {
      throw new DomainError(
        "SEMANTIC_REGISTRY_VERSION_NOT_MONOTONIC",
        "semanticVersion 必须单调递增",
        409,
        {
          latestSemanticVersion: latest.semanticVersion,
          requestedSemanticVersion: semanticVersion
        }
      );
    }

    const now = new Date().toISOString();
    const status = input.status ?? "active";
    const version: SemanticRegistryVersionRecord = {
      id: uuidv4(),
      domain,
      semanticVersion,
      status,
      releaseSummary: input.releaseSummary.trim(),
      auditSummary: input.auditSummary.trim(),
      riskTags: this.unique(input.riskTags ?? []),
      publishedByRunId: this.normalizeOptional(input.publishedByRunId),
      activatedByRunId: this.normalizeOptional(input.activatedByRunId),
      activatedAt: input.activatedAt ? this.toIso(input.activatedAt) : undefined,
      createdAt: now,
      updatedAt: now
    };

    const terms = input.terms.map((term) => this.toTermRecord(version, term, now));
    this.upsertVersionInMemory(version, terms);

    const versionModel = this.prisma?.semanticRegistryVersion;
    const termModel = this.prisma?.semanticRegistryTerm;
    const tx = this.prisma?.$transaction;
    if (
      this.isPrimaryPersistenceConfigured() &&
      this.prisma &&
      tx &&
      versionModel?.create &&
      termModel?.createMany &&
      versionModel.updateMany
    ) {
      await this.tryPrismaWrite(async () => {
        await tx(async (trx) => {
          if (status === "active") {
            await trx.semanticRegistryVersion?.updateMany?.({
              where: {
                domain: version.domain,
                status: "active"
              },
              data: {
                status: "deprecated"
              }
            });
          }
          await trx.semanticRegistryVersion?.create?.({
            data: {
              id: version.id,
              domain: version.domain,
              semanticVersion: version.semanticVersion,
              status: version.status,
              releaseSummary: version.releaseSummary,
              auditSummary: version.auditSummary,
              riskTags: version.riskTags,
              publishedByRunId: version.publishedByRunId ?? null,
              activatedByRunId: version.activatedByRunId ?? null,
              activatedAt: version.activatedAt ? new Date(version.activatedAt) : null,
              createdAt: new Date(version.createdAt),
              updatedAt: new Date(version.updatedAt)
            }
          });
          await trx.semanticRegistryTerm?.createMany?.({
            data: terms.map((term) => ({
              id: term.id,
              versionId: term.versionId,
              domain: term.domain,
              term: term.term,
              canonicalKey: term.canonicalKey,
              definition: term.definition,
              binding: term.binding,
              metadata: term.metadata ?? null,
              createdAt: new Date(term.createdAt),
              updatedAt: new Date(term.updatedAt)
            }))
          });
        });
      });
    }

    return { ...version };
  }

  async resolveTerm(input: SemanticRegistryLookupInput): Promise<SemanticRegistryLookupResult> {
    const domain = this.normalize(input.domain);
    const term = this.normalize(input.term);
    if (!domain || !term) {
      return {
        status: "degraded",
        degrade_reason: SEMANTIC_VERSION_NOT_FOUND_REASON,
        risk_tags: [SEMANTIC_REGISTRY_DEGRADED_RISK_TAG],
        matched_scope: "global"
      };
    }
    const lookupDomains = this.buildLookupDomains(domain, input.datasourceId);
    let lastVersion: SemanticRegistryVersionRecord | undefined;
    let lastMatchedDomain: string | undefined;
    let lastMissingReason: "version" | "term" = "version";

    for (const lookupDomain of lookupDomains) {
      const version =
        typeof input.semanticVersion === "number"
          ? await this.getVersion(lookupDomain, input.semanticVersion)
          : await this.getActiveVersion(lookupDomain);
      if (!version) {
        continue;
      }
      lastVersion = version;
      lastMatchedDomain = lookupDomain;

      const terms = await this.listTermsByVersion(version.id);
      const matchedTerm = terms.find((item) => this.normalize(item.term) === term);
      if (!matchedTerm) {
        lastMissingReason = "term";
        continue;
      }

      return {
        status: "ready",
        semantic_version: version.semanticVersion,
        term: {
          term: matchedTerm.term,
          canonical_key: matchedTerm.canonicalKey,
          definition: matchedTerm.definition,
          binding: matchedTerm.binding,
          metadata: matchedTerm.metadata
        },
        release_summary: version.releaseSummary,
        audit_summary: version.auditSummary,
        published_by_run_id: version.publishedByRunId,
        activated_by_run_id: version.activatedByRunId,
        activated_at: version.activatedAt,
        risk_tags: version.riskTags,
        matched_scope:
          lookupDomain === domain ? "global" : "datasource",
        matched_domain: lookupDomain
      };
    }

    if (!lastVersion) {
      return {
        status: "degraded",
        semantic_version: input.semanticVersion,
        degrade_reason: SEMANTIC_VERSION_NOT_FOUND_REASON,
        risk_tags: [SEMANTIC_REGISTRY_DEGRADED_RISK_TAG],
        matched_scope: "global",
        matched_domain: domain
      };
    }

    return {
      status: "degraded",
      semantic_version: lastVersion.semanticVersion,
      release_summary: lastVersion.releaseSummary,
      audit_summary: lastVersion.auditSummary,
      published_by_run_id: lastVersion.publishedByRunId,
      activated_by_run_id: lastVersion.activatedByRunId,
      activated_at: lastVersion.activatedAt,
      degrade_reason:
        lastMissingReason === "term"
          ? SEMANTIC_TERM_NOT_FOUND_REASON
          : SEMANTIC_VERSION_NOT_FOUND_REASON,
      risk_tags: [SEMANTIC_REGISTRY_DEGRADED_RISK_TAG],
      matched_scope: lastMatchedDomain === domain ? "global" : "datasource",
      matched_domain: lastMatchedDomain ?? domain
    };
  }

  async publishGlossaryAnchorSemantic(
    input: PublishGlossaryAnchorSemanticInput
  ): Promise<SemanticRegistryVersionRecord | null> {
    const anchorId = this.normalizeOptional(input.anchorId);
    if (!anchorId) {
      throw new DomainError("SEMANTIC_REGISTRY_ANCHOR_ID_REQUIRED", "anchorId 不能为空", 400);
    }
    if (!Number.isInteger(input.glossaryVersion) || input.glossaryVersion <= 0) {
      throw new DomainError(
        "SEMANTIC_REGISTRY_GLOSSARY_VERSION_INVALID",
        "glossaryVersion 必须是正整数",
        400,
        {
          glossaryVersion: input.glossaryVersion
        }
      );
    }

    if (input.scope === "datasource" && !this.normalizeOptional(input.datasourceId ?? undefined)) {
      throw new DomainError(
        "SEMANTIC_REGISTRY_DATASOURCE_REQUIRED",
        "datasource scope 必须指定 datasourceId",
        400
      );
    }

    const domain =
      input.scope === "datasource"
        ? this.buildDatasourceScopedDomain("semantic_term", input.datasourceId ?? "")
        : "semantic_term";
    if (!domain) {
      return null;
    }

    const terms = input.terms
      .map<SemanticRegistryTermInput | null>((item) => {
        const normalizedTerm = this.normalizeOptional(item.term);
        const normalizedDefinition = this.normalizeOptional(item.definition);
        if (!normalizedTerm || !normalizedDefinition) {
          return null;
        }
        const synonyms = Array.isArray(item.synonyms)
          ? Array.from(
              new Set(
                item.synonyms
                  .map((candidate) => this.normalizeOptional(candidate))
                  .filter((candidate): candidate is string => Boolean(candidate))
              )
            )
          : [];
        const scopedKey =
          input.scope === "datasource"
            ? `datasource.${(input.datasourceId ?? "unknown").trim().toLowerCase()}`
            : "global";

        return {
          term: normalizedTerm,
          canonicalKey: `glossary.${scopedKey}.${normalizedTerm}`,
          definition: normalizedDefinition,
          binding: JSON.stringify({
            source: "glossary_anchor",
            glossaryVersion: input.glossaryVersion,
            anchorId,
            anchorType: input.anchorType ?? "release",
            scope: input.scope,
            scopeKey: input.scopeKey ?? null,
            datasourceId: input.datasourceId ?? null,
            priority: Number.isFinite(item.priority) ? Math.floor(item.priority) : 50,
            updatedAt: item.updatedAt
          }),
          metadata: JSON.stringify({
            synonyms,
            summary: input.summary ?? null,
            anchorType: input.anchorType ?? "release",
            scopeKey: input.scopeKey ?? null,
            rollbackFromAnchorId: input.rollbackFromAnchorId ?? null,
            rollbackReason: input.rollbackReason ?? null
          })
        };
      })
      .filter((item): item is SemanticRegistryTermInput => item !== null);

    if (terms.length === 0) {
      return null;
    }

    const isRollbackOperation =
      input.anchorType === "rollback" || Boolean(input.rollbackFromAnchorId);
    const scopeTag =
      input.scope === "datasource"
        ? `glossary_scope:datasource:${(input.datasourceId ?? "unknown").trim().toLowerCase()}`
        : "glossary_scope:global";

    return this.publishVersion({
      domain,
      releaseSummary:
        isRollbackOperation
          ? `rollback glossary anchor ${anchorId} to ${input.rollbackFromAnchorId ?? "unknown"}`
          : `release glossary anchor ${anchorId}`,
      auditSummary: `glossary anchor semantic snapshot (anchor=${anchorId}, version=${input.glossaryVersion}, scope=${input.scope}, scopeKey=${input.scopeKey ?? scopeTag})`,
      riskTags: [
        "glossary_anchor_semantic_snapshot",
        `glossary_anchor_id:${anchorId}`,
        `glossary_anchor_type:${input.anchorType ?? "release"}`,
        scopeTag,
        ...(input.rollbackFromAnchorId
          ? ["glossary_anchor_rollback", `glossary_rollback_from:${input.rollbackFromAnchorId}`]
          : [])
      ],
      publishedByRunId: this.normalizeOptional(input.runId),
      activatedByRunId: this.normalizeOptional(input.runId),
      terms
    });
  }

  private toTermRecord(
    version: SemanticRegistryVersionRecord,
    input: SemanticRegistryTermInput,
    now: string
  ): SemanticRegistryTermRecord {
    const normalizedTerm = this.normalize(input.term);
    if (!normalizedTerm) {
      throw new DomainError("SEMANTIC_REGISTRY_TERM_REQUIRED", "term 不能为空", 400);
    }
    const canonicalKey = input.canonicalKey.trim();
    if (!canonicalKey) {
      throw new DomainError(
        "SEMANTIC_REGISTRY_CANONICAL_KEY_REQUIRED",
        "canonicalKey 不能为空",
        400
      );
    }
    const definition = input.definition.trim();
    if (!definition) {
      throw new DomainError("SEMANTIC_REGISTRY_DEFINITION_REQUIRED", "definition 不能为空", 400);
    }
    const binding = input.binding.trim();
    if (!binding) {
      throw new DomainError("SEMANTIC_REGISTRY_BINDING_REQUIRED", "binding 不能为空", 400);
    }
    return {
      id: uuidv4(),
      versionId: version.id,
      domain: version.domain,
      term: normalizedTerm,
      canonicalKey,
      definition,
      binding,
      metadata: this.normalizeOptional(input.metadata),
      createdAt: now,
      updatedAt: now
    };
  }

  private upsertVersionInMemory(
    version: SemanticRegistryVersionRecord,
    terms: SemanticRegistryTermRecord[]
  ): void {
    const versions = this.versionsByDomain.get(version.domain) ?? [];
    const updated = versions
      .filter((item) => item.semanticVersion !== version.semanticVersion)
      .map((item) =>
        version.status === "active" && item.status === "active"
          ? { ...item, status: "deprecated" as const, updatedAt: version.updatedAt }
          : item
      );
    updated.push({ ...version });
    updated.sort((left, right) => left.semanticVersion - right.semanticVersion);
    this.versionsByDomain.set(version.domain, updated);
    this.termsByVersion.set(
      version.id,
      terms.map((item) => ({ ...item }))
    );
  }

  private async listTermsByVersion(versionId: string): Promise<SemanticRegistryTermRecord[]> {
    const memory = this.termsByVersion.get(versionId);
    if (memory) {
      return memory.map((item) => ({ ...item }));
    }

    const termModel = this.prisma?.semanticRegistryTerm;
    if (!this.isPrimaryPersistenceConfigured() || !this.prisma || !termModel?.findMany) {
      return [];
    }

    const rows = (await this.tryPrismaRead(async () =>
      termModel.findMany?.({
        where: { versionId },
        orderBy: [{ term: "asc" }]
      })
    )) as SemanticRegistryTermRow[] | null;
    if (!rows) {
      return [];
    }
    const records = rows.map((row) => this.fromTermRow(row));
    this.termsByVersion.set(versionId, records);
    return records.map((item) => ({ ...item }));
  }

  private async getActiveVersion(domain: string): Promise<SemanticRegistryVersionRecord | undefined> {
    const versions = await this.listVersions(domain);
    const active = versions
      .filter((item) => item.status === "active")
      .sort((left, right) => right.semanticVersion - left.semanticVersion)
      .at(0);
    return active ? { ...active } : undefined;
  }

  private async getLatestVersion(domain: string): Promise<SemanticRegistryVersionRecord | undefined> {
    const versions = await this.listVersions(domain);
    if (versions.length === 0) {
      return undefined;
    }
    const sorted = [...versions].sort(
      (left, right) => right.semanticVersion - left.semanticVersion
    );
    return { ...sorted[0] };
  }

  private async getVersion(
    domain: string,
    semanticVersion: number
  ): Promise<SemanticRegistryVersionRecord | undefined> {
    const versions = await this.listVersions(domain);
    const matched = versions.find((item) => item.semanticVersion === semanticVersion);
    return matched ? { ...matched } : undefined;
  }

  private async listVersions(domain: string): Promise<SemanticRegistryVersionRecord[]> {
    const memory = this.versionsByDomain.get(domain);
    if (memory) {
      return memory.map((item) => ({ ...item }));
    }

    const versionModel = this.prisma?.semanticRegistryVersion;
    if (!this.isPrimaryPersistenceConfigured() || !this.prisma || !versionModel?.findMany) {
      return [];
    }

    const rows = (await this.tryPrismaRead(async () =>
      versionModel.findMany?.({
        where: { domain },
        orderBy: [{ semanticVersion: "asc" }]
      })
    )) as SemanticRegistryVersionRow[] | null;
    if (!rows) {
      return [];
    }
    const versions = rows.map((row) => this.fromVersionRow(row));
    this.versionsByDomain.set(domain, versions);
    return versions.map((item) => ({ ...item }));
  }

  private fromVersionRow(row: SemanticRegistryVersionRow): SemanticRegistryVersionRecord {
    return {
      id: row.id,
      domain: row.domain,
      semanticVersion: row.semanticVersion,
      status: row.status === "active" ? "active" : "deprecated",
      releaseSummary: row.releaseSummary,
      auditSummary: row.auditSummary,
      riskTags: Array.isArray(row.riskTags) ? row.riskTags : [],
      publishedByRunId: row.publishedByRunId ?? undefined,
      activatedByRunId: row.activatedByRunId ?? undefined,
      activatedAt: row.activatedAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private fromTermRow(row: SemanticRegistryTermRow): SemanticRegistryTermRecord {
    return {
      id: row.id,
      versionId: row.versionId,
      domain: row.domain,
      term: row.term,
      canonicalKey: row.canonicalKey,
      definition: row.definition,
      binding: row.binding,
      metadata: row.metadata ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
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

  private toIso(input: string): string {
    const parsed = Date.parse(input);
    if (Number.isNaN(parsed)) {
      throw new DomainError(
        "SEMANTIC_REGISTRY_INVALID_TIMESTAMP",
        `非法时间格式: ${input}`,
        400
      );
    }
    return new Date(parsed).toISOString();
  }

  private unique(values: string[]): string[] {
    return Array.from(
      new Set(values.map((item) => item.trim()).filter((item) => item.length > 0))
    );
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
        `Semantic Registry 读取失败，回退内存模式: ${
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
        `Semantic Registry 写入失败，回退内存模式: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }
}
