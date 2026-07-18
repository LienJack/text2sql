import { Injectable } from "@nestjs/common";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "../../../common/domain-error";
import { AnalysisLedgerPrismaService } from "../../platform/data/persistence/analysis-ledger-prisma.service";
import {
  parseJson,
  sha256Digest,
  stableJson,
  toIso
} from "../../platform/data/persistence/analysis-ledger.util";
import type {
  ResearchExtractedSource,
  ResearchInjectionIndicator,
  ResearchQueryKind,
  ResearchSourcePolicyRecord,
  ResearchSourceSnapshotRecord
} from "./contracts/research.types";
import { ResearchSourcePolicyService } from "./source-policy/research-source-policy.service";

type SnapshotRow = {
  id: string;
  workspaceId: string;
  taskId: string;
  revisionId: string;
  policyId: string;
  connectorConfigId: string;
  provider: string;
  providerRequestId: string | null;
  canonicalUrl: string;
  locator: string;
  title: string | null;
  mimeType: string;
  contentDigest: string;
  normalizedContent: string;
  contentSizeBytes: number;
  completeness: string;
  injectionIndicators: string[];
  providerMetadata: string;
  publishedAt: Date | null;
  retrievedAt: Date;
  retentionExpiresAt: Date;
  deletedAt: Date | null;
};

const INJECTION_RULES: Array<{
  category: ResearchInjectionIndicator["category"];
  reasonCode: string;
  pattern: RegExp;
}> = [
  {
    category: "instruction_override",
    reasonCode: "untrusted_instruction_override_detected",
    pattern: /ignore\s+(all\s+)?(previous|prior|system).{0,16}instructions?|忽略.{0,12}(之前|系统|以上).{0,8}(指令|规则)/iu
  },
  {
    category: "tool_request",
    reasonCode: "untrusted_tool_request_detected",
    pattern: /(call|invoke|execute|run)\s+(a\s+)?(tool|function|command)|调用.{0,8}(工具|函数|命令)|上传.{0,8}(数据库|文件|样本)/iu
  },
  {
    category: "secret_request",
    reasonCode: "untrusted_secret_request_detected",
    pattern: /(reveal|print|send|expose).{0,20}(secret|password|api[_ -]?key|token)|泄露.{0,12}(密钥|密码|令牌)|输出.{0,12}(系统提示词|密钥)/iu
  },
  {
    category: "scope_change",
    reasonCode: "untrusted_scope_change_detected",
    pattern: /(change|expand|override).{0,16}(scope|goal|permission)|改变.{0,12}(范围|目标|权限)|扩大.{0,8}权限/iu
  }
];

@Injectable()
export class ResearchSourceSnapshotService {
  constructor(
    private readonly prisma: AnalysisLedgerPrismaService,
    private readonly sourcePolicy: ResearchSourcePolicyService
  ) {}

  async freeze(input: {
    policy: ResearchSourcePolicyRecord;
    taskId: string;
    revisionId: string;
    source: ResearchExtractedSource;
    providerRequestId: string;
    queryKind: ResearchQueryKind;
    publishedAt?: string;
    relevanceScore?: number;
    contentByteBudget: number;
  }): Promise<ResearchSourceSnapshotRecord> {
    const authorized = this.sourcePolicy.authorizeUrl(input.source.url, input.policy);
    if (!input.policy.allowedMimeTypes.includes(input.source.mimeType)) {
      throw new DomainError(
        "RESEARCH_SOURCE_MIME_DENIED",
        "Source MIME type 未被 ResearchSourcePolicy 允许。",
        415
      );
    }
    const normalized = normalizeContent(input.source.content);
    if (!normalized) {
      throw new DomainError(
        "RESEARCH_SOURCE_EMPTY",
        "Source extraction 未返回可冻结内容。",
        422
      );
    }
    const maxBytes = Math.max(
      1,
      Math.min(input.policy.maxContentBytes, input.contentByteBudget)
    );
    const bounded = truncateUtf8(normalized, maxBytes);
    const contentDigest = sha256Digest(bounded.value);
    const contentSizeBytes = Buffer.byteLength(bounded.value, "utf8");
    const injectionIndicators = detectInjectionIndicators(bounded.value);
    const providerMetadata = {
      queryKind: input.queryKind,
      relevanceScore: input.relevanceScore ?? null,
      relevanceScoreIsTruthEvidence: false,
      extractionTruncated: bounded.truncated,
      injectionIndicatorCount: injectionIndicators.length
    };
    const publishedAt = validDate(input.publishedAt);
    const retentionExpiresAt = new Date(
      Date.now() + input.policy.retentionDays * 24 * 60 * 60 * 1_000
    );
    const row = await this.prisma.transaction(async (transaction) => {
      const currentPolicy = (await transaction.researchSourcePolicy.findFirst({
        where: {
          id: input.policy.id,
          workspaceId: input.policy.workspaceId,
          status: "active",
          policyDigest: input.policy.policyDigest
        }
      })) as { id: string } | null;
      if (!currentPolicy) {
        throw new DomainError(
          "RESEARCH_SOURCE_POLICY_STALE",
          "Source extraction 完成时 policy 已变化，拒绝作为当前证据提交。",
          409
        );
      }
      const existing = (await transaction.researchSourceSnapshot.findUnique({
        where: {
          taskId_policyId_canonicalUrl_contentDigest: {
            taskId: input.taskId,
            policyId: input.policy.id,
            canonicalUrl: authorized.canonicalUrl,
            contentDigest
          }
        }
      })) as SnapshotRow | null;
      if (existing) {
        if (existing.deletedAt) {
          throw new DomainError(
            "RESEARCH_SOURCE_SNAPSHOT_PAYLOAD_UNAVAILABLE",
            "同 digest 的 SourceSnapshot payload 已按 retention 删除。",
            410
          );
        }
        return existing;
      }
      return (await transaction.researchSourceSnapshot.create({
        data: {
          id: uuidv4(),
          workspaceId: input.policy.workspaceId,
          taskId: input.taskId,
          revisionId: input.revisionId,
          policyId: input.policy.id,
          connectorConfigId: input.policy.connectorConfigId,
          provider: input.policy.connector.provider,
          providerRequestId: input.providerRequestId,
          canonicalUrl: authorized.canonicalUrl,
          locator: authorized.locator,
          title: input.source.title?.trim() || null,
          mimeType: input.source.mimeType,
          contentDigest,
          normalizedContent: bounded.value,
          contentSizeBytes,
          completeness: bounded.truncated ? "partial" : "complete",
          injectionIndicators: injectionIndicators.map((item) => item.reasonCode),
          providerMetadata: stableJson(providerMetadata),
          publishedAt,
          retentionExpiresAt
        }
      })) as SnapshotRow;
    });
    return this.map(row, injectionIndicators);
  }

  async readSnapshotContent(snapshotId: string): Promise<string | null> {
    const row = (await this.prisma.requireClient().researchSourceSnapshot.findUnique({
      where: { id: snapshotId }
    })) as Pick<SnapshotRow, "normalizedContent" | "deletedAt"> | null;
    return row && !row.deletedAt ? row.normalizedContent : null;
  }

  private map(
    row: SnapshotRow,
    knownIndicators?: ResearchInjectionIndicator[]
  ): ResearchSourceSnapshotRecord {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      taskId: row.taskId,
      revisionId: row.revisionId,
      policyId: row.policyId,
      connectorConfigId: row.connectorConfigId,
      provider: "tavily",
      providerRequestId: row.providerRequestId,
      canonicalUrl: row.canonicalUrl,
      locator: row.locator,
      title: row.title,
      mimeType: row.mimeType,
      contentDigest: row.contentDigest,
      contentSizeBytes: row.contentSizeBytes,
      completeness: toCompleteness(row.completeness),
      injectionIndicators:
        knownIndicators ??
        row.injectionIndicators.map((reasonCode) => ({
          category: categoryForReason(reasonCode),
          reasonCode
        })),
      providerMetadata: parseJson(row.providerMetadata, {}),
      publishedAt: row.publishedAt ? toIso(row.publishedAt) : null,
      retrievedAt: row.retrievedAt.toISOString(),
      retentionExpiresAt: row.retentionExpiresAt.toISOString()
    };
  }
}

export function detectInjectionIndicators(
  content: string
): ResearchInjectionIndicator[] {
  return INJECTION_RULES.filter((rule) => rule.pattern.test(content)).map(
    ({ category, reasonCode }) => ({ category, reasonCode })
  );
}

function normalizeContent(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

function truncateUtf8(
  value: string,
  maxBytes: number
): { value: string; truncated: boolean } {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) {
    return { value, truncated: false };
  }
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, mid), "utf8") <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return { value: value.slice(0, low), truncated: true };
}

function validDate(value?: string): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toCompleteness(value: string): ResearchSourceSnapshotRecord["completeness"] {
  return value === "partial" ? "partial" : "complete";
}

function categoryForReason(
  reasonCode: string
): ResearchInjectionIndicator["category"] {
  return (
    INJECTION_RULES.find((rule) => rule.reasonCode === reasonCode)?.category ??
    "instruction_override"
  );
}
