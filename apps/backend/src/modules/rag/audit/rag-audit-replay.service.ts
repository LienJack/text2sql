import type { ExecutionTrace } from "@text2sql/shared-types";
import { Injectable } from "@nestjs/common";
import type { GovernanceAuditLog } from "../../data/persistence/audit-log.repository";
import { AuditLogRepository } from "../../data/persistence/audit-log.repository";
import { ChatRepository } from "../../data/persistence/chat.repository";
import { RagIndexRepository } from "../index/rag-index.repository";
import type { RagReplayRecord } from "../observability/rag-replay.repository";
import { RagReplayRepository } from "../observability/rag-replay.repository";

export interface RagAuditReplayQueryInput {
  runId?: string;
  requestId?: string;
  fromAt?: string;
  toAt?: string;
}

export interface RagAuditReplayEventRecord {
  eventId: string;
  eventType: string;
  requestId?: string;
  datasourceId: string;
  sourceVersion: string;
  idempotencyKey: string;
  replayToken: string;
  status: "processed" | "retry_scheduled" | "dlq" | "noop";
  attempts: number;
  occurredAt: string;
  processedAt?: string;
  failureReason?: string;
  anchor?: {
    anchorId: string;
    anchorType: "release" | "rollback";
    anchorVersion: number;
    scope?: "global" | "datasource";
    scopeKey?: string;
    rollbackFromAnchorId?: string;
    rollbackReason?: string | null;
  };
  semanticSnapshot?: {
    versionId: string;
    domain: string;
    semanticVersion: number;
    status: "active" | "deprecated";
    riskTags: string[];
  };
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
  requestId?: string;
  runTrace?: ExecutionTrace;
  events: RagAuditReplayEventRecord[];
  generatedAt: string;
}

interface EventNode {
  eventId: string;
  eventSource: "incremental" | "glossary";
  eventType: string;
  requestId?: string;
  datasourceId: string;
  sourceVersion: string;
  idempotencyKey: string;
  replayToken: string;
  status: "processed" | "retry_scheduled" | "dlq" | "noop";
  attempts: number;
  occurredAt: string;
  processedAt?: string;
  failureReason?: string;
  anchor?: {
    anchorId: string;
    anchorType: "release" | "rollback";
    anchorVersion: number;
    scope?: "global" | "datasource";
    scopeKey?: string;
    rollbackFromAnchorId?: string;
    rollbackReason?: string | null;
  };
  semanticSnapshot?: {
    versionId: string;
    domain: string;
    semanticVersion: number;
    status: "active" | "deprecated";
    riskTags: string[];
  };
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
    const requestedRunId = input.runId?.trim() || "";
    const requestedRequestId = input.requestId?.trim() || "";
    if (!requestedRunId && !requestedRequestId) {
      return {
        runId: "",
        requestId: requestedRequestId || undefined,
        events: [],
        generatedAt: new Date().toISOString()
      };
    }

    const auditRows = await this.auditLogRepository.listEvents({
      runId: requestedRunId || undefined,
      requestId: requestedRequestId || undefined,
      limit: 500
    });
    const resolvedRunId = requestedRunId || auditRows.find((item) => item.runId)?.runId || "";
    const [replayRows, run] = await Promise.all([
      resolvedRunId ? this.ragReplayRepository.listByRunId(resolvedRunId) : Promise.resolve([]),
      resolvedRunId ? this.chatRepository.getRunById(resolvedRunId) : Promise.resolve(undefined)
    ]);

    const fromAt = this.parseTimestamp(input.fromAt);
    const toAt = this.parseTimestamp(input.toAt);
    const eventNodes = this.buildEventNodes(replayRows);
    const filteredNodes = eventNodes.filter((item) => {
      if (!this.isWithinWindow(item.occurredAt, fromAt, toAt)) {
        return false;
      }
      if (requestedRequestId && item.requestId !== requestedRequestId) {
        return false;
      }
      return true;
    });
    const scopedNodes = requestedRequestId
      ? filteredNodes
      : filteredNodes.filter((item) => item.eventSource === "incremental");

    const indexVersionMap = await this.loadIndexVersions(scopedNodes);
    const relevantAuditRows = auditRows.filter((item) => {
      if (requestedRequestId && item.requestId !== requestedRequestId) {
        return false;
      }
      if (!requestedRequestId && !item.eventType.startsWith("rag.incremental-refresh")) {
        return false;
      }
      return Boolean(this.readMetadataEventId(item.metadata));
    });

    const events = scopedNodes
      .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt))
      .map((item) => ({
        eventId: item.eventId,
        eventType: item.eventType,
        requestId: item.requestId,
        datasourceId: item.datasourceId,
        sourceVersion: item.sourceVersion,
        idempotencyKey: item.idempotencyKey,
        replayToken: item.replayToken,
        status: item.status,
        attempts: item.attempts,
        occurredAt: item.occurredAt,
        processedAt: item.processedAt,
        failureReason: item.failureReason,
        anchor: item.anchor ? { ...item.anchor } : undefined,
        semanticSnapshot: item.semanticSnapshot
          ? {
              versionId: item.semanticSnapshot.versionId,
              domain: item.semanticSnapshot.domain,
              semanticVersion: item.semanticSnapshot.semanticVersion,
              status: item.semanticSnapshot.status,
              riskTags: [...item.semanticSnapshot.riskTags]
            }
          : undefined,
        indexVersion: item.indexVersionId
          ? indexVersionMap.get(item.indexVersionId)
          : undefined,
        replay: [...item.replay],
        audits: relevantAuditRows.filter(
          (auditRow) => this.readMetadataEventId(auditRow.metadata) === item.eventId
        )
      }));

    return {
      runId: resolvedRunId,
      requestId: requestedRequestId || undefined,
      runTrace: run?.trace,
      events,
      generatedAt: new Date().toISOString()
    };
  }

  private buildEventNodes(rows: RagReplayRecord[]): EventNode[] {
    const nodes = new Map<string, EventNode>();
    for (const row of rows) {
      const payload = this.parsePayload(row.payload);
      if (row.replayKey.startsWith("incremental:event:")) {
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
          current.requestId = this.readOptionalString(payload.requestId) ?? current.requestId;
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
        continue;
      }

      if (row.stage.startsWith("glossary_anchor_")) {
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
        current.eventType = this.readString(
          payload.eventType,
          row.stage === "glossary_anchor_release"
            ? "glossary.anchor.created"
            : "glossary.anchor.rollback"
        );
        current.eventSource = "glossary";
        current.requestId = this.readOptionalString(payload.requestId) ?? current.requestId;
        current.datasourceId = this.readString(payload.datasourceId, current.datasourceId);
        current.sourceVersion = this.readGlossarySourceVersion(payload, current.sourceVersion);
        current.idempotencyKey = this.readString(
          payload.idempotencyKey,
          current.idempotencyKey
        );
        current.replayToken = this.readString(payload.replayToken, row.replayKey);
        const normalizedStatus = this.readString(
          payload.status,
          row.stage === "glossary_anchor_rollback_noop" ? "noop" : "processed"
        );
        current.status =
          normalizedStatus === "noop"
            ? "noop"
            : normalizedStatus === "processed"
              ? "processed"
              : current.status;
        current.attempts = this.readNumber(payload.attempt, 1);
        current.processedAt = row.createdAt;
        current.occurredAt = this.readString(payload.occurredAt, row.createdAt);
        current.failureReason =
          this.readOptionalString(payload.failureReason) ?? current.failureReason;
        current.anchor =
          this.readGlossaryAnchor(payload) ??
          current.anchor;
        current.semanticSnapshot =
          this.readSemanticSnapshot(payload) ??
          current.semanticSnapshot;
        current.replay.push({
          replayKey: row.replayKey,
          stage: row.stage,
          createdAt: row.createdAt
        });
        nodes.set(eventId, current);
      }
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
      eventSource: "incremental",
      eventType: this.readString(input.payload.eventType, "unknown"),
      requestId: this.readOptionalString(input.payload.requestId),
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

  private readGlossarySourceVersion(payload: Record<string, unknown>, fallback: string): string {
    const anchorVersion = payload.anchorVersion;
    if (typeof anchorVersion === "number" && Number.isFinite(anchorVersion)) {
      return `glossary-v${Math.floor(anchorVersion)}`;
    }
    return this.readString(anchorVersion, fallback);
  }

  private readGlossaryAnchor(payload: Record<string, unknown>):
    | {
        anchorId: string;
        anchorType: "release" | "rollback";
        anchorVersion: number;
        scope?: "global" | "datasource";
        scopeKey?: string;
        rollbackFromAnchorId?: string;
        rollbackReason?: string | null;
      }
    | undefined {
    const anchorId = this.readOptionalString(payload.anchorId);
    if (!anchorId) {
      return undefined;
    }
    const anchorVersionRaw = payload.anchorVersion;
    const anchorVersion =
      typeof anchorVersionRaw === "number" && Number.isFinite(anchorVersionRaw)
        ? Math.max(1, Math.floor(anchorVersionRaw))
        : 1;
    const anchorTypeRaw = this.readString(payload.anchorType, "release");
    const anchorType = anchorTypeRaw === "rollback" ? "rollback" : "release";
    const scopeRaw = this.readOptionalString(payload.scope);
    const scope =
      scopeRaw === "global" || scopeRaw === "datasource" ? scopeRaw : undefined;

    return {
      anchorId,
      anchorType,
      anchorVersion,
      scope,
      scopeKey: this.readOptionalString(payload.scopeKey),
      rollbackFromAnchorId: this.readOptionalString(payload.rollbackFromAnchorId),
      rollbackReason:
        this.readOptionalString(payload.rollbackReason) ??
        (payload.rollbackReason === null ? null : undefined)
    };
  }

  private readSemanticSnapshot(payload: Record<string, unknown>):
    | {
        versionId: string;
        domain: string;
        semanticVersion: number;
        status: "active" | "deprecated";
        riskTags: string[];
      }
    | undefined {
    const snapshotRaw = payload.semanticSnapshot;
    if (!snapshotRaw || typeof snapshotRaw !== "object" || Array.isArray(snapshotRaw)) {
      return undefined;
    }
    const snapshot = snapshotRaw as Record<string, unknown>;
    const versionId = this.readOptionalString(snapshot.versionId);
    const domain = this.readOptionalString(snapshot.domain);
    const semanticVersionRaw = snapshot.semanticVersion;
    if (!versionId || !domain || typeof semanticVersionRaw !== "number") {
      return undefined;
    }
    const statusRaw = this.readString(snapshot.status, "active");
    const status = statusRaw === "deprecated" ? "deprecated" : "active";
    const riskTagsRaw = snapshot.riskTags;
    const riskTags = Array.isArray(riskTagsRaw)
      ? riskTagsRaw
          .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
          .filter((tag): tag is string => Boolean(tag))
      : [];

    return {
      versionId,
      domain,
      semanticVersion: Math.max(1, Math.floor(semanticVersionRaw)),
      status,
      riskTags
    };
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
