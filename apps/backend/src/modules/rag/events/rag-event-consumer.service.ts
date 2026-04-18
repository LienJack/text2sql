import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { AuditLogRepository } from "../../data/persistence/audit-log.repository";
import { BuildRagIndexJob } from "../jobs/build-rag-index.job";
import { RagReplayRepository } from "../observability/rag-replay.repository";

export type RagIncrementalEventType =
  | "ddl_changed"
  | "semantic_promoted"
  | "sql_feedback_positive";

export interface RagIncrementalRefreshEvent {
  eventId: string;
  datasourceId: string;
  sourceVersion: string;
  eventType: RagIncrementalEventType;
  runId?: string;
  sessionId?: string;
  requestId?: string;
  replayToken?: string;
  idempotencyKey?: string;
  occurredAt?: string;
  payload?: Record<string, unknown>;
}

export type RagEventConsumeStatus =
  | "processed"
  | "duplicate"
  | "retry_scheduled"
  | "dlq";

export interface RagEventConsumeResult {
  eventId: string;
  datasourceId: string;
  eventType: RagIncrementalEventType;
  sourceVersion: string;
  runId: string;
  idempotencyKey: string;
  replayToken: string;
  attempts: number;
  status: RagEventConsumeStatus;
  indexVersionId?: string;
  failureReason?: string;
}

interface NormalizedEvent extends RagIncrementalRefreshEvent {
  eventId: string;
  datasourceId: string;
  sourceVersion: string;
  eventType: RagIncrementalEventType;
  runId: string;
  idempotencyKey: string;
  replayToken: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

const MAX_EVENT_ATTEMPTS = 3;

@Injectable()
export class RagEventConsumerService {
  private readonly attemptsByIdempotency = new Map<string, number>();
  private readonly terminalResultsByIdempotency = new Map<string, RagEventConsumeResult>();

  constructor(
    private readonly buildRagIndexJob: BuildRagIndexJob,
    private readonly ragReplayRepository: RagReplayRepository,
    private readonly auditLogRepository: AuditLogRepository
  ) {}

  async consumeEvent(input: RagIncrementalRefreshEvent): Promise<RagEventConsumeResult> {
    const event = this.normalizeInput(input);
    const terminalResult = this.terminalResultsByIdempotency.get(event.idempotencyKey);
    if (terminalResult) {
      return {
        ...terminalResult,
        status: "duplicate"
      };
    }

    const attempts = (this.attemptsByIdempotency.get(event.idempotencyKey) ?? 0) + 1;
    this.attemptsByIdempotency.set(event.idempotencyKey, attempts);

    await this.ragReplayRepository.writeReplay({
      runId: event.runId,
      replayKey: `incremental:event:received:${event.eventId}`,
      datasourceId: event.datasourceId,
      stage: "incremental_event_received",
      payload: {
        eventId: event.eventId,
        eventType: event.eventType,
        sourceVersion: event.sourceVersion,
        idempotencyKey: event.idempotencyKey,
        replayToken: event.replayToken,
        occurredAt: event.occurredAt,
        attempt: attempts,
        payload: event.payload
      }
    });

    try {
      const buildResult = await this.buildRagIndexJob.run({
        datasourceId: event.datasourceId,
        sourceVersion: event.sourceVersion,
        buildReason: `incremental_refresh:${event.eventType}`,
        runId: event.runId
      });

      const processedAt = new Date().toISOString();
      await this.ragReplayRepository.writeReplay({
        runId: event.runId,
        replayKey: `incremental:event:processed:${event.eventId}`,
        datasourceId: event.datasourceId,
        stage: "incremental_event_processed",
        indexVersionId: buildResult.indexVersionId,
        payload: {
          eventId: event.eventId,
          eventType: event.eventType,
          sourceVersion: event.sourceVersion,
          idempotencyKey: event.idempotencyKey,
          replayToken: event.replayToken,
          attempt: attempts,
          processedAt,
          entryCount: buildResult.entryCount,
          indexVersionId: buildResult.indexVersionId
        }
      });

      await this.auditLogRepository.appendEvent({
        runId: event.runId,
        sessionId: event.sessionId,
        requestId: event.requestId,
        phase: "rag_incremental_refresh",
        severity: "info",
        eventType: "rag.incremental-refresh.processed",
        eventCode: "EVENT_PROCESSED",
        message: `incremental refresh event ${event.eventId} applied`,
        metadata: {
          eventId: event.eventId,
          eventType: event.eventType,
          datasourceId: event.datasourceId,
          sourceVersion: event.sourceVersion,
          idempotencyKey: event.idempotencyKey,
          replayToken: event.replayToken,
          attempts,
          indexVersionId: buildResult.indexVersionId,
          processedAt
        }
      });

      const result: RagEventConsumeResult = {
        eventId: event.eventId,
        datasourceId: event.datasourceId,
        eventType: event.eventType,
        sourceVersion: event.sourceVersion,
        runId: event.runId,
        idempotencyKey: event.idempotencyKey,
        replayToken: event.replayToken,
        attempts,
        status: "processed",
        indexVersionId: buildResult.indexVersionId
      };
      this.attemptsByIdempotency.delete(event.idempotencyKey);
      this.terminalResultsByIdempotency.set(event.idempotencyKey, result);
      return { ...result };
    } catch (error) {
      const failureReason = this.resolveFailureReason(error);
      const status: RagEventConsumeStatus =
        attempts >= MAX_EVENT_ATTEMPTS ? "dlq" : "retry_scheduled";

      await this.ragReplayRepository.writeReplay({
        runId: event.runId,
        replayKey: `incremental:event:failed:${event.eventId}:attempt:${attempts}`,
        datasourceId: event.datasourceId,
        stage: "incremental_event_failed",
        payload: {
          eventId: event.eventId,
          eventType: event.eventType,
          sourceVersion: event.sourceVersion,
          idempotencyKey: event.idempotencyKey,
          replayToken: event.replayToken,
          attempt: attempts,
          status,
          failureReason
        }
      });

      await this.auditLogRepository.appendEvent({
        runId: event.runId,
        sessionId: event.sessionId,
        requestId: event.requestId,
        phase: "rag_incremental_refresh",
        severity: status === "dlq" ? "error" : "warning",
        eventType:
          status === "dlq"
            ? "rag.incremental-refresh.dlq"
            : "rag.incremental-refresh.failed",
        eventCode:
          status === "dlq" ? "EVENT_DLQ" : "EVENT_RETRY_SCHEDULED",
        message:
          status === "dlq"
            ? `incremental refresh event ${event.eventId} moved to dlq`
            : `incremental refresh event ${event.eventId} scheduled for retry`,
        metadata: {
          eventId: event.eventId,
          eventType: event.eventType,
          datasourceId: event.datasourceId,
          sourceVersion: event.sourceVersion,
          idempotencyKey: event.idempotencyKey,
          replayToken: event.replayToken,
          attempts,
          failureReason,
          status
        }
      });

      const result: RagEventConsumeResult = {
        eventId: event.eventId,
        datasourceId: event.datasourceId,
        eventType: event.eventType,
        sourceVersion: event.sourceVersion,
        runId: event.runId,
        idempotencyKey: event.idempotencyKey,
        replayToken: event.replayToken,
        attempts,
        status,
        failureReason
      };

      if (status === "dlq") {
        this.attemptsByIdempotency.delete(event.idempotencyKey);
        this.terminalResultsByIdempotency.set(event.idempotencyKey, result);
      }

      return result;
    }
  }

  private normalizeInput(input: RagIncrementalRefreshEvent): NormalizedEvent {
    const eventId = input.eventId?.trim();
    if (!eventId) {
      throw new Error("rag event eventId 不能为空");
    }
    const datasourceId = input.datasourceId?.trim();
    if (!datasourceId) {
      throw new Error("rag event datasourceId 不能为空");
    }
    const sourceVersion = input.sourceVersion?.trim();
    if (!sourceVersion) {
      throw new Error("rag event sourceVersion 不能为空");
    }
    const runId = input.runId?.trim() || `rag-event:${datasourceId}:${eventId}`;
    const idempotencyKey =
      input.idempotencyKey?.trim() || `${datasourceId}:${input.eventType}:${eventId}`;
    const occurredAt = this.toIsoTimestamp(input.occurredAt);
    const replayToken =
      input.replayToken?.trim() ||
      this.buildReplayToken({
        datasourceId,
        eventId,
        eventType: input.eventType,
        occurredAt
      });

    return {
      ...input,
      eventId,
      datasourceId,
      sourceVersion,
      runId,
      idempotencyKey,
      replayToken,
      occurredAt,
      payload: input.payload ?? {}
    };
  }

  private buildReplayToken(input: {
    datasourceId: string;
    eventId: string;
    eventType: RagIncrementalEventType;
    occurredAt: string;
  }): string {
    const digest = createHash("sha1")
      .update(
        `${input.datasourceId}|${input.eventType}|${input.eventId}|${input.occurredAt}`
      )
      .digest("hex")
      .slice(0, 20);
    return `replay-${digest}`;
  }

  private toIsoTimestamp(input?: string): string {
    if (!input) {
      return new Date().toISOString();
    }
    const parsed = Date.parse(input);
    if (Number.isNaN(parsed)) {
      return new Date().toISOString();
    }
    return new Date(parsed).toISOString();
  }

  private resolveFailureReason(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message;
    }
    return String(error);
  }
}
