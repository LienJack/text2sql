import { Injectable, Logger } from "@nestjs/common";
import type { RagMemoryFeedbackResponse, RagMemoryStatus, SqlRun } from "@text2sql/shared-types";
import { DomainError } from "../../common/domain-error";
import { ChatRepository } from "../data/persistence/chat.repository";
import { AuditLogRepository } from "../data/persistence/audit-log.repository";
import { RagReplayRepository } from "../rag/observability/rag-replay.repository";
import {
  type MemoryPromotionRecord,
  type MemoryPromotionStatus,
  MemoryPromotionPolicy
} from "./memory-promotion-policy";

type PromotionState =
  | "promoted"
  | "held"
  | "duplicate"
  | "rolled_back";

export interface MemoryCompensationEntry {
  compensationKey: string;
  candidateId: string;
  runId: string;
  attempts: number;
  state: "pending_retry" | "manual_review";
  lastError: string;
  updatedAt: string;
}

export interface MemoryPromotionResult {
  candidateId: string;
  state: PromotionState;
  beforeStatus: MemoryPromotionStatus;
  afterStatus: MemoryPromotionStatus;
  transitionKey?: string;
  rejectionReasons: string[];
  idempotencyKey: string;
  compensation?: MemoryCompensationEntry;
}

const MAX_COMPENSATION_ATTEMPTS = 3;

@Injectable()
export class MemoryPromotionService {
  private readonly logger = new Logger(MemoryPromotionService.name);
  private readonly records = new Map<string, MemoryPromotionRecord>();
  private readonly processedTriggerKeys = new Set<string>();
  private readonly processedTransitionKeys = new Set<string>();
  private readonly compensations = new Map<string, MemoryCompensationEntry>();

  constructor(
    private readonly policy: MemoryPromotionPolicy,
    private readonly chatRepository: ChatRepository,
    private readonly auditLogRepository: AuditLogRepository,
    private readonly ragReplayRepository: RagReplayRepository
  ) {}

  async promoteFromRun(input: {
    run: SqlRun;
    datasourceId: string;
    requestId?: string;
  }): Promise<MemoryPromotionResult> {
    const now = new Date().toISOString();
    const candidateId = this.policy.buildCandidateId({
      datasourceId: input.datasourceId,
      sessionId: input.run.sessionId,
      question: input.run.question,
      sql: input.run.sql
    });
    const idempotencyKey = this.policy.buildTriggerIdempotencyKey({
      candidateId,
      runId: input.run.runId
    });
    const previous = this.getOrCreateRecord(candidateId, now);
    if (this.processedTriggerKeys.has(idempotencyKey)) {
      return {
        candidateId,
        state: "duplicate",
        beforeStatus: previous.status,
        afterStatus: previous.status,
        rejectionReasons: ["duplicate_trigger_ignored"],
        idempotencyKey
      };
    }

    const riskTags = this.extractRiskTags(input.run);
    const evaluation = this.policy.evaluate({
      record: previous,
      run: input.run,
      riskTags
    });
    const beforeStatus = previous.status;
    const transitionKey = evaluation.transition?.transitionKey;
    if (transitionKey && this.processedTransitionKeys.has(transitionKey)) {
      this.processedTriggerKeys.add(idempotencyKey);
      return {
        candidateId,
        state: "duplicate",
        beforeStatus,
        afterStatus: previous.status,
        transitionKey,
        rejectionReasons: ["duplicate_transition_ignored"],
        idempotencyKey
      };
    }

    const next: MemoryPromotionRecord = {
      ...previous,
      status: evaluation.transition?.to ?? previous.status,
      evidence: evaluation.nextEvidence,
      version: previous.version + 1,
      lastRunId: input.run.runId,
      lastTransitionKey: transitionKey ?? previous.lastTransitionKey,
      updatedAt: now
    };

    this.records.set(candidateId, next);

    try {
      await this.writePromotionAudit({
        run: input.run,
        requestId: input.requestId,
        datasourceId: input.datasourceId,
        candidateId,
        idempotencyKey,
        beforeStatus,
        afterStatus: next.status,
        transitionKey,
        rejectionReasons: evaluation.rejectionReasons,
        evidence: next.evidence
      });

      if (transitionKey) {
        this.processedTransitionKeys.add(transitionKey);
      }
      this.processedTriggerKeys.add(idempotencyKey);

      return {
        candidateId,
        state: transitionKey ? "promoted" : "held",
        beforeStatus,
        afterStatus: next.status,
        transitionKey,
        rejectionReasons: evaluation.rejectionReasons,
        idempotencyKey
      };
    } catch (error) {
      this.records.set(candidateId, previous);
      const compensation = await this.emitCompensation({
        run: input.run,
        requestId: input.requestId,
        datasourceId: input.datasourceId,
        candidateId,
        beforeStatus,
        attemptedStatus: next.status,
        transitionKey,
        idempotencyKey,
        error
      });
      return {
        candidateId,
        state: "rolled_back",
        beforeStatus,
        afterStatus: previous.status,
        transitionKey,
        rejectionReasons: ["promotion_write_failed"],
        idempotencyKey,
        compensation
      };
    }
  }

  getRecord(candidateId: string): MemoryPromotionRecord | undefined {
    const record = this.records.get(candidateId);
    if (!record) {
      return undefined;
    }
    return {
      ...record,
      evidence: {
        ...record.evidence
      }
    };
  }

  listCompensations(): MemoryCompensationEntry[] {
    return Array.from(this.compensations.values()).map((item) => ({
      ...item
    }));
  }

  buildCandidateIdForRun(input: {
    run: SqlRun;
    datasourceId: string;
  }): string {
    return this.policy.buildCandidateId({
      datasourceId: input.datasourceId,
      sessionId: input.run.sessionId,
      question: input.run.question,
      sql: input.run.sql
    });
  }

  async applyFeedback(input: {
    runId: string;
    targetStatus: RagMemoryStatus;
    note?: string;
    actorId: string;
    requestId?: string;
  }): Promise<RagMemoryFeedbackResponse> {
    const run = await this.chatRepository.getRunById(input.runId);
    if (!run) {
      throw new DomainError("RUN_NOT_FOUND", "运行记录不存在", 404, {
        runId: input.runId
      });
    }
    const session = await this.chatRepository.getSessionById(run.sessionId);
    if (!session) {
      throw new DomainError("RUN_NOT_FOUND", "运行记录不存在", 404, {
        runId: input.runId
      });
    }

    const candidateId = this.buildCandidateIdForRun({
      run,
      datasourceId: session.datasource
    });
    const now = new Date().toISOString();
    const previous = this.getOrCreateRecord(candidateId, now);
    const beforeStatus = previous.status;
    const afterStatus = this.resolveFeedbackStatusTransition(
      previous.status,
      input.targetStatus
    );

    const note = input.note?.trim() || undefined;
    if (beforeStatus === afterStatus) {
      return {
        runId: run.runId,
        candidateId,
        beforeStatus,
        afterStatus,
        applied: false,
        note,
        updatedAt: previous.updatedAt
      };
    }

    const transitionKey = `manual:${candidateId}:${beforeStatus}->${afterStatus}:${run.runId}`;
    const next: MemoryPromotionRecord = {
      ...previous,
      status: afterStatus,
      version: previous.version + 1,
      lastRunId: run.runId,
      lastTransitionKey: transitionKey,
      updatedAt: now
    };
    this.records.set(candidateId, next);

    try {
      await this.auditLogRepository.appendEvent({
        phase: "memory_feedback",
        severity: "info",
        eventType: "memory.promotion.feedback.applied",
        eventCode: "MEMORY_FEEDBACK_APPLIED",
        runId: run.runId,
        sessionId: run.sessionId,
        requestId: input.requestId,
        message: `memory feedback transitioned ${beforeStatus} -> ${afterStatus}`,
        metadata: {
          actorId: input.actorId,
          candidateId,
          beforeStatus,
          afterStatus,
          note: note ?? null
        }
      });
      await this.ragReplayRepository.writeReplay({
        runId: run.runId,
        replayKey: `memory:promotion:feedback:${candidateId}:${Date.parse(now)}`,
        datasourceId: session.datasource,
        stage: "memory_promotion_feedback",
        payload: {
          actorId: input.actorId,
          candidateId,
          beforeStatus,
          afterStatus,
          note: note ?? null
        }
      });
    } catch {
      this.records.set(candidateId, previous);
      throw new DomainError(
        "MEMORY_FEEDBACK_WRITE_FAILED",
        "记忆反馈写入失败，请稍后重试。",
        409,
        {
          runId: run.runId,
          candidateId
        }
      );
    }

    return {
      runId: run.runId,
      candidateId,
      beforeStatus,
      afterStatus,
      applied: true,
      note,
      updatedAt: now
    };
  }

  private extractRiskTags(run: SqlRun): string[] {
    const value = run.delivery?.evidence?.riskTags;
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((item): item is string => typeof item === "string");
  }

  private resolveFeedbackStatusTransition(
    current: MemoryPromotionStatus,
    target: RagMemoryStatus
  ): MemoryPromotionStatus {
    const rank: Record<MemoryPromotionStatus, number> = {
      candidate: 0,
      verified: 1,
      production: 2
    };
    if (target === current) {
      return current;
    }
    if (rank[target] < rank[current]) {
      throw new DomainError(
        "MEMORY_FEEDBACK_CONFLICT",
        "不允许将记忆状态降级到更低等级。",
        409,
        {
          currentStatus: current,
          targetStatus: target
        }
      );
    }
    if (rank[target] - rank[current] > 1) {
      throw new DomainError(
        "MEMORY_FEEDBACK_CONFLICT",
        "记忆反馈仅支持相邻等级迁移。",
        409,
        {
          currentStatus: current,
          targetStatus: target
        }
      );
    }
    return target;
  }

  private getOrCreateRecord(candidateId: string, now: string): MemoryPromotionRecord {
    const existing = this.records.get(candidateId);
    if (existing) {
      return {
        ...existing,
        evidence: {
          ...existing.evidence
        }
      };
    }
    const created = this.policy.createInitialRecord(candidateId, now);
    this.records.set(candidateId, created);
    return {
      ...created,
      evidence: {
        ...created.evidence
      }
    };
  }

  private async writePromotionAudit(input: {
    run: SqlRun;
    requestId?: string;
    datasourceId: string;
    candidateId: string;
    idempotencyKey: string;
    beforeStatus: MemoryPromotionStatus;
    afterStatus: MemoryPromotionStatus;
    transitionKey?: string;
    rejectionReasons: string[];
    evidence: MemoryPromotionRecord["evidence"];
  }): Promise<void> {
    const replayKey = `memory:promotion:${input.candidateId}:v${input.evidence.sampleCount}`;
    const eventType = input.transitionKey
      ? "memory.promotion.transition.applied"
      : "memory.promotion.transition.held";
    const auditEvent = await this.auditLogRepository.appendEvent({
      phase: "memory_promotion",
      severity: input.transitionKey ? "info" : "warning",
      eventType,
      eventCode: input.transitionKey ? "PROMOTION_APPLIED" : "PROMOTION_HELD",
      runId: input.run.runId,
      sessionId: input.run.sessionId,
      requestId: input.requestId,
      message: input.transitionKey
        ? `memory promotion transitioned ${input.beforeStatus} -> ${input.afterStatus}`
        : `memory promotion held at ${input.afterStatus}`,
      metadata: {
        candidateId: input.candidateId,
        datasourceId: input.datasourceId,
        idempotencyKey: input.idempotencyKey,
        transitionKey: input.transitionKey ?? null,
        beforeStatus: input.beforeStatus,
        afterStatus: input.afterStatus,
        replayKey,
        rejectionReasons: input.rejectionReasons,
        evidence: input.evidence
      }
    });

    await this.ragReplayRepository.writeReplay({
      runId: input.run.runId,
      replayKey,
      datasourceId: input.datasourceId,
      stage: "memory_promotion",
      payload: {
        requestId: input.requestId ?? null,
        candidateId: input.candidateId,
        auditEventId: auditEvent.id,
        idempotencyKey: input.idempotencyKey,
        replayKey,
        transitionKey: input.transitionKey ?? null,
        beforeStatus: input.beforeStatus,
        afterStatus: input.afterStatus,
        rejectionReasons: input.rejectionReasons,
        evidence: input.evidence
      }
    });
  }

  private async emitCompensation(input: {
    run: SqlRun;
    requestId?: string;
    datasourceId: string;
    candidateId: string;
    beforeStatus: MemoryPromotionStatus;
    attemptedStatus: MemoryPromotionStatus;
    transitionKey?: string;
    idempotencyKey: string;
    error: unknown;
  }): Promise<MemoryCompensationEntry> {
    const transitionPart = input.transitionKey ?? "held";
    const compensationKey = `${input.candidateId}:${input.run.runId}:${transitionPart}`;
    const previous = this.compensations.get(compensationKey);
    const attempts = (previous?.attempts ?? 0) + 1;
    const state = attempts >= MAX_COMPENSATION_ATTEMPTS ? "manual_review" : "pending_retry";
    const entry: MemoryCompensationEntry = {
      compensationKey,
      candidateId: input.candidateId,
      runId: input.run.runId,
      attempts,
      state,
      lastError:
        input.error instanceof Error
          ? input.error.message
          : String(input.error),
      updatedAt: new Date().toISOString()
    };
    this.compensations.set(compensationKey, entry);
    const replayKey = `memory:promotion:compensation:${entry.compensationKey}`;

    try {
      const compensationAuditEvent = await this.auditLogRepository.appendEvent({
        phase: "memory_promotion",
        severity: state === "manual_review" ? "error" : "warning",
        eventType: "memory.promotion.compensated",
        eventCode:
          state === "manual_review"
            ? "PROMOTION_COMPENSATED_MANUAL_REVIEW"
            : "PROMOTION_COMPENSATED",
        runId: input.run.runId,
        sessionId: input.run.sessionId,
        requestId: input.requestId,
        message:
          state === "manual_review"
            ? "memory promotion write failed repeatedly and requires manual review"
            : "memory promotion write failed; state rolled back and compensation queued",
        metadata: {
          candidateId: input.candidateId,
          datasourceId: input.datasourceId,
          idempotencyKey: input.idempotencyKey,
          transitionKey: input.transitionKey ?? null,
          rollbackTo: input.beforeStatus,
          attemptedStatus: input.attemptedStatus,
          compensationKey: entry.compensationKey,
          attempts: entry.attempts,
          compensationState: entry.state,
          replayKey,
          error: entry.lastError
        }
      });

      await this.ragReplayRepository.writeReplay({
        runId: input.run.runId,
        replayKey,
        datasourceId: input.datasourceId,
        stage: "memory_promotion_compensation",
        payload: {
          requestId: input.requestId ?? null,
          candidateId: input.candidateId,
          compensationAuditEventId: compensationAuditEvent.id,
          compensationKey: entry.compensationKey,
          replayKey,
          attempts: entry.attempts,
          state: entry.state,
          rollbackTo: input.beforeStatus,
          attemptedStatus: input.attemptedStatus,
          transitionKey: input.transitionKey ?? null,
          error: entry.lastError
        }
      });
    } catch (compensationError) {
      this.logger.warn(
        `memory promotion compensation signal failed: ${
          compensationError instanceof Error
            ? compensationError.message
            : String(compensationError)
        }`
      );
    }

    return entry;
  }
}
