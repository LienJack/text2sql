import { Injectable } from "@nestjs/common";
import type {
  ExecutionTraceStep,
  SemanticContextPackV1,
  SemanticPlanV1,
  SqlGenerationArtifactV1,
  SqlRun,
  SqlValidationArtifactV1,
  Text2SqlV2FailureSemantic,
  Text2SqlV2RunArtifact,
  Text2SqlV2StageArtifact,
  Text2SqlV2StageName
} from "@text2sql/shared-types";
import { TEXT2SQL_V2_STAGE_ORDER } from "./text2sql-v2.types";

interface BuildRunArtifactOptions {
  stageArtifacts?: Text2SqlV2StageArtifact[];
  contextPack?: SemanticContextPackV1;
  semanticPlan?: SemanticPlanV1;
  sqlGeneration?: SqlGenerationArtifactV1;
  sqlValidation?: SqlValidationArtifactV1;
}

@Injectable()
export class Text2SqlV2StateMachine {
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
      sqlValidation: options?.sqlValidation ?? this.buildSqlValidationArtifact(run)
    };
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
    return {
      status: run.delivery?.evidence?.contextPackStatus ?? "degraded",
      selectedEvidenceIds: snippets.map((_, index) => `snippet:${index + 1}`),
      selectedTables: [],
      selectedColumns: [],
      warnings: run.delivery?.evidence?.degradeReasons
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
    return {
      sql: run.sql,
      assumptions: run.explanation ? [run.explanation] : undefined,
      usedTables: this.extractSqlTables(run.sql),
      usedColumns: [],
      evidenceRefs:
        run.delivery?.evidence?.selectedContext?.snippets?.map((_, index) => `snippet:${index + 1}`) ??
        []
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
    return {
      status,
      selectedEvidenceIds,
      selectedTables,
      selectedColumns,
      ...(this.readStringArray(raw.warnings).length > 0
        ? { warnings: this.readStringArray(raw.warnings) }
        : {})
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

