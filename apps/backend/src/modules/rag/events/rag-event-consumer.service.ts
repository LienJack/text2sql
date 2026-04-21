import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { AuditLogRepository } from "../../platform/data/persistence/index";
import { SemanticRegistryService } from "../../knowledge/semantic-registry/semantic-registry.service";
import type { RagChunkBuildInput } from "../index/rag-index.repository";
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

interface GlossaryPromotionTerm {
  id: string;
  term: string;
  definition: string;
  scope: "global" | "datasource";
  datasourceId?: string;
  priority: number;
  updatedAt: string;
  synonyms: string[];
}

const MAX_EVENT_ATTEMPTS = 3;
const GLOSSARY_CONFLICT_RESOLUTION = "priority_then_updated_at";
const SEMANTIC_PROMOTED_FAILURE_REASON = "semantic_promoted_linkage_failed";
const SEMANTIC_PROMOTED_DEGRADED_REASON = "semantic_promoted_linkage_degraded";

@Injectable()
export class RagEventConsumerService {
  private readonly attemptsByIdempotency = new Map<string, number>();
  private readonly terminalResultsByIdempotency = new Map<string, RagEventConsumeResult>();
  private semanticRegistryService?: SemanticRegistryService;

  constructor(
    private readonly buildRagIndexJob: BuildRagIndexJob,
    private readonly ragReplayRepository: RagReplayRepository,
    private readonly auditLogRepository: AuditLogRepository,
    private readonly moduleRef?: ModuleRef
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
      const semanticPromotion =
        event.eventType === "semantic_promoted"
          ? await this.prepareSemanticPromotedPayload(event)
          : undefined;
      const buildResult = await this.buildRagIndexJob.run({
        datasourceId: event.datasourceId,
        sourceVersion: event.sourceVersion,
        buildReason: `incremental_refresh:${event.eventType}`,
        runId: event.runId,
        chunks: semanticPromotion?.chunks
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
          indexVersionId: buildResult.indexVersionId,
          semanticPromotion
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
          semanticPromotion,
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

  private async prepareSemanticPromotedPayload(event: NormalizedEvent): Promise<{
    chunkCount: number;
    linkageStatus: "success" | "degraded";
    linkageDegradeReason?: string;
    chunks: RagChunkBuildInput[];
  }> {
    const payload = event.payload;
    const glossaryTerms = this.readGlossaryTerms(payload, event.datasourceId);
    if (glossaryTerms.length === 0) {
      throw new Error(SEMANTIC_PROMOTED_FAILURE_REASON);
    }

    const linkageStatus = this.readString(payload.linkageStatus) === "degraded" ? "degraded" : "success";
    const linkageDegradeReason = this.readString(payload.degradeReason);
    const grouped = this.groupGlossaryTerms(glossaryTerms);
    const chunks: RagChunkBuildInput[] = [];

    for (const [scopeKey, terms] of grouped.entries()) {
      const resolvedTerms = this.resolveWinnersByConflictKey(terms);
      for (const resolved of resolvedTerms) {
        const winner = resolved.winner;
        const candidatesForSemanticVersion = [
          winner,
          ...resolved.losers
        ];
        const canonicalDomain =
          winner.scope === "datasource" && winner.datasourceId
            ? this.getSemanticRegistryService()?.buildDatasourceScopedDomain(
                "semantic_term",
                winner.datasourceId
              ) ?? this.buildFallbackDatasourceDomain("semantic_term", winner.datasourceId)
            : "semantic_term";
        await this.publishSemanticRegistryFromGlossary({
          runId: event.runId,
          occurredAt: event.occurredAt,
          domain: canonicalDomain,
          terms: candidatesForSemanticVersion,
          winner
        });

        chunks.push({
          id: `semantic-promoted:${scopeKey}:${winner.term.toLowerCase()}`,
          datasourceId: event.datasourceId,
          domain: "semantic_term",
          content: this.buildSemanticChunkContent(winner),
          metadata: JSON.stringify({
            chunkProfile: "semantic_term",
            tableNames: [],
            columnNames: [],
            glossary: {
              source: "glossary",
              scope: winner.scope,
              scopeKey,
              datasourceId: winner.datasourceId ?? null,
              winnerTermId: winner.id,
              loserTermIds: resolved.losers.map((item) => item.id),
              conflictResolution: GLOSSARY_CONFLICT_RESOLUTION,
              priority: winner.priority,
              updatedAt: winner.updatedAt
            },
            linkageStatus,
            linkageDegradeReason:
              linkageStatus === "degraded"
                ? linkageDegradeReason ?? SEMANTIC_PROMOTED_DEGRADED_REASON
                : undefined,
            semanticHitClues: ["semantic_hit:glossary"]
          })
        });
      }
    }

    return {
      chunkCount: chunks.length,
      linkageStatus,
      linkageDegradeReason:
        linkageStatus === "degraded"
          ? linkageDegradeReason ?? SEMANTIC_PROMOTED_DEGRADED_REASON
          : undefined,
      chunks
    };
  }

  private readGlossaryTerms(
    payload: Record<string, unknown>,
    eventDatasourceId: string
  ): GlossaryPromotionTerm[] {
    const raw = payload.glossaryTerms;
    if (!Array.isArray(raw)) {
      return [];
    }
    const terms: GlossaryPromotionTerm[] = [];
    for (const item of raw) {
      if (!this.isRecord(item)) {
        continue;
      }
      const term = this.readString(item.term);
      const definition = this.readString(item.definition);
      if (!term || !definition) {
        continue;
      }
      const scope = this.readString(item.scope) === "datasource" ? "datasource" : "global";
      const datasourceId =
        scope === "datasource"
          ? this.readString(item.datasourceId) ?? eventDatasourceId
          : undefined;
      const priorityRaw = item.priority;
      const priority =
        typeof priorityRaw === "number" && Number.isFinite(priorityRaw)
          ? Math.floor(priorityRaw)
          : 50;
      const updatedAt = this.toIsoTimestamp(
        this.readString(item.updatedAt) ?? new Date().toISOString()
      );
      const synonyms = Array.isArray(item.synonyms)
        ? item.synonyms
            .map((candidate) => this.readString(candidate))
            .filter((candidate): candidate is string => Boolean(candidate))
        : [];
      const id =
        this.readString(item.id) ??
        `${scope}:${datasourceId ?? "global"}:${term.toLowerCase()}`;
      terms.push({
        id,
        term,
        definition,
        scope,
        datasourceId,
        priority,
        updatedAt,
        synonyms
      });
    }
    return terms;
  }

  private groupGlossaryTerms(terms: GlossaryPromotionTerm[]): Map<string, GlossaryPromotionTerm[]> {
    const grouped = new Map<string, GlossaryPromotionTerm[]>();
    for (const term of terms) {
      const scopeKey =
        term.scope === "datasource"
          ? `datasource:${term.datasourceId ?? "unknown"}`
          : "global";
      const bucket = grouped.get(scopeKey) ?? [];
      bucket.push(term);
      grouped.set(scopeKey, bucket);
    }
    return grouped;
  }

  private resolveWinnersByConflictKey(terms: GlossaryPromotionTerm[]): Array<{
    winner: GlossaryPromotionTerm;
    losers: GlossaryPromotionTerm[];
  }> {
    const byNormalizedTerm = new Map<string, GlossaryPromotionTerm[]>();
    for (const term of terms) {
      const key = term.term.trim().toLowerCase();
      const bucket = byNormalizedTerm.get(key) ?? [];
      bucket.push(term);
      byNormalizedTerm.set(key, bucket);
    }

    const resolved: Array<{ winner: GlossaryPromotionTerm; losers: GlossaryPromotionTerm[] }> = [];
    for (const bucket of byNormalizedTerm.values()) {
      const sorted = [...bucket].sort((left, right) => {
        if (left.priority !== right.priority) {
          return right.priority - left.priority;
        }
        const updatedAtDiff = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
        if (updatedAtDiff !== 0) {
          return updatedAtDiff;
        }
        return left.id.localeCompare(right.id);
      });
      resolved.push({
        winner: sorted[0]!,
        losers: sorted.slice(1)
      });
    }
    return resolved;
  }

  private async publishSemanticRegistryFromGlossary(input: {
    runId: string;
    occurredAt: string;
    domain: string;
    terms: GlossaryPromotionTerm[];
    winner: GlossaryPromotionTerm;
  }): Promise<void> {
    const service = this.getSemanticRegistryService();
    if (!service) {
      return;
    }

    try {
      await service.publishVersion({
        domain: input.domain,
        releaseSummary: `semantic promoted from glossary (${input.winner.scope})`,
        auditSummary: `event-driven semantic promotion for ${input.winner.term}`,
        publishedByRunId: input.runId,
        activatedByRunId: input.runId,
        activatedAt: input.occurredAt,
        riskTags: ["semantic_promoted"],
        terms: input.terms.map((term) => ({
          term: term.term,
          canonicalKey: this.buildCanonicalKey(term),
          definition: term.definition,
          binding: JSON.stringify({
            source: "glossary",
            scope: term.scope,
            datasourceId: term.datasourceId ?? null,
            priority: term.priority,
            updatedAt: term.updatedAt
          }),
          metadata: JSON.stringify({
            synonyms: term.synonyms,
            conflictResolution: GLOSSARY_CONFLICT_RESOLUTION
          })
        }))
      });
    } catch {
      // Best effort publish; retrieval linkage should remain available via promoted semantic chunks.
    }
  }

  private buildSemanticChunkContent(term: GlossaryPromotionTerm): string {
    const synonyms = term.synonyms.length > 0 ? `; synonyms: ${term.synonyms.join(", ")}` : "";
    const scopeDetail =
      term.scope === "datasource" && term.datasourceId
        ? `datasource ${term.datasourceId}`
        : "global";
    return `${term.term} (${scopeDetail}): ${term.definition}${synonyms}`;
  }

  private buildCanonicalKey(term: GlossaryPromotionTerm): string {
    const scopeKey =
      term.scope === "datasource" && term.datasourceId
        ? `datasource.${term.datasourceId}`
        : "global";
    return `glossary.${scopeKey}.${term.term.trim().toLowerCase()}`;
  }

  private buildFallbackDatasourceDomain(domain: string, datasourceId: string): string {
    return `${domain.trim().toLowerCase()}::datasource::${datasourceId.trim().toLowerCase()}`;
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

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private readString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }
}
