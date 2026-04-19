import { Injectable } from "@nestjs/common";
import type { PromptTemplateTraceEvidenceCompat, SqlRun } from "@text2sql/shared-types";
import {
  DeliveryContractMapper,
  type DeliveryReplayRecordInput
} from "../../../delivery/delivery-contract.mapper";
import { RagReplayRepository } from "../../../../knowledge/rag/observability/rag-replay.repository";

@Injectable()
export class ChatDeliveryEnrichmentService {
  constructor(
    private readonly deliveryContractMapper: DeliveryContractMapper,
    private readonly ragReplayRepository: RagReplayRepository
  ) {}

  async attachDeliveryContract(run: SqlRun): Promise<SqlRun> {
    try {
      const replayRecords = await this.loadReplayRecords(run.runId);
      const delivery = this.deliveryContractMapper.map({
        run,
        replayRecords
      });
      return this.withPromptTemplateEvidence({
        ...run,
        delivery
      });
    } catch {
      return this.withPromptTemplateEvidence({
        ...run,
        delivery: this.deliveryContractMapper.buildFallback(
          run,
          "delivery_mapper_failed"
        )
      });
    }
  }

  withPromptTemplateEvidence(run: SqlRun): SqlRun {
    const traceWithCompat = run.trace as SqlRun["trace"] & {
      prompt_template?: unknown;
      prompt_template_evidence?: unknown;
      templateEvidence?: unknown;
    };
    const tracePromptTemplate = this.normalizePromptTemplateTraceEvidence(
      traceWithCompat.promptTemplate ??
        traceWithCompat.prompt_template ??
        traceWithCompat.prompt_template_evidence ??
        traceWithCompat.templateEvidence
    );
    const evidencePromptTemplate = this.normalizePromptTemplateTraceEvidence(
      run.delivery?.evidence?.promptTemplate
    );
    const resolvedPromptTemplate = evidencePromptTemplate ?? tracePromptTemplate;

    const normalizedTrace = resolvedPromptTemplate
      ? {
          ...run.trace,
          promptTemplate: resolvedPromptTemplate
        }
      : run.trace;

    if (!run.delivery) {
      return normalizedTrace === run.trace ? run : { ...run, trace: normalizedTrace };
    }

    const nextEvidence =
      run.delivery.evidence || resolvedPromptTemplate
        ? {
            runId: run.delivery.evidence?.runId ?? run.runId,
            ...run.delivery.evidence,
            ...(resolvedPromptTemplate
              ? {
                  promptTemplate: resolvedPromptTemplate
                }
              : {})
          }
        : run.delivery.evidence;

    return {
      ...run,
      trace: normalizedTrace,
      delivery: {
        ...run.delivery,
        ...(nextEvidence ? { evidence: nextEvidence } : {})
      }
    };
  }

  private normalizePromptTemplateTraceEvidence(
    value: unknown
  ): SqlRun["trace"]["promptTemplate"] | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }
    const candidate = value as PromptTemplateTraceEvidenceCompat;
    const templateId = this.readNonEmptyString(candidate.templateId ?? candidate.template_id);
    const scope = this.normalizePromptTemplateScope(
      candidate.scope ??
        candidate.scope_type ??
        candidate.template_scope ??
        (this.isRecord(value) ? (value.scopeType as unknown) : undefined)
    );
    const version = this.readPositiveInteger(
      candidate.version ??
        candidate.template_version ??
        (this.isRecord(value) ? (value.templateVersion as unknown) : undefined)
    );
    const fallbackReason = this.readNonEmptyString(
      candidate.fallbackReason ??
        candidate.fallback_reason ??
        (this.isRecord(value) ? (value.fallback_reason_code as unknown) : undefined)
    );
    const scene = this.normalizePromptTemplateScene(
      candidate.scene ?? candidate.scene_name ?? candidate.template_scene
    );

    if (!templateId && !scope && version === undefined && !fallbackReason && !scene) {
      return undefined;
    }

    return {
      ...(templateId ? { templateId } : {}),
      ...(scene ? { scene } : {}),
      ...(scope ? { scope } : {}),
      ...(version !== undefined ? { version } : {}),
      ...(fallbackReason ? { fallbackReason } : {})
    };
  }

  private normalizePromptTemplateScope(
    raw: unknown
  ): "global" | "workspace" | "datasource" | undefined {
    const normalized = this.readNonEmptyString(raw)?.toLowerCase();
    if (
      normalized === "global" ||
      normalized === "workspace" ||
      normalized === "datasource"
    ) {
      return normalized;
    }
    return undefined;
  }

  private normalizePromptTemplateScene(raw: unknown): "sql" | "analysis" | undefined {
    const normalized = this.readNonEmptyString(raw)?.toLowerCase();
    if (normalized === "sql" || normalized === "analysis") {
      return normalized;
    }
    if (normalized === "sql_generation") {
      return "sql";
    }
    return undefined;
  }

  private readPositiveInteger(raw: unknown): number | undefined {
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
      return Math.floor(raw);
    }
    if (typeof raw === "string" && raw.trim().length > 0) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.floor(parsed);
      }
    }
    return undefined;
  }

  private readNonEmptyString(raw: unknown): string | undefined {
    if (typeof raw !== "string") {
      return undefined;
    }
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  private async loadReplayRecords(runId: string): Promise<DeliveryReplayRecordInput[]> {
    const records = await this.ragReplayRepository.listByRunId(runId);
    return records.map((item) => ({
      replayKey: item.replayKey,
      stage: item.stage,
      indexVersionId: item.indexVersionId,
      payload: item.payload,
      createdAt: item.createdAt
    }));
  }
}
