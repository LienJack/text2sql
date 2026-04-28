import { Injectable } from "@nestjs/common";
import type {
  ExecutionTraceStep,
  SemanticContextPackV1,
  SemanticPlanLedgerSummaryV1,
  SemanticPlanV1,
  Text2SqlV2ArtifactRefV1,
  SqlGenerationArtifactV1,
  SqlRun,
  Text2SqlV2LoopEvidence,
  Text2SqlV2RuntimePlanV1,
  Text2SqlV2SmartDefaultsEvidenceV1,
  Text2SqlV2TerminationReason,
  SqlValidationArtifactV1,
  Text2SqlV2FailureSemantic,
  Text2SqlV2RunArtifact,
  Text2SqlV2StageArtifact,
  Text2SqlV2StageName
} from "@text2sql/shared-types";
import { TEXT2SQL_V2_STAGE_ORDER } from "../contracts/text2sql-v2.types";

export interface BuildRunArtifactOptions {
  stageArtifacts?: Text2SqlV2StageArtifact[];
  contextPack?: SemanticContextPackV1;
  semanticPlan?: SemanticPlanV1;
  sqlGeneration?: SqlGenerationArtifactV1;
  sqlValidation?: SqlValidationArtifactV1;
  planLedger?: SemanticPlanLedgerSummaryV1;
  runtimePlan?: Text2SqlV2RuntimePlanV1;
  artifactRefs?: Text2SqlV2ArtifactRefV1[];
  smartDefaults?: Text2SqlV2SmartDefaultsEvidenceV1;
}

@Injectable()
export class Text2SqlV2ArtifactBuilder {
  buildRunArtifact(
    run: SqlRun,
    options?: BuildRunArtifactOptions
  ): Text2SqlV2RunArtifact {
    const stageArtifacts = this.resolveStageArtifacts(run, options?.stageArtifacts);

    return {
      version: "v2",
      stageOrder: [...TEXT2SQL_V2_STAGE_ORDER],
      stages: stageArtifacts,
      contextPack: options?.contextPack ?? this.buildContextPack(run),
      semanticPlan: options?.semanticPlan ?? this.buildSemanticPlan(run),
      sqlGeneration: options?.sqlGeneration ?? this.buildSqlGenerationArtifact(run),
      sqlValidation: options?.sqlValidation ?? this.buildSqlValidationArtifact(run),
      planLedger:
        options?.planLedger ??
        this.resolvePlanLedgerSummary({
          semanticPlan: options?.semanticPlan ?? run.trace.v2?.semanticPlan,
          sqlValidation: options?.sqlValidation ?? run.trace.v2?.sqlValidation,
          tracePlanLedger: run.trace.v2?.planLedger
        }),
      runtimePlan:
        options?.runtimePlan ??
        this.readRuntimePlan(run.trace.v2?.runtimePlan),
      artifactRefs:
        options?.artifactRefs ??
        this.readArtifactRefs(run.trace.v2?.artifactRefs),
      smartDefaults:
        options?.smartDefaults ??
        this.readSmartDefaults(run.trace.v2?.smartDefaults),
      loopEvidence: this.readLoopEvidence(run.trace.loopEvidence),
      terminationReason: this.readTerminationReason(run.trace.terminationReason)
    };
  }

  private resolvePlanLedgerSummary(input: {
    semanticPlan?: SemanticPlanV1;
    sqlValidation?: SqlValidationArtifactV1;
    tracePlanLedger?: SemanticPlanLedgerSummaryV1;
  }): SemanticPlanLedgerSummaryV1 | undefined {
    return (
      input.sqlValidation?.ledgerFulfillment ??
      input.tracePlanLedger ??
      input.semanticPlan?.planLedger?.summary
    );
  }

  private resolveStageArtifacts(
    run: SqlRun,
    stageArtifacts: Text2SqlV2StageArtifact[] | undefined
  ): Text2SqlV2StageArtifact[] {
    const explicitStages = stageArtifacts?.length
      ? stageArtifacts
      : run.trace.v2?.stages?.length
        ? run.trace.v2.stages
        : this.readStageArtifactsFromTraceSteps(run.trace.steps ?? []);
    const byStage = new Map<Text2SqlV2StageName, Text2SqlV2StageArtifact>();

    for (const stage of explicitStages) {
      if (!this.isStageName(stage.stage)) {
        continue;
      }
      byStage.set(stage.stage, this.normalizeStageArtifact(stage));
    }

    if (run.status === "clarification" && !byStage.has("intake")) {
      byStage.set("intake", {
        stage: "intake",
        status: "clarification",
        warnings: ["clarification_terminated_before_runtime_completion"]
      });
    }

    return TEXT2SQL_V2_STAGE_ORDER.map((stage) => {
      const existing = byStage.get(stage);
      if (existing) {
        if (run.status === "clarification" && stage !== "intake" && existing.status === "clarification") {
          return {
            ...existing,
            status: "skipped"
          };
        }
        return existing;
      }
      return {
        stage,
        status: stage === "intake" && run.status === "clarification" ? "clarification" : "skipped"
      };
    });
  }

  private normalizeStageArtifact(stage: Text2SqlV2StageArtifact): Text2SqlV2StageArtifact {
    const startedAt = this.readTimestamp(stage.startedAt);
    const endedAt = this.readTimestamp(stage.endedAt);
    return {
      ...stage,
      startedAt,
      endedAt,
      durationMs:
        stage.durationMs ??
        this.resolveDurationMs(startedAt, endedAt),
      warnings: this.uniqueStrings(stage.warnings),
      evidenceIds: this.uniqueStrings(stage.evidenceIds),
      metadata: stage.metadata ? { ...stage.metadata } : undefined,
      provider: stage.provider ? { ...stage.provider } : undefined,
      failure: stage.failure ? { ...stage.failure } : undefined
    };
  }

  private readStageArtifactsFromTraceSteps(
    steps: ExecutionTraceStep[]
  ): Text2SqlV2StageArtifact[] {
    const byStage = new Map<Text2SqlV2StageName, Text2SqlV2StageArtifact>();
    for (const step of steps) {
      const candidates = [step.outputSummary, step.inputSummary]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
      for (const payload of candidates) {
        const parsed = this.safeParseJson(payload);
        if (!this.isRecord(parsed)) {
          continue;
        }
        const v2 = parsed.v2;
        if (!this.isRecord(v2) || !this.isRecord(v2.stageArtifact)) {
          continue;
        }
        const stageArtifact = this.toStageArtifact(v2.stageArtifact);
        if (!stageArtifact) {
          continue;
        }
        byStage.set(stageArtifact.stage, stageArtifact);
        break;
      }
    }
    return TEXT2SQL_V2_STAGE_ORDER.flatMap((stage) => {
      const artifact = byStage.get(stage);
      return artifact ? [artifact] : [];
    });
  }

  private toStageArtifact(
    payload: Record<string, unknown>
  ): Text2SqlV2StageArtifact | undefined {
    const stage = payload.stage;
    const status = payload.status;
    if (!this.isStageName(stage) || !this.isStageStatus(status)) {
      return undefined;
    }
    return this.normalizeStageArtifact({
      stage,
      status,
      startedAt: this.readTimestamp(payload.startedAt),
      endedAt: this.readTimestamp(payload.endedAt),
      durationMs: this.readNumber(payload.durationMs),
      warnings: this.readStringArray(payload.warnings),
      evidenceIds: this.readStringArray(payload.evidenceIds),
      provider: this.readProviderMetadata(payload.provider),
      failure: this.readFailureSemantic(payload.failure),
      metadata: this.readRecord(payload.metadata)
    });
  }

  private buildContextPack(run: SqlRun): SemanticContextPackV1 {
    const fromGenerateStep = this.readGenerateStepContextPack(run.trace.steps ?? []);
    if (fromGenerateStep) {
      return fromGenerateStep;
    }
    const selectedContext = run.delivery?.evidence?.selectedContext;
    const snippets = selectedContext?.snippets ?? [];
    const selectedEvidenceIds = snippets.map((_, index) => `snippet:${index + 1}`);
    const status = run.delivery?.evidence?.contextPackStatus ?? "degraded";
    const warnings = run.delivery?.evidence?.degradeReasons;
    return {
      status,
      selectedEvidenceIds,
      selectedTables: [],
      selectedColumns: [],
      ...(warnings?.length ? { warnings } : {}),
      version: "v1.rich",
      capabilities: [
        "selected_context_summary",
        "structured_lanes",
        "structured_degradation"
      ],
      selectedContextSummary: {
        count: snippets.length,
        evidenceIds: selectedEvidenceIds.slice(0, 24)
      },
      lanes: {
        tables: {
          ids: [],
          count: 0
        },
        columns: {
          ids: [],
          count: 0
        },
        relationships: {
          refs: [],
          count: 0
        },
        metrics: {
          refs: [],
          count: 0
        }
      },
      degradation: {
        status,
        reasons: warnings ?? []
      },
      pruning: {
        applied: false,
        decisions: []
      },
      permissionFiltering: {
        status: "skipped"
      }
    };
  }

  private buildSemanticPlan(run: SqlRun): SemanticPlanV1 {
    const fromGenerateStep = this.readGenerateStepSemanticPlan(run.trace.steps ?? []);
    if (fromGenerateStep) {
      return fromGenerateStep;
    }
    const usedTables = this.extractSqlTables(run.sql);
    return {
      route:
        run.status === "clarification"
          ? "clarify"
          : run.status === "failed" || run.status === "rejected"
            ? "reject"
            : "answer",
      standaloneQuestion: run.question,
      selectedTables: usedTables,
      selectedColumns: [],
      confidence: usedTables.length > 0 ? 0.8 : 0.4,
      evidenceRefs:
        run.delivery?.evidence?.selectedContext?.snippets?.map((_, index) => `snippet:${index + 1}`) ??
        []
    };
  }

  private buildSqlGenerationArtifact(run: SqlRun): SqlGenerationArtifactV1 | undefined {
    if (!run.sql) {
      return undefined;
    }
    const correctionGrounding = this.readGenerateStepCorrectionGrounding(
      run.trace.steps ?? []
    );
    return {
      sql: run.sql,
      assumptions: run.explanation ? [run.explanation] : undefined,
      usedTables: this.extractSqlTables(run.sql),
      usedColumns: [],
      evidenceRefs:
        run.delivery?.evidence?.selectedContext?.snippets?.map((_, index) => `snippet:${index + 1}`) ??
        [],
      ...(correctionGrounding
        ? {
            correctionGrounding
          }
        : {})
    };
  }

  private buildSqlValidationArtifact(run: SqlRun): SqlValidationArtifactV1 {
    const safetyCheckStep = (run.trace.steps ?? []).find((step) => step.node === "safety-check");
    const passed = safetyCheckStep ? safetyCheckStep.status !== "failed" : run.status !== "rejected";
    return {
      status: passed ? "passed" : "failed",
      checks: [
        {
          check: "read-only",
          status: passed ? "passed" : "failed",
          code: passed ? undefined : "READ_ONLY_REJECTED",
          message: passed ? undefined : run.error ?? "request rejected by read-only policy"
        }
      ],
      correctable: false,
      failure: passed
        ? undefined
        : {
            code: "VALIDATION_FAILED",
            message: run.error ?? "validation failed",
            category: "validation",
            terminal: true,
            correctable: false
          }
    };
  }

  private extractSqlTables(sql?: string): string[] {
    if (!sql) {
      return [];
    }
    const matches = [...sql.matchAll(/\b(?:from|join)\s+([a-zA-Z_][\w$]*(?:\.[a-zA-Z_][\w$]*)?)/gi)];
    const tables = matches
      .map((match) => match[1])
      .filter((item): item is string => Boolean(item))
      .map((item) => item.trim().toLowerCase());
    return Array.from(new Set(tables));
  }

  private readGenerateStepContextPack(
    steps: ExecutionTraceStep[]
  ): SemanticContextPackV1 | undefined {
    const summary = this.readGenerateStepSummary(steps);
    const raw = summary?.semanticContextPack;
    if (!this.isRecord(raw)) {
      return undefined;
    }
    const status = raw.status === "ready" || raw.status === "degraded" ? raw.status : undefined;
    const selectedEvidenceIds = this.readStringArray(raw.selectedEvidenceIds);
    const selectedTables = this.readStringArray(raw.selectedTables);
    const selectedColumns = this.readStringArray(raw.selectedColumns);
    if (!status) {
      return undefined;
    }
    const warnings = this.readStringArray(raw.warnings);
    const version = this.readString(raw.version);
    const capabilities = this.readStringArray(raw.capabilities);
    const semanticVersion = this.readNumber(raw.semanticVersion);
    const modelingRevision = this.readNumber(raw.modelingRevision);
    const semanticLockStatus = this.readSemanticLockStatus(raw.semanticLockStatus);
    const selectedContextSummary = this.readContextPackSelectedContextSummary(
      raw.selectedContextSummary
    );
    const lanes = this.readContextPackLanes(raw.lanes);
    const laneStates = this.readContextPackLaneStates(raw.laneStates);
    const degradation = this.readContextPackDegradation(raw.degradation);
    const pruning = this.readContextPackPruning(raw.pruning);
    const permissionFiltering = this.readContextPackPermissionFiltering(
      raw.permissionFiltering
    );

    return {
      status,
      selectedEvidenceIds,
      selectedTables,
      selectedColumns,
      ...(warnings.length > 0 ? { warnings } : {}),
      ...(version ? { version } : {}),
      ...(capabilities.length > 0 ? { capabilities } : {}),
      ...(semanticVersion !== undefined ? { semanticVersion } : {}),
      ...(modelingRevision !== undefined ? { modelingRevision } : {}),
      ...(semanticLockStatus ? { semanticLockStatus } : {}),
      ...(selectedContextSummary ? { selectedContextSummary } : {}),
      ...(lanes ? { lanes } : {}),
      ...(laneStates.length > 0 ? { laneStates } : {}),
      ...(degradation ? { degradation } : {}),
      ...(pruning ? { pruning } : {}),
      ...(permissionFiltering ? { permissionFiltering } : {})
    };
  }

  private readGenerateStepSemanticPlan(
    steps: ExecutionTraceStep[]
  ): SemanticPlanV1 | undefined {
    const summary = this.readGenerateStepSummary(steps);
    const raw = summary?.semanticPlan;
    if (!this.isRecord(raw)) {
      return undefined;
    }
    const route =
      raw.route === "answer" || raw.route === "clarify" || raw.route === "reject"
        ? raw.route
        : undefined;
    const standaloneQuestion =
      typeof raw.standaloneQuestion === "string" ? raw.standaloneQuestion : undefined;
    const selectedTables = this.readStringArray(raw.selectedTables);
    const selectedColumns = this.readStringArray(raw.selectedColumns);
    const confidence = Number(raw.confidence);
    const evidenceRefs = this.readStringArray(raw.evidenceRefs);
    const coverageGaps = this.readCoverageGaps(raw.coverageGaps);
    const snapshotId = this.readString(raw.snapshotId);
    if (!route || !standaloneQuestion || !Number.isFinite(confidence)) {
      return undefined;
    }
    return {
      route,
      standaloneQuestion,
      selectedTables,
      selectedColumns,
      confidence: Math.max(0, Math.min(1, confidence)),
      evidenceRefs,
      ...(coverageGaps.length > 0 ? { coverageGaps } : {}),
      ...(snapshotId ? { snapshotId } : {}),
      ...(this.readStringArray(raw.metrics).length > 0
        ? { metrics: this.readStringArray(raw.metrics) }
        : {}),
      ...(this.readString(raw.grain) ? { grain: this.readString(raw.grain) } : {}),
      ...(this.readStringArray(raw.filters).length > 0
        ? { filters: this.readStringArray(raw.filters) }
        : {}),
      ...(this.readStringArray(raw.joinPath).length > 0
        ? { joinPath: this.readStringArray(raw.joinPath) }
        : {}),
      ...(this.readStringArray(raw.allowedTables).length > 0
        ? { allowedTables: this.readStringArray(raw.allowedTables) }
        : {}),
      ...(this.readStringArray(raw.forbiddenTables).length > 0
        ? { forbiddenTables: this.readStringArray(raw.forbiddenTables) }
        : {})
    };
  }

  private readGenerateStepCorrectionGrounding(
    steps: ExecutionTraceStep[]
  ): SqlGenerationArtifactV1["correctionGrounding"] | undefined {
    const summary = this.readGenerateStepSummary(steps);
    if (!summary || !this.isRecord(summary.correctionGrounding)) {
      return undefined;
    }
    const raw = summary.correctionGrounding;
    const failedSqlRef = this.readString(raw.failedSqlRef);
    const retryReason = this.readString(raw.retryReason);
    if (!failedSqlRef || !retryReason) {
      return undefined;
    }
    const failureCategory = this.readString(raw.failureCategory);
    const source = this.readString(raw.source);
    const semanticPlanRoute = this.readString(raw.semanticPlanRoute);
    const semanticPlanRouteKind = this.readString(raw.semanticPlanRouteKind);
    const contextPackStatus = this.readString(raw.contextPackStatus);

    return {
      failedSqlRef,
      retryReason,
      ...(this.readString(raw.failedSqlPreview)
        ? {
            failedSqlPreview: this.readString(raw.failedSqlPreview)
          }
        : {}),
      ...(this.readString(raw.failureCode)
        ? {
            failureCode: this.readString(raw.failureCode)
          }
        : {}),
      ...(failureCategory &&
      (failureCategory === "validation" ||
        failureCategory === "governance" ||
        failureCategory === "safety" ||
        failureCategory === "provider" ||
        failureCategory === "execution" ||
        failureCategory === "unknown")
        ? {
            failureCategory
          }
        : {}),
      ...(source && (source === "validation" || source === "execution")
        ? {
            source
          }
        : {}),
      attemptCount: this.readNumber(raw.attemptCount) ?? 0,
      maxAttempts: this.readNumber(raw.maxAttempts) ?? 0,
      evidenceRefs: this.readStringArray(raw.evidenceRefs),
      ...(this.readString(raw.semanticPlanSnapshotId)
        ? {
            semanticPlanSnapshotId: this.readString(raw.semanticPlanSnapshotId)
          }
        : {}),
      ...(semanticPlanRoute &&
      (semanticPlanRoute === "answer" ||
        semanticPlanRoute === "clarify" ||
        semanticPlanRoute === "reject")
        ? {
            semanticPlanRoute
          }
        : {}),
      ...(semanticPlanRouteKind &&
      (semanticPlanRouteKind === "text_to_sql" ||
        semanticPlanRouteKind === "metadata" ||
        semanticPlanRouteKind === "general" ||
        semanticPlanRouteKind === "clarify" ||
        semanticPlanRouteKind === "fail_closed")
        ? {
            semanticPlanRouteKind
          }
        : {}),
      ...(this.readNumber(raw.selectedTableCount) !== undefined
        ? {
            selectedTableCount: this.readNumber(raw.selectedTableCount)
          }
        : {}),
      ...(this.readNumber(raw.selectedColumnCount) !== undefined
        ? {
            selectedColumnCount: this.readNumber(raw.selectedColumnCount)
          }
        : {}),
      ...(contextPackStatus &&
      (contextPackStatus === "ready" || contextPackStatus === "degraded")
        ? {
            contextPackStatus
          }
        : {}),
      ...(this.readNumber(raw.contextPackEvidenceCount) !== undefined
        ? {
            contextPackEvidenceCount: this.readNumber(raw.contextPackEvidenceCount)
          }
        : {})
    };
  }

  private readCoverageGaps(
    value: unknown
  ): NonNullable<SemanticPlanV1["coverageGaps"]> {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => {
        if (!this.isRecord(item)) {
          return undefined;
        }
        const gapType = this.readString(item.gapType);
        const subjectKind = this.readString(item.subjectKind);
        const reasonCode = this.readString(item.reasonCode);
        const impactScope = this.readString(item.impactScope);
        const evidenceRefs = this.readStringArray(item.evidenceRefs);
        if (!gapType || !subjectKind || !reasonCode || !impactScope) {
          return undefined;
        }
        return {
          gapType,
          subjectKind,
          reasonCode,
          evidenceRefs,
          impactScope
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  }

  private readLoopEvidence(value: unknown): Text2SqlV2LoopEvidence[] | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }
    const normalized = value
      .map((item) => {
        if (!this.isRecord(item)) {
          return undefined;
        }
        const loopIndex = this.readNumber(item.loopIndex);
        const triggerReason = this.readString(item.triggerReason);
        const actionType = this.readString(item.actionType);
        const terminationReason = this.readTerminationReason(item.terminationReason);
        const convergencePath = this.readStringArray(item.convergencePath);
        const planDeltaRaw = this.readRecord(item.planDelta);
        const routeDeltaRaw = this.readRecord(planDeltaRaw?.route);
        const planDelta =
          planDeltaRaw || routeDeltaRaw
            ? {
                ...(routeDeltaRaw
                  ? {
                      route: {
                        ...(this.readString(routeDeltaRaw.from)
                          ? { from: this.readString(routeDeltaRaw.from) as SemanticPlanV1["route"] }
                          : {}),
                        ...(this.readString(routeDeltaRaw.to)
                          ? { to: this.readString(routeDeltaRaw.to) as SemanticPlanV1["route"] }
                          : {})
                      }
                    }
                  : {}),
                ...(this.readString(planDeltaRaw?.snapshotId)
                  ? { snapshotId: this.readString(planDeltaRaw?.snapshotId) }
                  : {}),
                ...(this.readStringArray(planDeltaRaw?.addedCoverageGapTypes).length > 0
                  ? {
                      addedCoverageGapTypes: this.readStringArray(
                        planDeltaRaw?.addedCoverageGapTypes
                      ) as string[]
                    }
                  : {}),
                ...(this.readStringArray(planDeltaRaw?.reasonCodes).length > 0
                  ? { reasonCodes: this.readStringArray(planDeltaRaw?.reasonCodes) }
                  : {})
              }
            : undefined;
        if (
          typeof loopIndex !== "number" ||
          !Number.isFinite(loopIndex) ||
          !triggerReason ||
          !actionType
        ) {
          return undefined;
        }
        return {
          loopIndex,
          triggerReason,
          actionType,
          ...(planDelta ? { planDelta } : {}),
          ...(terminationReason ? { terminationReason } : {}),
          ...(convergencePath.length > 0 ? { convergencePath } : {})
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    return normalized.length > 0 ? normalized : undefined;
  }

  private readRuntimePlan(value: unknown): Text2SqlV2RuntimePlanV1 | undefined {
    if (!this.isRecord(value) || value.version !== "runtime-plan.v1") {
      return undefined;
    }
    const items = Array.isArray(value.items)
      ? value.items
          .map((item) => this.readRuntimePlanItem(item))
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
      : [];
    if (items.length === 0) {
      return undefined;
    }
    return {
      version: "runtime-plan.v1",
      items,
      ...(this.readString(value.currentItemId)
        ? { currentItemId: this.readString(value.currentItemId) }
        : {}),
      ...(this.readString(value.summary)
        ? { summary: this.readString(value.summary) }
        : {})
    };
  }

  private readRuntimePlanItem(
    value: unknown
  ): Text2SqlV2RuntimePlanV1["items"][number] | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }
    const id = this.readString(value.id);
    const stage = value.stage;
    const goal = this.readString(value.goal);
    const status = this.readRuntimePlanStatus(value.status);
    if (!id || !this.isStageName(stage) || !goal || !status) {
      return undefined;
    }
    const correctionIntent = this.readRuntimePlanCorrectionIntent(
      value.correctionIntent
    );
    return {
      id,
      stage,
      goal,
      status,
      ...(this.readStringArray(value.reasonCodes).length > 0
        ? { reasonCodes: this.readStringArray(value.reasonCodes) }
        : {}),
      ...(this.readStringArray(value.evidenceRefs).length > 0
        ? { evidenceRefs: this.readStringArray(value.evidenceRefs) }
        : {}),
      ...(correctionIntent ? { correctionIntent } : {}),
      ...(this.readTimestamp(value.startedAt)
        ? { startedAt: this.readTimestamp(value.startedAt) }
        : {}),
      ...(this.readTimestamp(value.endedAt)
        ? { endedAt: this.readTimestamp(value.endedAt) }
        : {}),
      ...(this.readString(value.summary)
        ? { summary: this.readString(value.summary) }
        : {})
    };
  }

  private readRuntimePlanCorrectionIntent(
    value: unknown
  ): Text2SqlV2RuntimePlanV1["items"][number]["correctionIntent"] | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }
    const retryReason = this.readString(value.retryReason);
    if (!retryReason) {
      return undefined;
    }
    const failedStage = value.failedStage;
    const targetStage = value.targetStage;
    return {
      ...(this.isStageName(failedStage) ? { failedStage } : {}),
      ...(this.readString(value.failureCode)
        ? { failureCode: this.readString(value.failureCode) }
        : {}),
      retryReason,
      ...(this.isStageName(targetStage) ? { targetStage } : {})
    };
  }

  private readArtifactRefs(value: unknown): Text2SqlV2ArtifactRefV1[] | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }
    const refs = value
      .map((item) => this.readArtifactRef(item))
      .filter((item): item is Text2SqlV2ArtifactRefV1 => Boolean(item));
    return refs.length > 0 ? refs : undefined;
  }

  private readArtifactRef(value: unknown): Text2SqlV2ArtifactRefV1 | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }
    const id = this.readString(value.id);
    const category = this.readString(value.category);
    const summary = this.readString(value.summary);
    const hash = this.readString(value.hash);
    const visibility = this.readArtifactVisibility(value.visibility);
    if (!id || !category || !summary || !hash || !visibility) {
      return undefined;
    }
    return {
      id,
      category,
      summary,
      hash,
      ...(this.readString(value.version)
        ? { version: this.readString(value.version) }
        : {}),
      ...(this.readNumber(value.sizeBytes) !== undefined
        ? { sizeBytes: this.readNumber(value.sizeBytes) }
        : {}),
      ...(this.readString(value.replayKeyHint)
        ? { replayKeyHint: this.readString(value.replayKeyHint) }
        : {}),
      visibility,
      ...(this.readArtifactSensitivity(value.sensitivity)
        ? { sensitivity: this.readArtifactSensitivity(value.sensitivity) }
        : {}),
      ...(this.readStringArray(value.reasonCodes).length > 0
        ? { reasonCodes: this.readStringArray(value.reasonCodes) }
        : {}),
      ...(this.readStringArray(value.evidenceRefs).length > 0
        ? { evidenceRefs: this.readStringArray(value.evidenceRefs) }
        : {})
    };
  }

  private readSmartDefaults(
    value: unknown
  ): Text2SqlV2SmartDefaultsEvidenceV1 | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }
    const bundleId = this.readString(value.bundleId);
    const version = this.readString(value.version);
    const coveredStages = this.readStageNameArray(value.coveredStages);
    const ruleIds = this.readStringArray(value.ruleIds);
    const status =
      value.status === "applied" || value.status === "fallback"
        ? value.status
        : undefined;
    if (
      !bundleId ||
      !version ||
      coveredStages.length === 0 ||
      ruleIds.length === 0 ||
      !status
    ) {
      return undefined;
    }
    const templateOverlay = this.readSmartDefaultsTemplateOverlay(
      value.templateOverlay
    );
    return {
      bundleId,
      version,
      coveredStages,
      ruleIds,
      status,
      ...(this.readString(value.fallbackReason)
        ? { fallbackReason: this.readString(value.fallbackReason) }
        : {}),
      ...(templateOverlay ? { templateOverlay } : {})
    };
  }

  private readSmartDefaultsTemplateOverlay(
    value: unknown
  ): Text2SqlV2SmartDefaultsEvidenceV1["templateOverlay"] | undefined {
    if (!this.isRecord(value) || typeof value.applied !== "boolean") {
      return undefined;
    }
    return {
      applied: value.applied,
      ...(this.readString(value.templateId)
        ? { templateId: this.readString(value.templateId) }
        : {}),
      ...(this.readNumber(value.version) !== undefined
        ? { version: this.readNumber(value.version) }
        : {})
    };
  }

  private readTerminationReason(
    value: unknown
  ): Text2SqlV2TerminationReason | undefined {
    const normalized = this.readString(value);
    return normalized as Text2SqlV2TerminationReason | undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private readRecord(value: unknown): Record<string, unknown> | undefined {
    return this.isRecord(value) ? value : undefined;
  }

  private readString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  private readTimestamp(value: unknown): string | undefined {
    const text = this.readString(value);
    if (!text) {
      return undefined;
    }
    return Number.isNaN(Date.parse(text)) ? undefined : text;
  }

  private readNumber(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => this.readString(item))
      .filter((item): item is string => Boolean(item));
  }

  private readStageNameArray(value: unknown): Text2SqlV2StageName[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((item): item is Text2SqlV2StageName =>
      this.isStageName(item)
    );
  }

  private readRuntimePlanStatus(
    value: unknown
  ): Text2SqlV2RuntimePlanV1["items"][number]["status"] | undefined {
    if (
      value === "pending" ||
      value === "running" ||
      value === "completed" ||
      value === "skipped" ||
      value === "failed" ||
      value === "clarification"
    ) {
      return value;
    }
    return undefined;
  }

  private readArtifactVisibility(
    value: unknown
  ): Text2SqlV2ArtifactRefV1["visibility"] | undefined {
    if (value === "user" || value === "internal" || value === "redacted") {
      return value;
    }
    return undefined;
  }

  private readArtifactSensitivity(
    value: unknown
  ): Text2SqlV2ArtifactRefV1["sensitivity"] | undefined {
    if (
      value === "none" ||
      value === "permission_filtered" ||
      value === "provider_raw" ||
      value === "sensitive"
    ) {
      return value;
    }
    return undefined;
  }

  private readSemanticLockStatus(
    value: unknown
  ): "locked" | "fallback" | "degraded" | undefined {
    if (value === "locked" || value === "fallback" || value === "degraded") {
      return value;
    }
    return undefined;
  }

  private readContextPackSelectedContextSummary(
    value: unknown
  ): SemanticContextPackV1["selectedContextSummary"] | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }
    const count = this.readNumber(value.count);
    const evidenceIds = this.readStringArray(value.evidenceIds);
    if (count === undefined) {
      return undefined;
    }
    const laneNames = this.readStringArray(value.laneNames);
    return {
      count,
      evidenceIds,
      ...(laneNames.length > 0 ? { laneNames } : {})
    };
  }

  private readContextPackLanes(
    value: unknown
  ): SemanticContextPackV1["lanes"] | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }
    const tables = this.readIdentifierLane(value.tables);
    const columns = this.readIdentifierLane(value.columns);
    const aliases = this.readIdentifierLane(value.aliases);
    const relationships = this.readReferenceLane(value.relationships);
    const metrics = this.readReferenceLane(value.metrics);
    const calculatedFields = this.readReferenceLane(value.calculatedFields);
    const examples = this.readReferenceLane(value.examples);
    const instructions = this.readReferenceLane(value.instructions);
    const priorSql = this.readReferenceLane(value.priorSql);
    const schemaSupplementRefs = this.readReferenceLane(value.schemaSupplementRefs);
    const dialectFunctions = this.readReferenceLane(value.dialectFunctions);
    const semanticBindings = this.readContextPackSemanticBindings(value.semanticBindings);

    if (!tables || !columns || !relationships || !metrics) {
      return undefined;
    }

    return {
      tables,
      columns,
      ...(aliases ? { aliases } : {}),
      relationships,
      metrics,
      ...(calculatedFields ? { calculatedFields } : {}),
      ...(examples ? { examples } : {}),
      ...(instructions ? { instructions } : {}),
      ...(priorSql ? { priorSql } : {}),
      ...(schemaSupplementRefs ? { schemaSupplementRefs } : {}),
      ...(dialectFunctions ? { dialectFunctions } : {}),
      ...(semanticBindings ? { semanticBindings } : {})
    };
  }

  private readIdentifierLane(
    value: unknown
  ): {
    ids: string[];
    count: number;
    reasonCodes?: string[];
  } | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }
    const ids = this.readStringArray(value.ids);
    const count = this.readNumber(value.count);
    if (count === undefined) {
      return undefined;
    }
    const reasonCodes = this.readStringArray(value.reasonCodes);
    return {
      ids,
      count,
      ...(reasonCodes.length > 0 ? { reasonCodes } : {})
    };
  }

  private readReferenceLane(
    value: unknown
  ): {
    refs: string[];
    count: number;
    reasonCodes?: string[];
  } | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }
    const refs = this.readStringArray(value.refs);
    const count = this.readNumber(value.count);
    if (count === undefined) {
      return undefined;
    }
    const reasonCodes = this.readStringArray(value.reasonCodes);
    return {
      refs,
      count,
      ...(reasonCodes.length > 0 ? { reasonCodes } : {})
    };
  }

  private readContextPackSemanticBindings(
    value: unknown
  ): {
    modelKeys?: string[];
    relationshipKeys?: string[];
    metricKeys?: string[];
    calculatedFieldKeys?: string[];
  } | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }
    const modelKeys = this.readStringArray(value.modelKeys);
    const relationshipKeys = this.readStringArray(value.relationshipKeys);
    const metricKeys = this.readStringArray(value.metricKeys);
    const calculatedFieldKeys = this.readStringArray(value.calculatedFieldKeys);
    if (
      modelKeys.length === 0 &&
      relationshipKeys.length === 0 &&
      metricKeys.length === 0 &&
      calculatedFieldKeys.length === 0
    ) {
      return undefined;
    }
    return {
      ...(modelKeys.length > 0 ? { modelKeys } : {}),
      ...(relationshipKeys.length > 0 ? { relationshipKeys } : {}),
      ...(metricKeys.length > 0 ? { metricKeys } : {}),
      ...(calculatedFieldKeys.length > 0 ? { calculatedFieldKeys } : {})
    };
  }

  private readContextPackLaneStates(
    value: unknown
  ): NonNullable<SemanticContextPackV1["laneStates"]> {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => {
        if (!this.isRecord(item)) {
          return undefined;
        }
        const lane = this.readString(item.lane);
        const state = this.readString(item.state);
        if (!lane || !state) {
          return undefined;
        }
        const refs = this.readStringArray(item.refs);
        const reasonCodes = this.readStringArray(item.reasonCodes);
        const unavailableReason = this.readString(item.unavailableReason);
        const fallbackReason = this.readString(item.fallbackReason);
        const inputCount = this.readNumber(item.inputCount);
        const outputCount = this.readNumber(item.outputCount);
        const selectedCount = this.readNumber(item.selectedCount);
        return {
          lane,
          state,
          ...(refs.length > 0 ? { refs } : {}),
          ...(reasonCodes.length > 0 ? { reasonCodes } : {}),
          ...(unavailableReason ? { unavailableReason } : {}),
          ...(fallbackReason ? { fallbackReason } : {}),
          ...(inputCount !== undefined ? { inputCount } : {}),
          ...(outputCount !== undefined ? { outputCount } : {}),
          ...(selectedCount !== undefined ? { selectedCount } : {})
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  }

  private readContextPackDegradation(
    value: unknown
  ): SemanticContextPackV1["degradation"] | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }
    const status =
      value.status === "ready" || value.status === "degraded" ? value.status : undefined;
    if (!status) {
      return undefined;
    }
    const reasons = this.readStringArray(value.reasons);
    const riskTags = this.readStringArray(value.riskTags);
    const denseUnavailableReason = this.readString(value.denseUnavailableReason);
    const rerankUnavailableReason = this.readString(value.rerankUnavailableReason);
    const laneIssues = this.readContextPackLaneStates(value.laneIssues);
    return {
      status,
      reasons,
      ...(riskTags.length > 0 ? { riskTags } : {}),
      ...(denseUnavailableReason ? { denseUnavailableReason } : {}),
      ...(rerankUnavailableReason ? { rerankUnavailableReason } : {}),
      ...(laneIssues.length > 0 ? { laneIssues } : {})
    };
  }

  private readContextPackPruning(
    value: unknown
  ): SemanticContextPackV1["pruning"] | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }
    const applied = typeof value.applied === "boolean" ? value.applied : undefined;
    if (applied === undefined || !Array.isArray(value.decisions)) {
      return undefined;
    }
    const decisions = value.decisions
      .map((decision) => {
        if (!this.isRecord(decision)) {
          return undefined;
        }
        const budgetSource = this.readString(decision.budgetSource);
        const keptEvidenceIds = this.readStringArray(decision.keptEvidenceIds);
        const removedEvidenceIds = this.readStringArray(decision.removedEvidenceIds);
        const keptCount = this.readNumber(decision.keptCount);
        const removedCount = this.readNumber(decision.removedCount);
        const reasonCodes = this.readStringArray(decision.reasonCodes);
        const summary = this.readString(decision.summary);
        return {
          ...(budgetSource ? { budgetSource } : {}),
          ...(keptEvidenceIds.length > 0 ? { keptEvidenceIds } : {}),
          ...(removedEvidenceIds.length > 0 ? { removedEvidenceIds } : {}),
          ...(keptCount !== undefined ? { keptCount } : {}),
          ...(removedCount !== undefined ? { removedCount } : {}),
          ...(reasonCodes.length > 0 ? { reasonCodes } : {}),
          ...(summary ? { summary } : {})
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    return {
      applied,
      decisions
    };
  }

  private readContextPackPermissionFiltering(
    value: unknown
  ): SemanticContextPackV1["permissionFiltering"] | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }
    const status =
      value.status === "applied" || value.status === "skipped"
        ? value.status
        : undefined;
    if (!status) {
      return undefined;
    }
    const deniedEvidenceIds = this.readStringArray(value.deniedEvidenceIds);
    const deniedEvidenceCount = this.readNumber(value.deniedEvidenceCount);
    const deniedTables = this.readStringArray(value.deniedTables);
    const deniedColumns = this.readStringArray(value.deniedColumns);
    const reasonCodes = this.readStringArray(value.reasonCodes);
    return {
      status,
      ...(deniedEvidenceIds.length > 0 ? { deniedEvidenceIds } : {}),
      ...(deniedEvidenceCount !== undefined ? { deniedEvidenceCount } : {}),
      ...(deniedTables.length > 0 ? { deniedTables } : {}),
      ...(deniedColumns.length > 0 ? { deniedColumns } : {}),
      ...(reasonCodes.length > 0 ? { reasonCodes } : {})
    };
  }

  private uniqueStrings(values: string[] | undefined): string[] | undefined {
    if (!values) {
      return undefined;
    }
    const filtered = values
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    return filtered.length > 0 ? Array.from(new Set(filtered)) : undefined;
  }

  private readGenerateStepSummary(
    steps: ExecutionTraceStep[]
  ): Record<string, unknown> | undefined {
    const outputSummary = steps.find((step) => step.node === "generate-sql")?.outputSummary;
    if (typeof outputSummary !== "string") {
      return undefined;
    }
    const parsed = this.safeParseJson(outputSummary);
    return this.isRecord(parsed) ? parsed : undefined;
  }

  private readProviderMetadata(value: unknown): Text2SqlV2StageArtifact["provider"] {
    if (!this.isRecord(value)) {
      return undefined;
    }
    const provider = this.readString(value.provider);
    const model = this.readString(value.model);
    const dimensions = this.readNumber(value.dimensions);
    const vectorVersion = this.readString(value.vectorVersion);
    const indexVersion = this.readString(value.indexVersion);
    const scope = this.readString(value.scope);
    const assetType = this.readString(value.assetType);
    const timeoutMs = this.readNumber(value.timeoutMs);
    const inputCount = this.readNumber(value.inputCount);
    const outputCount = this.readNumber(value.outputCount);
    const fallbackReason = this.readString(value.fallbackReason);
    const unavailableReason = this.readString(value.unavailableReason);
    if (
      !provider &&
      !model &&
      dimensions === undefined &&
      !vectorVersion &&
      !indexVersion &&
      !scope &&
      !assetType &&
      timeoutMs === undefined &&
      inputCount === undefined &&
      outputCount === undefined &&
      !fallbackReason &&
      !unavailableReason
    ) {
      return undefined;
    }
    return {
      provider,
      model,
      dimensions,
      vectorVersion,
      indexVersion,
      scope,
      assetType,
      timeoutMs,
      inputCount,
      outputCount,
      fallbackReason,
      unavailableReason
    };
  }

  private readFailureSemantic(value: unknown): Text2SqlV2FailureSemantic | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }
    const code = this.readString(value.code);
    const message = this.readString(value.message);
    if (!code || !message) {
      return undefined;
    }
    const category = this.readString(value.category) as Text2SqlV2FailureSemantic["category"];
    const terminal = typeof value.terminal === "boolean" ? value.terminal : undefined;
    const correctable = typeof value.correctable === "boolean" ? value.correctable : undefined;
    return {
      code,
      message,
      category,
      terminal,
      correctable
    };
  }

  private safeParseJson(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }

  private isStageName(value: unknown): value is Text2SqlV2StageName {
    return typeof value === "string" && TEXT2SQL_V2_STAGE_ORDER.includes(value as Text2SqlV2StageName);
  }

  private isStageStatus(
    value: unknown
  ): value is Text2SqlV2StageArtifact["status"] {
    return (
      value === "success" ||
      value === "skipped" ||
      value === "degraded" ||
      value === "failed" ||
      value === "clarification"
    );
  }

  private resolveDurationMs(startedAt?: string, endedAt?: string): number | undefined {
    if (!startedAt || !endedAt) {
      return undefined;
    }
    const started = Date.parse(startedAt);
    const ended = Date.parse(endedAt);
    if (Number.isNaN(started) || Number.isNaN(ended)) {
      return undefined;
    }
    return Math.max(0, ended - started);
  }
}
