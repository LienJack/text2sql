import { Inject, Injectable } from "@nestjs/common";
import type {
  DeliveryContract,
  SqlRun
} from "@text2sql/shared-types";
import {
  DeliveryContractMapper,
  type DeliveryReplayRecordInput
} from "../../../delivery/delivery-contract.mapper";
import { ChartBiArtifactService } from "../../../delivery/chartbi/chartbi-artifact.service";
import {
  KNOWLEDGE_FACADE_CONTRACT,
  type KnowledgeFacadeContract
} from "../../../../knowledge/contracts/knowledge-facade.contract";

@Injectable()
export class ChatDeliveryEnrichmentService {
  constructor(
    private readonly deliveryContractMapper: DeliveryContractMapper,
    private readonly chartBiArtifactService: ChartBiArtifactService,
    @Inject(KNOWLEDGE_FACADE_CONTRACT)
    private readonly knowledgeFacade: KnowledgeFacadeContract
  ) {}

  async attachDeliveryContract(run: SqlRun): Promise<SqlRun> {
    try {
      const replayRecords = await this.loadReplayRecords(run.runId);
      const chartBiOutcome = this.buildChartBiArtifact(run);
      const delivery = this.deliveryContractMapper.map({
        run,
        replayRecords,
        artifactOverride: chartBiOutcome.artifact,
        additionalRiskTags: chartBiOutcome.riskTags
      });
      return this.withPromptTemplateEvidence({
        ...run,
        answer: delivery.answer.text,
        delivery
      });
    } catch {
      const fallback = this.deliveryContractMapper.buildFallback(
        run,
        "delivery_mapper_failed"
      );
      return this.withPromptTemplateEvidence({
        ...run,
        answer: fallback.answer.text,
        delivery: fallback
      });
    }
  }

  private buildChartBiArtifact(run: SqlRun): {
    artifact?: DeliveryContract["artifact"];
    riskTags: string[];
  } {
    if (!this.shouldBuildChartBiArtifact(run)) {
      return {
        artifact: undefined,
        riskTags: []
      };
    }

    try {
      return {
        artifact: this.chartBiArtifactService.buildFromRun(run),
        riskTags: []
      };
    } catch {
      return {
        artifact: this.buildLegacyArtifact(run),
        riskTags: ["chartbi_artifact_failed"]
      };
    }
  }

  private shouldBuildChartBiArtifact(run: SqlRun): boolean {
    if (run.status !== "executionResult") {
      return false;
    }
    if (run.error) {
      return false;
    }
    return true;
  }

  private buildLegacyArtifact(run: SqlRun): DeliveryContract["artifact"] | undefined {
    const hasArtifact = Boolean(
      run.sql || (run.columns?.length ?? 0) > 0 || (run.rows?.length ?? 0) > 0 || run.error
    );
    if (!hasArtifact) {
      return undefined;
    }
    return {
      sql: run.sql,
      columns: run.columns,
      rowCount: run.rows?.length ?? 0,
      rowsPreview: run.rows?.slice(0, 3),
      hasError: Boolean(run.error)
    };
  }

  withPromptTemplateEvidence(run: SqlRun): SqlRun {
    const tracePromptTemplate = this.normalizePromptTemplateTraceEvidence(
      run.trace.promptTemplate
    );
    const evidencePromptTemplate = this.normalizePromptTemplateTraceEvidence(
      run.delivery?.evidence?.promptTemplate
    );
    const traceEffectiveContextSummary = this.normalizeEffectiveContextSummary(
      run.trace.effectiveContextSummary
    );
    const evidenceEffectiveContextSummary = this.normalizeEffectiveContextSummary(
      run.delivery?.evidence?.effectiveContextSummary
    );
    const traceConflictHint = this.normalizeContextConflictHint(
      run.trace.conflictHint
    );
    const evidenceConflictHint = this.normalizeContextConflictHint(
      run.delivery?.evidence?.conflictHint
    );
    const resolvedPromptTemplate = evidencePromptTemplate ?? tracePromptTemplate;
    const resolvedEffectiveContextSummary =
      evidenceEffectiveContextSummary ?? traceEffectiveContextSummary;
    const resolvedConflictHint = evidenceConflictHint ?? traceConflictHint;
    const resolvedTraceV2 = run.trace.v2;
    const resolvedEvidenceV2 =
      run.delivery?.evidence?.v2 ?? this.buildEvidenceV2FromTrace(run.trace.v2);

    const normalizedTrace = resolvedPromptTemplate
      ? {
          ...run.trace,
          ...(resolvedPromptTemplate ? { promptTemplate: resolvedPromptTemplate } : {}),
          ...(resolvedEffectiveContextSummary
            ? {
                effectiveContextSummary: resolvedEffectiveContextSummary
              }
            : {}),
          ...(resolvedConflictHint
            ? {
                conflictHint: resolvedConflictHint
              }
            : {}),
          ...(resolvedTraceV2
            ? {
                v2: resolvedTraceV2
              }
            : {})
        }
      : ({
          ...run.trace,
          ...(resolvedEffectiveContextSummary
            ? {
                effectiveContextSummary: resolvedEffectiveContextSummary
              }
            : {}),
          ...(resolvedConflictHint
            ? {
                conflictHint: resolvedConflictHint
              }
            : {}),
          ...(resolvedTraceV2
            ? {
                v2: resolvedTraceV2
              }
            : {})
        } as SqlRun["trace"]);

    if (!run.delivery) {
      return normalizedTrace === run.trace ? run : { ...run, trace: normalizedTrace };
    }

    const nextEvidence =
      run.delivery.evidence ||
      resolvedPromptTemplate ||
      resolvedEffectiveContextSummary ||
      resolvedConflictHint ||
      resolvedEvidenceV2
        ? {
            runId: run.delivery.evidence?.runId ?? run.runId,
            ...run.delivery.evidence,
            ...(resolvedPromptTemplate
              ? {
                  promptTemplate: resolvedPromptTemplate
                }
              : {}),
            ...(resolvedEffectiveContextSummary
              ? {
                  effectiveContextSummary: resolvedEffectiveContextSummary
                }
              : {}),
            ...(resolvedConflictHint
              ? {
                  conflictHint: resolvedConflictHint
                }
              : {}),
            ...(resolvedEvidenceV2
              ? {
                  v2: resolvedEvidenceV2
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
    const candidate = value as {
      templateId?: unknown;
      scope?: unknown;
      version?: unknown;
      fallbackReason?: unknown;
      scene?: unknown;
    };
    const templateId = this.readNonEmptyString(candidate.templateId);
    const scope = this.normalizePromptTemplateScope(
      candidate.scope
    );
    const version = this.readPositiveInteger(
      candidate.version
    );
    const fallbackReason = this.readNonEmptyString(
      candidate.fallbackReason
    );
    const scene = this.normalizePromptTemplateScene(
      candidate.scene
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

  private normalizeEffectiveContextSummary(
    value: unknown
  ):
    | {
        sourcePriority: "user_explicit_over_system";
        userEnvelope: {
          metricDefinitionProvided: boolean;
          timeRangeProvided: boolean;
          entityMappingCount: number;
          includeTableCount: number;
          excludeTableCount: number;
          businessConstraintCount: number;
        };
        retrievalContext?: {
          status?: "ready" | "degraded";
          selectedContextCount?: number;
        };
      }
    | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }
    if (value.sourcePriority !== "user_explicit_over_system") {
      return undefined;
    }
    const userEnvelope = this.normalizeEffectiveContextUserEnvelope(value.userEnvelope);
    if (!userEnvelope) {
      return undefined;
    }
    const retrievalContext = this.normalizeEffectiveContextRetrieval(value.retrievalContext);
    return {
      sourcePriority: "user_explicit_over_system",
      userEnvelope,
      ...(retrievalContext ? { retrievalContext } : {})
    };
  }

  private normalizeContextConflictHint(
    value: unknown
  ):
    | {
        hasConflict: boolean;
        preferredSource: "user_explicit";
        reasonCodes?: string[];
      }
    | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }
    if (value.preferredSource !== "user_explicit") {
      return undefined;
    }
    const reasonCodes = this.normalizeStringArray(value.reasonCodes);
    return {
      hasConflict: Boolean(value.hasConflict),
      preferredSource: "user_explicit",
      ...(reasonCodes.length > 0 ? { reasonCodes } : {})
    };
  }

  private normalizeEffectiveContextUserEnvelope(
    value: unknown
  ):
    | {
        metricDefinitionProvided: boolean;
        timeRangeProvided: boolean;
        entityMappingCount: number;
        includeTableCount: number;
        excludeTableCount: number;
        businessConstraintCount: number;
      }
    | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }
    const entityMappingCount = this.readNonNegativeInteger(value.entityMappingCount);
    const includeTableCount = this.readNonNegativeInteger(value.includeTableCount);
    const excludeTableCount = this.readNonNegativeInteger(value.excludeTableCount);
    const businessConstraintCount = this.readNonNegativeInteger(
      value.businessConstraintCount
    );
    if (
      entityMappingCount === undefined ||
      includeTableCount === undefined ||
      excludeTableCount === undefined ||
      businessConstraintCount === undefined
    ) {
      return undefined;
    }
    return {
      metricDefinitionProvided: Boolean(value.metricDefinitionProvided),
      timeRangeProvided: Boolean(value.timeRangeProvided),
      entityMappingCount,
      includeTableCount,
      excludeTableCount,
      businessConstraintCount
    };
  }

  private normalizeEffectiveContextRetrieval(
    value: unknown
  ): { status?: "ready" | "degraded"; selectedContextCount?: number } | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }
    const status =
      value.status === "ready" || value.status === "degraded"
        ? value.status
        : undefined;
    const selectedContextCount = this.readNonNegativeInteger(value.selectedContextCount);
    if (!status && selectedContextCount === undefined) {
      return undefined;
    }
    return {
      ...(status ? { status } : {}),
      ...(selectedContextCount !== undefined ? { selectedContextCount } : {})
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

  private readNonNegativeInteger(raw: unknown): number | undefined {
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
      return Math.floor(raw);
    }
    if (typeof raw === "string" && raw.trim().length > 0) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return Math.floor(parsed);
      }
    }
    return undefined;
  }

  private normalizeStringArray(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
      return [];
    }
    return Array.from(
      new Set(
        raw
          .map((item) => this.readNonEmptyString(item))
          .filter((item): item is string => Boolean(item))
      )
    );
  }

  private buildEvidenceV2FromTrace(
    traceV2: SqlRun["trace"]["v2"] | undefined
  ): NonNullable<NonNullable<SqlRun["delivery"]>["evidence"]>["v2"] | undefined {
    if (!traceV2) {
      return undefined;
    }
    return {
      version: traceV2.version,
      stageOrder: traceV2.stageOrder,
      stageArtifacts: traceV2.stages,
      contextPack: traceV2.contextPack,
      semanticPlan: traceV2.semanticPlan,
      sqlGeneration: traceV2.sqlGeneration,
      sqlValidation: traceV2.sqlValidation,
      runtimePlan: traceV2.runtimePlan,
      artifactRefs: traceV2.artifactRefs,
      smartDefaults: traceV2.smartDefaults,
      loopEvidence: traceV2.loopEvidence,
      terminationReason: traceV2.terminationReason,
      failure:
        traceV2.sqlValidation?.failure ??
        traceV2.stages
          .slice()
          .reverse()
          .find((stage) => stage.status === "failed")?.failure
    };
  }

  private async loadReplayRecords(runId: string): Promise<DeliveryReplayRecordInput[]> {
    const records = await this.knowledgeFacade.rag.replay.listByRunId(runId);
    return records.map((item) => ({
      replayKey: item.replayKey,
      stage: item.stage,
      indexVersionId: item.indexVersionId,
      payload: item.payload,
      createdAt: item.createdAt
    }));
  }
}
