import type { ExecutionTrace } from "@text2sql/shared-types";
import { Injectable } from "@nestjs/common";
import type { GovernanceAuditLog } from "../../data/persistence/audit-log.repository";
import { AuditLogRepository } from "../../data/persistence/audit-log.repository";
import { ChatRepository } from "../../data/persistence/chat.repository";
import { RagIndexRepository } from "../index/rag-index.repository";
import type { RagReplayRecord } from "../observability/rag-replay.repository";
import { RagReplayRepository } from "../observability/rag-replay.repository";

export interface RagAuditReplayQueryInput {
  runId: string;
  fromAt?: string;
  toAt?: string;
}

export interface RagAuditReplayEventRecord {
  eventId: string;
  eventType: string;
  datasourceId: string;
  sourceVersion: string;
  idempotencyKey: string;
  replayToken: string;
  status: "processed" | "retry_scheduled" | "dlq";
  attempts: number;
  occurredAt: string;
  processedAt?: string;
  failureReason?: string;
  indexVersion?: {
    id: string;
    status: string;
    sourceVersion: string;
    activatedAt?: string;
  };
  replay: Array<{
    replayKey: string;
    stage: string;
    createdAt: string;
  }>;
  audits: GovernanceAuditLog[];
}

export interface RagAuditReplayChain {
  runId: string;
  runTrace?: ExecutionTrace;
  events: RagAuditReplayEventRecord[];
  generatedAt: string;
}

interface EventNode {
  eventId: string;
  eventType: string;
  datasourceId: string;
  sourceVersion: string;
  idempotencyKey: string;
  replayToken: string;
  status: "processed" | "retry_scheduled" | "dlq";
  attempts: number;
  occurredAt: string;
  processedAt?: string;
  failureReason?: string;
  indexVersionId?: string;
  replay: Array<{
    replayKey: string;
    stage: string;
    createdAt: string;
  }>;
}

@Injectable()
export class RagAuditReplayService {
  constructor(
    private readonly ragReplayRepository: RagReplayRepository,
    private readonly ragIndexRepository: RagIndexRepository,
    private readonly chatRepository: ChatRepository,
    private readonly auditLogRepository: AuditLogRepository
  ) {}

  async queryChain(input: RagAuditReplayQueryInput): Promise<RagAuditReplayChain> {
    const runId = input.runId.trim();
    if (!runId) {
      return {
        runId: "",
        events: [],
        generatedAt: new Date().toISOString()
      };
    }

    const [replayRows, run, auditRows] = await Promise.all([
      this.ragReplayRepository.listByRunId(runId),
      this.chatRepository.getRunById(runId),
      this.auditLogRepository.listEvents({
        runId,
        limit: 500
      })
    ]);

    const fromAt = this.parseTimestamp(input.fromAt);
    const toAt = this.parseTimestamp(input.toAt);
    const eventNodes = this.buildEventNodes(replayRows);

    const indexVersionMap = await this.loadIndexVersions(eventNodes);
    const ragAuditRows = auditRows.filter((item) =>
      item.eventType.startsWith("rag.incremental-refresh")
    );

    const events = eventNodes
      .filter((item) => this.isWithinWindow(item.occurredAt, fromAt, toAt))
      .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt))
      .map((item) => ({
        eventId: item.eventId,
        eventType: item.eventType,
        datasourceId: item.datasourceId,
        sourceVersion: item.sourceVersion,
        idempotencyKey: item.idempotencyKey,
        replayToken: item.replayToken,
        status: item.status,
        attempts: item.attempts,
        occurredAt: item.occurredAt,
        processedAt: item.processedAt,
        failureReason: item.failureReason,
        indexVersion: item.indexVersionId
          ? indexVersionMap.get(item.indexVersionId)
          : undefined,
        replay: [...item.replay],
        audits: ragAuditRows.filter(
          (auditRow) => this.readMetadataEventId(auditRow.metadata) === item.eventId
        )
      }));

    return {
      runId,
      runTrace: run?.trace,
      events,
      generatedAt: new Date().toISOString()
    };
  }

  private buildEventNodes(rows: RagReplayRecord[]): EventNode[] {
    const nodes = new Map<string, EventNode>();
    for (const row of rows) {
      if (!row.replayKey.startsWith("incremental:event:")) {
        continue;
      }
      const payload = this.parsePayload(row.payload);
      const eventId = this.resolveEventId(row.replayKey, payload.eventId);
      if (!eventId) {
        continue;
      }

      const current =
        nodes.get(eventId) ??
        this.createInitialNode({
          eventId,
          datasourceId: row.datasourceId,
          occurredAt: row.createdAt,
          payload
        });
      current.replay.push({
        replayKey: row.replayKey,
        stage: row.stage,
        createdAt: row.createdAt
      });

      if (row.stage === "incremental_event_received") {
        current.eventType = this.readString(payload.eventType, current.eventType);
        current.datasourceId = this.readString(payload.datasourceId, current.datasourceId);
        current.sourceVersion = this.readString(payload.sourceVersion, current.sourceVersion);
        current.idempotencyKey = this.readString(
          payload.idempotencyKey,
          current.idempotencyKey
        );
        current.replayToken = this.readString(payload.replayToken, current.replayToken);
        current.attempts = this.readNumber(payload.attempt, current.attempts);
        current.occurredAt = this.readString(payload.occurredAt, current.occurredAt);
      }

      if (row.stage === "incremental_event_processed") {
        current.status = "processed";
        current.processedAt = this.readString(payload.processedAt, row.createdAt);
        current.attempts = this.readNumber(payload.attempt, current.attempts);
        current.indexVersionId =
          this.readOptionalString(payload.indexVersionId) ??
          row.indexVersionId ??
          current.indexVersionId;
      }

      if (row.stage === "incremental_event_failed") {
        const status = this.readString(payload.status, current.status);
        current.status = status === "dlq" ? "dlq" : "retry_scheduled";
        current.attempts = this.readNumber(payload.attempt, current.attempts);
        current.failureReason =
          this.readOptionalString(payload.failureReason) ?? current.failureReason;
      }

      nodes.set(eventId, current);
    }

    return Array.from(nodes.values()).map((item) => ({
      ...item,
      replay: item.replay.sort(
        (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt)
      )
    }));
  }

  private createInitialNode(input: {
    eventId: string;
    datasourceId: string;
    occurredAt: string;
    payload: Record<string, unknown>;
  }): EventNode {
    return {
      eventId: input.eventId,
      eventType: this.readString(input.payload.eventType, "unknown"),
      datasourceId: this.readString(input.payload.datasourceId, input.datasourceId),
      sourceVersion: this.readString(input.payload.sourceVersion, "unknown"),
      idempotencyKey: this.readString(input.payload.idempotencyKey, "unknown"),
      replayToken: this.readString(input.payload.replayToken, "unknown"),
      status: "retry_scheduled",
      attempts: this.readNumber(input.payload.attempt, 1),
      occurredAt: this.readString(input.payload.occurredAt, input.occurredAt),
      replay: []
    };
  }

  private async loadIndexVersions(
    nodes: EventNode[]
  ): Promise<
    Map<
      string,
      {
        id: string;
        status: string;
        sourceVersion: string;
        activatedAt?: string;
      }
    >
  > {
    const ids = Array.from(
      new Set(
        nodes
          .map((item) => item.indexVersionId)
          .filter((item): item is string => Boolean(item))
      )
    );
    const versions = await Promise.all(
      ids.map(async (id) => {
        const version = await this.ragIndexRepository.getVersionById(id);
        if (!version) {
          return undefined;
        }
        return {
          id: version.id,
          status: version.status,
          sourceVersion: version.sourceVersion,
          activatedAt: version.activatedAt
        };
      })
    );

    const map = new Map<
      string,
      {
        id: string;
        status: string;
        sourceVersion: string;
        activatedAt?: string;
      }
    >();
    for (const version of versions) {
      if (version) {
        map.set(version.id, version);
      }
    }
    return map;
  }

  private parsePayload(payload: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }
      return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private resolveEventId(replayKey: string, payloadEventId: unknown): string | undefined {
    if (typeof payloadEventId === "string" && payloadEventId.trim()) {
      return payloadEventId.trim();
    }

    const segments = replayKey.split(":");
    if (segments.length < 4) {
      return undefined;
    }
    return segments[3];
  }

  private readString(input: unknown, fallback: string): string {
    if (typeof input !== "string") {
      return fallback;
    }
    const normalized = input.trim();
    return normalized || fallback;
  }

  private readOptionalString(input: unknown): string | undefined {
    if (typeof input !== "string") {
      return undefined;
    }
    const normalized = input.trim();
    return normalized || undefined;
  }

  private readNumber(input: unknown, fallback: number): number {
    if (typeof input !== "number" || !Number.isFinite(input)) {
      return fallback;
    }
    return Math.max(1, Math.floor(input));
  }

  private readMetadataEventId(metadata: Record<string, unknown> | null | undefined): string {
    const value = metadata?.eventId;
    if (typeof value !== "string") {
      return "";
    }
    return value.trim();
  }

  private parseTimestamp(input?: string): number | undefined {
    if (!input) {
      return undefined;
    }
    const parsed = Date.parse(input);
    if (Number.isNaN(parsed)) {
      return undefined;
    }
    return parsed;
  }

  private isWithinWindow(
    occurredAt: string,
    fromAt?: number,
    toAt?: number
  ): boolean {
    const current = Date.parse(occurredAt);
    if (Number.isNaN(current)) {
      return true;
    }
    if (fromAt !== undefined && current < fromAt) {
      return false;
    }
    if (toAt !== undefined && current > toAt) {
      return false;
    }
    return true;
  }
}
