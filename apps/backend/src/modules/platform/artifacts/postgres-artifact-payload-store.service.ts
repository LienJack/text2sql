import { Injectable } from "@nestjs/common";
import { DomainError } from "../../../common/domain-error";
import { AppConfigService } from "../../config/app-config.service";
import { AnalysisLedgerPrismaService } from "../data/persistence/analysis-ledger-prisma.service";
import {
  parseJson,
  sha256Digest,
  stableJson
} from "../data/persistence/analysis-ledger.util";
import {
  ArtifactPayloadStorePort,
  type ArtifactPayloadReadResult,
  type PreparedArtifactPayload
} from "./artifact-payload-store.port";

type PayloadRow = {
  artifactId: string;
  payload: string;
  digest: string;
  sizeBytes: number;
  expiresAt: Date | null;
  deletedAt: Date | null;
};

@Injectable()
export class PostgresArtifactPayloadStoreService extends ArtifactPayloadStorePort {
  constructor(
    private readonly config: AppConfigService,
    private readonly prisma: AnalysisLedgerPrismaService
  ) {
    super();
  }

  prepare(payload: Record<string, unknown>): PreparedArtifactPayload {
    const serializedPayload = stableJson(payload);
    const sizeBytes = Buffer.byteLength(serializedPayload, "utf8");
    if (sizeBytes > this.config.analysisArtifactMaxBytes) {
      throw new DomainError(
        "ANALYSIS_ARTIFACT_PAYLOAD_TOO_LARGE",
        "Artifact payload 超过单项硬上限，不能静默裁剪后提交。",
        413,
        { sizeBytes, maxBytes: this.config.analysisArtifactMaxBytes }
      );
    }
    return {
      serializedPayload,
      sizeBytes,
      digest: sha256Digest(serializedPayload)
    };
  }

  async assertTaskCapacity(taskId: string, incomingBytes: number): Promise<void> {
    const aggregate = (await this.prisma.requireClient().analysisArtifact.aggregate({
      where: { taskId },
      _sum: { payloadSizeBytes: true }
    })) as { _sum?: { payloadSizeBytes?: number | null } };
    const currentBytes = aggregate._sum?.payloadSizeBytes ?? 0;
    if (currentBytes + incomingBytes > this.config.analysisTaskArtifactMaxBytes) {
      throw new DomainError(
        "ANALYSIS_TASK_ARTIFACT_BUDGET_EXCEEDED",
        "Task Artifact 总量超过硬上限。",
        413,
        {
          currentBytes,
          incomingBytes,
          maxBytes: this.config.analysisTaskArtifactMaxBytes
        }
      );
    }
  }

  async read(artifactId: string): Promise<ArtifactPayloadReadResult> {
    const row = (await this.prisma.requireClient().analysisArtifactPayload.findUnique({
      where: { artifactId }
    })) as PayloadRow | null;
    if (!row) {
      return { available: false, reason: "not_found" };
    }
    const expiresAt = row.expiresAt?.toISOString() ?? null;
    if (row.deletedAt) {
      return {
        available: false,
        reason: "deleted",
        digest: row.digest,
        sizeBytes: row.sizeBytes,
        expiresAt
      };
    }
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
      return {
        available: false,
        reason: "expired",
        digest: row.digest,
        sizeBytes: row.sizeBytes,
        expiresAt
      };
    }
    if (sha256Digest(row.payload) !== row.digest) {
      return {
        available: false,
        reason: "digest_mismatch",
        digest: row.digest,
        sizeBytes: row.sizeBytes,
        expiresAt
      };
    }
    return {
      available: true,
      payload: parseJson<Record<string, unknown>>(row.payload, {}),
      digest: row.digest,
      sizeBytes: row.sizeBytes,
      expiresAt
    };
  }

  async purgeExpired(now = new Date()): Promise<number> {
    const result = await this.prisma.requireClient().analysisArtifactPayload.deleteMany({
      where: {
        expiresAt: { lte: now }
      }
    });
    return result.count;
  }
}
