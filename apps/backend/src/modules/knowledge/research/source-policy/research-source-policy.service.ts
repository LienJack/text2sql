import { Injectable } from "@nestjs/common";
import { isIP } from "node:net";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "../../../../common/domain-error";
import { AppConfigService } from "../../../config/app-config.service";
import {
  AnalysisLedgerPrismaService,
  type AnalysisPrismaClient
} from "../../../platform/data/persistence/analysis-ledger-prisma.service";
import {
  parseJson,
  sha256Digest,
  stableJson
} from "../../../platform/data/persistence/analysis-ledger.util";
import type {
  ResearchConnectorConfigRecord,
  ResearchSourcePolicyRecord
} from "../contracts/research.types";

type ConnectorRow = {
  id: string;
  workspaceId: string;
  provider: string;
  version: number;
  status: string;
  baseUrl: string | null;
  hasApiKey: boolean;
  apiKeyMasked: string | null;
  configDigest: string;
  metadata: string;
  createdByActorId: string;
  createdAt: Date;
  updatedAt: Date;
};

type PolicyRow = {
  id: string;
  workspaceId: string;
  connectorConfigId: string;
  version: number;
  status: string;
  allowedDomains: string[];
  deniedDomains: string[];
  allowedQueryParams: string[];
  allowedMimeTypes: string[];
  maxRedirects: number;
  maxContentBytes: number;
  retentionDays: number;
  minIndependentSources: number;
  requireCounterEvidence: boolean;
  policyDigest: string;
  createdByActorId: string;
  effectiveAt: Date;
  createdAt: Date;
  updatedAt: Date;
  connectorConfig?: ConnectorRow;
};

const SENSITIVE_QUERY_KEYS = new Set([
  "access_token",
  "api_key",
  "apikey",
  "auth",
  "authorization",
  "credential",
  "key",
  "password",
  "secret",
  "sig",
  "signature",
  "token"
]);

@Injectable()
export class ResearchSourcePolicyService {
  constructor(
    private readonly prisma: AnalysisLedgerPrismaService,
    private readonly config: AppConfigService
  ) {}

  async resolveActivePolicy(
    workspaceId: string,
    actorId: string
  ): Promise<ResearchSourcePolicyRecord> {
    let row = await this.findActivePolicy(workspaceId);
    if (!row && this.config.analysisResearchAllowedDomains.length > 0) {
      const connector = await this.configureConnector({ workspaceId, actorId });
      await this.createPolicy({
        workspaceId,
        actorId,
        connectorConfigId: connector.id,
        allowedDomains: this.config.analysisResearchAllowedDomains
      });
      row = await this.findActivePolicy(workspaceId);
    }
    if (!row || !row.connectorConfig) {
      throw new DomainError(
        "RESEARCH_SOURCE_POLICY_REQUIRED",
        "Workspace 没有 active ResearchSourcePolicy。",
        409
      );
    }
    const mapped = this.mapPolicy(row);
    this.assertPolicyDigest(mapped);
    if (
      mapped.connector.status !== "active" ||
      mapped.connector.provider !== this.config.analysisResearchProvider
    ) {
      throw new DomainError(
        "RESEARCH_CONNECTOR_CONFIG_STALE",
        "Research source policy 未绑定 active connector config。",
        409
      );
    }
    return mapped;
  }

  async configureConnector(input: {
    workspaceId: string;
    actorId: string;
    baseUrl?: string;
  }): Promise<ResearchConnectorConfigRecord> {
    const provider = this.config.analysisResearchProvider;
    const baseUrl = input.baseUrl?.trim() || this.config.tavilyApiBaseUrl || null;
    const metadata = {
      answerMode: "disabled",
      extractionMode: "policy_filtered_urls_only",
      secretSource: this.config.tavilyApiKey ? "environment" : "unavailable"
    };
    const configDigest = sha256Digest(
      stableJson({ provider, baseUrl, metadata, hasApiKey: Boolean(this.config.tavilyApiKey) })
    );
    const row = await this.prisma.transaction(async (transaction) => {
      const current = (await transaction.researchConnectorConfig.findFirst({
        where: { workspaceId: input.workspaceId, provider, status: "active" },
        orderBy: { version: "desc" }
      })) as ConnectorRow | null;
      if (current?.configDigest === configDigest) {
        return current;
      }
      if (current) {
        await transaction.researchConnectorConfig.updateMany({
          where: { workspaceId: input.workspaceId, provider, status: "active" },
          data: { status: "superseded" }
        });
      }
      return (await transaction.researchConnectorConfig.create({
        data: {
          id: uuidv4(),
          workspaceId: input.workspaceId,
          provider,
          version: (current?.version ?? 0) + 1,
          status: "active",
          baseUrl,
          hasApiKey: Boolean(this.config.tavilyApiKey),
          apiKeyMasked: maskApiKey(this.config.tavilyApiKey),
          configDigest,
          metadata: stableJson(metadata),
          createdByActorId: input.actorId
        }
      })) as ConnectorRow;
    });
    return this.mapConnector(row);
  }

  async createPolicy(input: {
    workspaceId: string;
    actorId: string;
    connectorConfigId: string;
    allowedDomains: string[];
    deniedDomains?: string[];
    allowedQueryParams?: string[];
    allowedMimeTypes?: string[];
    maxRedirects?: number;
    maxContentBytes?: number;
    retentionDays?: number;
    minIndependentSources?: number;
    requireCounterEvidence?: boolean;
  }): Promise<ResearchSourcePolicyRecord> {
    const values = this.normalizePolicyInput(input);
    const row = await this.prisma.transaction(async (transaction) => {
      const connector = (await transaction.researchConnectorConfig.findUnique({
        where: { id: input.connectorConfigId }
      })) as ConnectorRow | null;
      if (
        !connector ||
        connector.workspaceId !== input.workspaceId ||
        connector.status !== "active"
      ) {
        throw new DomainError(
          "RESEARCH_CONNECTOR_CONFIG_STALE",
          "Policy 必须绑定当前 Workspace 的 active connector config。",
          409
        );
      }
      const current = (await transaction.researchSourcePolicy.findFirst({
        where: { workspaceId: input.workspaceId, status: "active" },
        orderBy: { version: "desc" },
        include: { connectorConfig: true }
      })) as PolicyRow | null;
      if (current?.policyDigest === values.policyDigest) {
        return current;
      }
      if (current) {
        await transaction.researchSourcePolicy.updateMany({
          where: { workspaceId: input.workspaceId, status: "active" },
          data: { status: "superseded" }
        });
      }
      const created = (await transaction.researchSourcePolicy.create({
        data: {
          id: uuidv4(),
          workspaceId: input.workspaceId,
          connectorConfigId: input.connectorConfigId,
          version: (current?.version ?? 0) + 1,
          status: "active",
          ...values,
          createdByActorId: input.actorId
        }
      })) as PolicyRow;
      created.connectorConfig = connector;
      return created;
    });
    return this.mapPolicy(row);
  }

  authorizeUrl(rawUrl: string, policy: ResearchSourcePolicyRecord): {
    canonicalUrl: string;
    locator: string;
    hostname: string;
  } {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw urlPolicyError("research_url_invalid");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw urlPolicyError("research_url_scheme_denied");
    }
    if (url.username || url.password) {
      throw urlPolicyError("research_url_credentials_denied");
    }
    const hostname = normalizeDomain(url.hostname);
    if (isPrivateOrLocalHost(hostname)) {
      throw urlPolicyError("research_url_private_target_denied");
    }
    if (
      policy.deniedDomains.some((domain) => domainMatches(hostname, domain)) ||
      !policy.allowedDomains.some((domain) => domainMatches(hostname, domain))
    ) {
      throw urlPolicyError("research_url_domain_denied");
    }
    const allowedQueryParams = new Set(
      policy.allowedQueryParams.map((key) => key.toLowerCase())
    );
    for (const key of [...url.searchParams.keys()]) {
      const normalizedKey = key.toLowerCase();
      if (SENSITIVE_QUERY_KEYS.has(normalizedKey)) {
        throw urlPolicyError("research_url_sensitive_query_denied");
      }
      if (!allowedQueryParams.has(normalizedKey)) {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    url.hostname = hostname;
    const canonicalUrl = url.toString();
    return { canonicalUrl, locator: canonicalUrl, hostname };
  }

  private async findActivePolicy(workspaceId: string): Promise<PolicyRow | null> {
    return (await this.prisma.requireClient().researchSourcePolicy.findFirst({
      where: {
        workspaceId,
        status: "active",
        effectiveAt: { lte: new Date() }
      },
      orderBy: { version: "desc" },
      include: { connectorConfig: true }
    })) as PolicyRow | null;
  }

  private normalizePolicyInput(input: {
    connectorConfigId: string;
    allowedDomains: string[];
    deniedDomains?: string[];
    allowedQueryParams?: string[];
    allowedMimeTypes?: string[];
    maxRedirects?: number;
    maxContentBytes?: number;
    retentionDays?: number;
    minIndependentSources?: number;
    requireCounterEvidence?: boolean;
  }) {
    const allowedDomains = uniqueDomains(input.allowedDomains);
    if (allowedDomains.length === 0) {
      throw new DomainError(
        "RESEARCH_SOURCE_ALLOWLIST_REQUIRED",
        "Research source policy 至少需要一个 allowed domain。",
        400
      );
    }
    const normalized = {
      allowedDomains,
      deniedDomains: uniqueDomains(input.deniedDomains ?? []),
      allowedQueryParams: uniqueStrings(input.allowedQueryParams ?? []),
      allowedMimeTypes: uniqueStrings(
        input.allowedMimeTypes ?? ["text/markdown", "text/plain"]
      ),
      maxRedirects: boundedInteger(input.maxRedirects ?? 2, 0, 5),
      maxContentBytes: boundedInteger(
        input.maxContentBytes ?? this.config.analysisResearchMaxContentBytes,
        1,
        this.config.analysisTaskArtifactMaxBytes
      ),
      retentionDays: boundedInteger(
        input.retentionDays ?? this.config.analysisResearchDefaultRetentionDays,
        1,
        365
      ),
      minIndependentSources: boundedInteger(
        input.minIndependentSources ?? 2,
        1,
        10
      ),
      requireCounterEvidence: input.requireCounterEvidence ?? true
    };
    return {
      ...normalized,
      policyDigest: sha256Digest(
        stableJson({ connectorConfigId: input.connectorConfigId, ...normalized })
      )
    };
  }

  private assertPolicyDigest(policy: ResearchSourcePolicyRecord): void {
    const digest = sha256Digest(
      stableJson({
        connectorConfigId: policy.connectorConfigId,
        allowedDomains: policy.allowedDomains,
        deniedDomains: policy.deniedDomains,
        allowedQueryParams: policy.allowedQueryParams,
        allowedMimeTypes: policy.allowedMimeTypes,
        maxRedirects: policy.maxRedirects,
        maxContentBytes: policy.maxContentBytes,
        retentionDays: policy.retentionDays,
        minIndependentSources: policy.minIndependentSources,
        requireCounterEvidence: policy.requireCounterEvidence
      })
    );
    if (digest !== policy.policyDigest) {
      throw new DomainError(
        "RESEARCH_SOURCE_POLICY_DIGEST_MISMATCH",
        "Research source policy digest 不匹配。",
        409
      );
    }
  }

  private mapConnector(row: ConnectorRow): ResearchConnectorConfigRecord {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      provider: "tavily",
      version: row.version,
      status: toConnectorStatus(row.status),
      baseUrl: row.baseUrl,
      hasApiKey: row.hasApiKey,
      apiKeyMasked: row.apiKeyMasked,
      configDigest: row.configDigest,
      metadata: parseJson(row.metadata, {}),
      createdByActorId: row.createdByActorId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private mapPolicy(row: PolicyRow): ResearchSourcePolicyRecord {
    if (!row.connectorConfig) {
      throw new DomainError(
        "RESEARCH_CONNECTOR_CONFIG_STALE",
        "Research policy 缺少 connector config。",
        409
      );
    }
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      connectorConfigId: row.connectorConfigId,
      version: row.version,
      status: toPolicyStatus(row.status),
      allowedDomains: row.allowedDomains,
      deniedDomains: row.deniedDomains,
      allowedQueryParams: row.allowedQueryParams,
      allowedMimeTypes: row.allowedMimeTypes,
      maxRedirects: row.maxRedirects,
      maxContentBytes: row.maxContentBytes,
      retentionDays: row.retentionDays,
      minIndependentSources: row.minIndependentSources,
      requireCounterEvidence: row.requireCounterEvidence,
      policyDigest: row.policyDigest,
      createdByActorId: row.createdByActorId,
      effectiveAt: row.effectiveAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      connector: this.mapConnector(row.connectorConfig)
    };
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))].sort();
}

function uniqueDomains(values: string[]): string[] {
  return uniqueStrings(values).map((value) => normalizeDomain(value.replace(/^\*\./, "")));
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function domainMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isPrivateOrLocalHost(hostname: string): boolean {
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    return true;
  }
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    const [a, b] = hostname.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (ipVersion === 6) {
    const normalized = hostname.toLowerCase();
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb") ||
      normalized.startsWith("::ffff:127.")
    );
  }
  return false;
}

function boundedInteger(value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new DomainError(
      "RESEARCH_SOURCE_POLICY_LIMIT_INVALID",
      "Research source policy limit 超出允许范围。",
      400
    );
  }
  return value;
}

function maskApiKey(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.length <= 8
    ? `${trimmed.slice(0, 2)}***${trimmed.slice(-1)}`
    : `${trimmed.slice(0, 4)}***${trimmed.slice(-4)}`;
}

function urlPolicyError(reasonCode: string): DomainError {
  return new DomainError(
    "RESEARCH_SOURCE_POLICY_DENIED",
    "URL 未通过 ResearchSourcePolicy；为避免 secret 泄露不回显原始 URL。",
    403,
    { reasonCode }
  );
}

function toConnectorStatus(value: string): ResearchConnectorConfigRecord["status"] {
  return value === "superseded" || value === "disabled" ? value : "active";
}

function toPolicyStatus(value: string): ResearchSourcePolicyRecord["status"] {
  return value === "superseded" || value === "disabled" ? value : "active";
}
