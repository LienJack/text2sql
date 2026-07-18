import { Injectable } from "@nestjs/common";
import type {
  AnalysisArtifactLinkType,
  AnalysisArtifactMetadata,
  AnalysisCompleteness,
  AnalysisDataClassification,
  AnalysisManifestRecord,
  AnalysisManifestStatus,
  AnalysisReceiptDecision,
  AnalysisReceiptRecord,
  AnalysisVisibility
} from "@text2sql/analysis-task-protocol";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "../../../../common/domain-error";
import { AppConfigService } from "../../../config/app-config.service";
import { PostgresArtifactPayloadStoreService } from "../../artifacts/postgres-artifact-payload-store.service";
import {
  AnalysisLedgerPrismaService,
  type AnalysisPrismaClient
} from "./analysis-ledger-prisma.service";
import { parseJson, sha256Digest, stableJson, toIso } from "./analysis-ledger.util";

type TaskRow = {
  id: string;
  status: string;
  version: number;
  currentRevisionNumber: number;
  authorityEpoch: number;
};

type RevisionRow = {
  id: string;
  taskId: string;
  revision: number;
  status: string;
};

type AttemptRow = {
  id: string;
  taskId: string;
  revisionId: string;
  authorityEpoch: number;
  status: string;
};

type ArtifactRow = {
  id: string;
  taskId: string;
  revisionId: string;
  attemptId: string | null;
  artifactType: string;
  schemaVersion: string;
  status: string;
  classification: string;
  visibility: string;
  payloadDigest: string;
  payloadSizeBytes: number;
  completeness: string;
  retentionExpiresAt: Date | null;
  staleAt: Date | null;
  invalidatedAt: Date | null;
  createdAt: Date;
  payload?: { deletedAt: Date | null } | null;
};

type ReceiptRow = {
  id: string;
  taskId: string;
  revisionId: string;
  attemptId: string | null;
  artifactId: string | null;
  receiptType: string;
  subjectType: string;
  subjectRef: string;
  subjectDigest: string;
  decision: string;
  reasonCodes: string[];
  authorityEpoch: number;
  principalDigest: string;
  policyRefs: string;
  createdAt: Date;
};

type ManifestRow = {
  id: string;
  taskId: string;
  revisionId: string;
  attemptId: string | null;
  manifestType: string;
  schemaVersion: string;
  status: string;
  digest: string;
  artifactRefs: string;
  receiptRefs: string;
  limitations: string;
  staleAt: Date | null;
  sealedAt: Date;
  createdAt: Date;
};

const TERMINAL_TASK_STATUSES = new Set([
  "completed",
  "partial",
  "cancelled",
  "failed"
]);

export interface CommittedAnalysisArtifactPayload {
  id: string;
  taskId: string;
  revisionId: string;
  attemptId?: string | null;
  artifactType: string;
  schemaVersion: string;
  payloadDigest: string;
  completeness: AnalysisCompleteness;
  payload: Record<string, unknown>;
}

@Injectable()
export class AnalysisArtifactRepository {
  constructor(
    private readonly prisma: AnalysisLedgerPrismaService,
    private readonly payloadStore: PostgresArtifactPayloadStoreService,
    private readonly config: AppConfigService
  ) {}

  async readCommittedPayload(
    taskId: string,
    artifactId: string
  ): Promise<CommittedAnalysisArtifactPayload> {
    const row = (await this.prisma.requireClient().analysisArtifact.findUnique({
      where: { id: artifactId }
    })) as ArtifactRow | null;
    if (!row || row.taskId !== taskId || row.status !== "committed") {
      throw new DomainError(
        "ANALYSIS_ARTIFACT_NOT_COMMITTED",
        "Worker 只能读取当前 Task 已提交的 Artifact。",
        409
      );
    }
    const payload = await this.payloadStore.read(row.id);
    if (!payload.available) {
      throw new DomainError(
        "ANALYSIS_ARTIFACT_PAYLOAD_UNAVAILABLE",
        "Artifact payload 不可用、过期或 digest 不匹配。",
        payload.reason === "expired" || payload.reason === "deleted" ? 410 : 409,
        { reason: payload.reason }
      );
    }
    if (payload.digest !== row.payloadDigest) {
      throw new DomainError(
        "ANALYSIS_ARTIFACT_PAYLOAD_UNAVAILABLE",
        "Artifact payload 不可用、过期或 digest 不匹配。",
        409,
        { reason: "metadata_digest_mismatch" }
      );
    }
    return {
      id: row.id,
      taskId: row.taskId,
      revisionId: row.revisionId,
      attemptId: row.attemptId,
      artifactType: row.artifactType,
      schemaVersion: row.schemaVersion,
      payloadDigest: row.payloadDigest,
      completeness: row.completeness as AnalysisCompleteness,
      payload: payload.payload
    };
  }

  async commitArtifact(input: {
    artifactId?: string;
    taskId: string;
    revisionId: string;
    attemptId?: string;
    authorityEpoch: number;
    artifactType: string;
    schemaVersion: string;
    classification: AnalysisDataClassification;
    visibility: AnalysisVisibility;
    completeness: AnalysisCompleteness;
    payload: Record<string, unknown>;
    retentionExpiresAt?: string;
    links?: Array<{
      targetArtifactId: string;
      relationType: AnalysisArtifactLinkType;
    }>;
    receipt?: {
      receiptType: string;
      decision: AnalysisReceiptDecision;
      reasonCodes: string[];
      principalDigest: string;
      policyRefs: Record<string, string>;
    };
  }): Promise<AnalysisArtifactMetadata> {
    const prepared = this.payloadStore.prepare(input.payload);
    const artifactId = input.artifactId ?? uuidv4();
    await this.prisma.transaction(async (transaction) => {
      const existing = (await transaction.analysisArtifact.findUnique({
        where: { id: artifactId },
        include: { payload: { select: { deletedAt: true } } }
      })) as ArtifactRow | null;
      if (existing) {
        if (
          existing.taskId !== input.taskId ||
          existing.payloadDigest !== prepared.digest
        ) {
          throw new DomainError(
            "ANALYSIS_ARTIFACT_IDEMPOTENCY_CONFLICT",
            "Artifact id 已绑定不同 payload 或 Task。",
            409
          );
        }
        return;
      }

      const task = await this.lockAndRequireTask(transaction, input.taskId);
      const { revision, attempt } = await this.assertCommitAuthority(transaction, {
        task,
        revisionId: input.revisionId,
        attemptId: input.attemptId,
        authorityEpoch: input.authorityEpoch
      });
      const aggregate = (await transaction.analysisArtifact.aggregate({
        where: { taskId: task.id },
        _sum: { payloadSizeBytes: true }
      })) as { _sum?: { payloadSizeBytes?: number | null } };
      const currentBytes = aggregate._sum?.payloadSizeBytes ?? 0;
      if (
        currentBytes + prepared.sizeBytes >
        this.config.analysisTaskArtifactMaxBytes
      ) {
        throw new DomainError(
          "ANALYSIS_TASK_ARTIFACT_BUDGET_EXCEEDED",
          "Task Artifact 总量超过硬上限。",
          413
        );
      }

      await transaction.analysisArtifact.create({
        data: {
          id: artifactId,
          taskId: task.id,
          revisionId: revision.id,
          attemptId: attempt?.id ?? null,
          artifactType: input.artifactType,
          schemaVersion: input.schemaVersion,
          status: "committed",
          classification: input.classification,
          visibility: input.visibility,
          payloadDigest: prepared.digest,
          payloadSizeBytes: prepared.sizeBytes,
          completeness: input.completeness,
          retentionExpiresAt: input.retentionExpiresAt
            ? new Date(input.retentionExpiresAt)
            : null
        }
      });
      await transaction.analysisArtifactPayload.create({
        data: {
          artifactId,
          payload: prepared.serializedPayload,
          digest: prepared.digest,
          sizeBytes: prepared.sizeBytes,
          expiresAt: input.retentionExpiresAt
            ? new Date(input.retentionExpiresAt)
            : null
        }
      });
      for (const link of input.links ?? []) {
        const target = (await transaction.analysisArtifact.findUnique({
          where: { id: link.targetArtifactId }
        })) as ArtifactRow | null;
        if (!target || target.taskId !== task.id) {
          throw new DomainError(
            "ANALYSIS_ARTIFACT_LINK_SCOPE_INVALID",
            "Artifact link 不能跨 Task 或指向不存在的 Artifact。",
            409
          );
        }
        await transaction.analysisArtifactLink.create({
          data: {
            id: uuidv4(),
            taskId: task.id,
            sourceArtifactId: artifactId,
            targetArtifactId: target.id,
            relationType: link.relationType
          }
        });
      }
      if (input.receipt) {
        await transaction.analysisReceipt.create({
          data: {
            id: uuidv4(),
            taskId: task.id,
            revisionId: revision.id,
            attemptId: attempt?.id ?? null,
            artifactId,
            receiptType: input.receipt.receiptType,
            subjectType: "artifact",
            subjectRef: artifactId,
            subjectDigest: prepared.digest,
            decision: input.receipt.decision,
            reasonCodes: input.receipt.reasonCodes,
            authorityEpoch: task.authorityEpoch,
            principalDigest: input.receipt.principalDigest,
            policyRefs: stableJson(input.receipt.policyRefs)
          }
        });
      }
      await this.appendEvent(transaction, task.id, {
        revisionId: revision.id,
        attemptId: attempt?.id,
        idempotencyKey: `artifact-committed:${artifactId}`,
        eventType: "artifact.committed",
        data: {
          artifactId,
          artifactType: input.artifactType,
          payloadDigest: prepared.digest,
          completeness: input.completeness
        }
      });
    });
    const row = (await this.prisma.requireClient().analysisArtifact.findUnique({
      where: { id: artifactId },
      include: { payload: { select: { deletedAt: true } } }
    })) as ArtifactRow | null;
    if (!row) {
      throw new DomainError("ANALYSIS_ARTIFACT_CREATE_FAILED", "Artifact 提交失败。", 500);
    }
    return this.mapArtifact(row);
  }

  async appendReceipt(input: {
    receiptId?: string;
    taskId: string;
    revisionId: string;
    attemptId?: string;
    artifactId?: string;
    authorityEpoch: number;
    receiptType: string;
    subjectType: string;
    subjectRef: string;
    subjectDigest: string;
    decision: AnalysisReceiptDecision;
    reasonCodes: string[];
    principalDigest: string;
    policyRefs: Record<string, string>;
  }): Promise<AnalysisReceiptRecord> {
    const receiptId = input.receiptId ?? uuidv4();
    await this.prisma.transaction(async (transaction) => {
      const existing = (await transaction.analysisReceipt.findUnique({
        where: { id: receiptId }
      })) as ReceiptRow | null;
      if (existing) {
        if (
          existing.taskId !== input.taskId ||
          existing.subjectDigest !== input.subjectDigest
        ) {
          throw new DomainError(
            "ANALYSIS_RECEIPT_IDEMPOTENCY_CONFLICT",
            "Receipt id 已绑定不同 subject。",
            409
          );
        }
        return;
      }
      const task = await this.lockAndRequireTask(transaction, input.taskId);
      const { revision, attempt } = await this.assertCommitAuthority(transaction, {
        task,
        revisionId: input.revisionId,
        attemptId: input.attemptId,
        authorityEpoch: input.authorityEpoch
      });
      await transaction.analysisReceipt.create({
        data: {
          id: receiptId,
          taskId: task.id,
          revisionId: revision.id,
          attemptId: attempt?.id ?? null,
          artifactId: input.artifactId ?? null,
          receiptType: input.receiptType,
          subjectType: input.subjectType,
          subjectRef: input.subjectRef,
          subjectDigest: input.subjectDigest,
          decision: input.decision,
          reasonCodes: input.reasonCodes,
          authorityEpoch: task.authorityEpoch,
          principalDigest: input.principalDigest,
          policyRefs: stableJson(input.policyRefs)
        }
      });
    });
    const row = (await this.prisma.requireClient().analysisReceipt.findUnique({
      where: { id: receiptId }
    })) as ReceiptRow | null;
    if (!row) {
      throw new DomainError("ANALYSIS_RECEIPT_CREATE_FAILED", "Receipt 提交失败。", 500);
    }
    return this.mapReceipt(row);
  }

  async sealManifest(input: {
    manifestId?: string;
    taskId: string;
    revisionId: string;
    attemptId?: string;
    authorityEpoch: number;
    manifestType: string;
    schemaVersion: string;
    status: AnalysisManifestStatus;
    artifactRefs: string[];
    receiptRefs: string[];
    limitations: string[];
  }): Promise<AnalysisManifestRecord> {
    const manifestId = input.manifestId ?? uuidv4();
    const canonical = stableJson({
      taskId: input.taskId,
      revisionId: input.revisionId,
      attemptId: input.attemptId ?? null,
      manifestType: input.manifestType,
      schemaVersion: input.schemaVersion,
      status: input.status,
      artifactRefs: [...new Set(input.artifactRefs)].sort(),
      receiptRefs: [...new Set(input.receiptRefs)].sort(),
      limitations: [...new Set(input.limitations)].sort()
    });
    const digest = sha256Digest(canonical);
    await this.prisma.transaction(async (transaction) => {
      const existing = (await transaction.analysisManifest.findUnique({
        where: { id: manifestId }
      })) as ManifestRow | null;
      if (existing) {
        if (existing.digest !== digest || existing.taskId !== input.taskId) {
          throw new DomainError(
            "ANALYSIS_MANIFEST_IDEMPOTENCY_CONFLICT",
            "Manifest id 已绑定不同内容。",
            409
          );
        }
        return;
      }
      const task = await this.lockAndRequireTask(transaction, input.taskId);
      const { revision, attempt } = await this.assertCommitAuthority(transaction, {
        task,
        revisionId: input.revisionId,
        attemptId: input.attemptId,
        authorityEpoch: input.authorityEpoch
      });
      const artifacts = (await transaction.analysisArtifact.findMany({
        where: { id: { in: input.artifactRefs }, taskId: task.id }
      })) as ArtifactRow[];
      if (
        artifacts.length !== new Set(input.artifactRefs).size ||
        artifacts.some((artifact) => artifact.status !== "committed")
      ) {
        throw new DomainError(
          "ANALYSIS_MANIFEST_ARTIFACTS_UNSUPPORTED",
          "Manifest 只能引用当前 Task 中已提交的 Artifact。",
          409
        );
      }
      const receipts = (await transaction.analysisReceipt.findMany({
        where: { id: { in: input.receiptRefs }, taskId: task.id }
      })) as ReceiptRow[];
      if (receipts.length !== new Set(input.receiptRefs).size) {
        throw new DomainError(
          "ANALYSIS_MANIFEST_RECEIPTS_MISSING",
          "Manifest 引用的 Receipt 不完整。",
          409
        );
      }
      await transaction.analysisManifest.create({
        data: {
          id: manifestId,
          taskId: task.id,
          revisionId: revision.id,
          attemptId: attempt?.id ?? null,
          manifestType: input.manifestType,
          schemaVersion: input.schemaVersion,
          status: input.status,
          digest,
          artifactRefs: stableJson([...new Set(input.artifactRefs)].sort()),
          receiptRefs: stableJson([...new Set(input.receiptRefs)].sort()),
          limitations: stableJson([...new Set(input.limitations)].sort())
        }
      });
      await this.appendEvent(transaction, task.id, {
        revisionId: revision.id,
        attemptId: attempt?.id,
        idempotencyKey: `manifest-sealed:${manifestId}`,
        eventType: "manifest.sealed",
        data: { manifestId, digest, status: input.status }
      });
    });
    const row = (await this.prisma.requireClient().analysisManifest.findUnique({
      where: { id: manifestId }
    })) as ManifestRow | null;
    if (!row) {
      throw new DomainError("ANALYSIS_MANIFEST_CREATE_FAILED", "Manifest 封存失败。", 500);
    }
    return this.mapManifest(row);
  }

  private async lockAndRequireTask(
    transaction: AnalysisPrismaClient,
    taskId: string
  ): Promise<TaskRow> {
    const existing = (await transaction.analysisTask.findUnique({
      where: { id: taskId }
    })) as TaskRow | null;
    if (!existing) {
      throw new DomainError("ANALYSIS_TASK_NOT_FOUND", "未找到 AnalysisTask。", 404);
    }
    return (await transaction.analysisTask.update({
      where: { id: taskId },
      data: { updatedAt: new Date() }
    })) as TaskRow;
  }

  private async assertCommitAuthority(
    transaction: AnalysisPrismaClient,
    input: {
      task: TaskRow;
      revisionId: string;
      attemptId?: string;
      authorityEpoch: number;
    }
  ): Promise<{ revision: RevisionRow; attempt?: AttemptRow }> {
    if (
      input.task.authorityEpoch !== input.authorityEpoch ||
      TERMINAL_TASK_STATUSES.has(input.task.status) ||
      ["paused", "pausing", "cancelling"].includes(input.task.status)
    ) {
      throw new DomainError(
        "ANALYSIS_COMMIT_AUTHORITY_STALE",
        "Task authority epoch 或生命周期状态已变化，candidate 不能提交。",
        409
      );
    }
    const revision = (await transaction.analysisTaskRevision.findUnique({
      where: { id: input.revisionId }
    })) as RevisionRow | null;
    if (
      !revision ||
      revision.taskId !== input.task.id ||
      revision.revision !== input.task.currentRevisionNumber ||
      revision.status !== "active"
    ) {
      throw new DomainError(
        "ANALYSIS_REVISION_NOT_CURRENT",
        "candidate 不能跨 Revision 提交。",
        409
      );
    }
    if (!input.attemptId) {
      return { revision };
    }
    const attempt = (await transaction.analysisAttempt.findUnique({
      where: { id: input.attemptId }
    })) as AttemptRow | null;
    if (
      !attempt ||
      attempt.taskId !== input.task.id ||
      attempt.revisionId !== revision.id ||
      attempt.authorityEpoch !== input.authorityEpoch ||
      ["cancelled", "failed", "superseded"].includes(attempt.status)
    ) {
      throw new DomainError(
        "ANALYSIS_ATTEMPT_NOT_COMMITTABLE",
        "Attempt 不再具备提交 candidate 的权限。",
        409
      );
    }
    return { revision, attempt };
  }

  private async appendEvent(
    transaction: AnalysisPrismaClient,
    taskId: string,
    input: {
      revisionId: string;
      attemptId?: string;
      idempotencyKey: string;
      eventType: string;
      data: Record<string, unknown>;
    }
  ): Promise<void> {
    const last = (await transaction.analysisEvent.findFirst({
      where: { taskId },
      orderBy: { sequence: "desc" }
    })) as { sequence: number } | null;
    await transaction.analysisEvent.create({
      data: {
        id: uuidv4(),
        taskId,
        revisionId: input.revisionId,
        attemptId: input.attemptId ?? null,
        sequence: (last?.sequence ?? 0) + 1,
        idempotencyKey: input.idempotencyKey,
        eventType: input.eventType,
        visibility: "user",
        data: stableJson(input.data)
      }
    });
  }

  private mapArtifact(row: ArtifactRow): AnalysisArtifactMetadata {
    return {
      id: row.id,
      taskId: row.taskId,
      revisionId: row.revisionId,
      attemptId: row.attemptId,
      artifactType: row.artifactType,
      schemaVersion: row.schemaVersion,
      status: row.status as AnalysisArtifactMetadata["status"],
      classification: row.classification as AnalysisDataClassification,
      visibility: row.visibility as AnalysisVisibility,
      payloadDigest: row.payloadDigest,
      payloadSizeBytes: row.payloadSizeBytes,
      completeness: row.completeness as AnalysisCompleteness,
      retentionExpiresAt: toIso(row.retentionExpiresAt),
      payloadAvailable: Boolean(row.payload && !row.payload.deletedAt),
      staleAt: toIso(row.staleAt),
      invalidatedAt: toIso(row.invalidatedAt),
      createdAt: row.createdAt.toISOString()
    };
  }

  private mapReceipt(row: ReceiptRow): AnalysisReceiptRecord {
    return {
      id: row.id,
      taskId: row.taskId,
      revisionId: row.revisionId,
      attemptId: row.attemptId,
      artifactId: row.artifactId,
      receiptType: row.receiptType,
      subjectType: row.subjectType,
      subjectRef: row.subjectRef,
      subjectDigest: row.subjectDigest,
      decision: row.decision as AnalysisReceiptDecision,
      reasonCodes: row.reasonCodes,
      authorityEpoch: row.authorityEpoch,
      principalDigest: row.principalDigest,
      policyRefs: parseJson<Record<string, string>>(row.policyRefs, {}),
      createdAt: row.createdAt.toISOString()
    };
  }

  private mapManifest(row: ManifestRow): AnalysisManifestRecord {
    return {
      id: row.id,
      taskId: row.taskId,
      revisionId: row.revisionId,
      attemptId: row.attemptId,
      manifestType: row.manifestType,
      schemaVersion: row.schemaVersion,
      status: row.status as AnalysisManifestStatus,
      digest: row.digest,
      artifactRefs: parseJson<string[]>(row.artifactRefs, []),
      receiptRefs: parseJson<string[]>(row.receiptRefs, []),
      limitations: parseJson<string[]>(row.limitations, []),
      staleAt: toIso(row.staleAt),
      sealedAt: row.sealedAt.toISOString(),
      createdAt: row.createdAt.toISOString()
    };
  }
}
