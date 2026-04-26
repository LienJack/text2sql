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

const STAGE_NODE_MAP: Record<Text2SqlV2StageName, string[]> = {
  intake: ["clarify"],
  retrieve: ["retrieve-knowledge"],
  "assemble-context": ["build-intent-plan"],
  "semantic-plan": ["build-semantic-query", "build-physical-plan"],
  "generate-sql": ["resolve-saved-prior-sql", "generate-sql"],
  validate: ["safety-check"],
  correct: ["relationship-correction"],
  execute: ["execute-sql"],
  answer: ["format-answer"]
};

@Injectable()
export class Text2SqlV2StateMachine {
  buildRunArtifact(run: SqlRun): Text2SqlV2RunArtifact {
    const stageArtifacts = TEXT2SQL_V2_STAGE_ORDER.map((stage) =>
      this.buildStageArtifact(stage, run)
    );

    return {
      version: "v2",
      stageOrder: [...TEXT2SQL_V2_STAGE_ORDER],
      stages: stageArtifacts,
      contextPack: this.buildContextPack(run),
      semanticPlan: this.buildSemanticPlan(run),
      sqlGeneration: this.buildSqlGenerationArtifact(run),
      sqlValidation: this.buildSqlValidationArtifact(run)
    };
  }

  private buildStageArtifact(
    stage: Text2SqlV2StageName,
    run: SqlRun
  ): Text2SqlV2StageArtifact {
    const steps = this.selectStageSteps(stage, run.trace.steps ?? []);
    if (steps.length === 0) {
      if (stage === "answer" && run.status === "clarification") {
        return {
          stage,
          status: "clarification",
          warnings: ["clarification_terminated_before_answer_stage"]
        };
      }
      return {
        stage,
        status: "skipped"
      };
    }

    const startedAt = steps.find((step) => step.startedAt)?.startedAt ?? steps[0]?.at;
    const endedAt = [...steps].reverse().find((step) => step.endedAt)?.endedAt ?? steps.at(-1)?.at;
    const failureStep = steps.find((step) => step.status === "failed");

    const status: Text2SqlV2StageArtifact["status"] =
      stage === "intake" && run.status === "clarification"
        ? "clarification"
        : failureStep
          ? "failed"
          : steps.every((step) => step.status === "skipped")
            ? "skipped"
            : "success";

    return {
      stage,
      status,
      startedAt,
      endedAt,
      durationMs: this.resolveDurationMs(startedAt, endedAt),
      warnings: this.resolveWarnings(steps),
      failure: failureStep
        ? this.toFailureSemantic(stage, run, failureStep)
        : undefined,
      provider:
        stage === "generate-sql"
          ? {
              provider: run.provider,
              model: run.model
            }
          : undefined
    };
  }

  private selectStageSteps(
    stage: Text2SqlV2StageName,
    steps: ExecutionTraceStep[]
  ): ExecutionTraceStep[] {
    const nodes = STAGE_NODE_MAP[stage];
    return steps.filter((step) => nodes.includes(step.node));
  }

  private resolveDurationMs(startedAt?: string, endedAt?: string): number | undefined {
    if (!startedAt || !endedAt) {
      return undefined;
    }
    const start = Date.parse(startedAt);
    const end = Date.parse(endedAt);
    if (Number.isNaN(start) || Number.isNaN(end)) {
      return undefined;
    }
    return Math.max(0, end - start);
  }

  private resolveWarnings(steps: ExecutionTraceStep[]): string[] | undefined {
    const warnings = steps
      .map((step) => step.detail)
      .filter((detail): detail is string => Boolean(detail))
      .filter((detail) => /degrad|fallback|timeout|warn|降级|超时/i.test(detail));
    return warnings.length > 0 ? Array.from(new Set(warnings)) : undefined;
  }

  private toFailureSemantic(
    stage: Text2SqlV2StageName,
    run: SqlRun,
    step: ExecutionTraceStep
  ): Text2SqlV2FailureSemantic {
    return {
      code: `${stage.toUpperCase().replace(/-/g, "_")}_FAILED`,
      message: step.errorSummary ?? step.detail ?? run.error ?? `${stage} failed`,
      category: this.resolveFailureCategory(stage),
      terminal: this.isTerminalFailure(stage, run),
      correctable: stage === "validate" || stage === "correct"
    };
  }

  private resolveFailureCategory(
    stage: Text2SqlV2StageName
  ): Text2SqlV2FailureSemantic["category"] {
    if (stage === "intake") {
      return "intake";
    }
    if (stage === "retrieve") {
      return "retrieval";
    }
    if (stage === "assemble-context" || stage === "semantic-plan") {
      return "planning";
    }
    if (stage === "generate-sql") {
      return "generation";
    }
    if (stage === "validate" || stage === "correct") {
      return "validation";
    }
    if (stage === "execute" || stage === "answer") {
      return "execution";
    }
    return "unknown";
  }

  private isTerminalFailure(stage: Text2SqlV2StageName, run: SqlRun): boolean {
    if (run.status === "failed" || run.status === "rejected") {
      return true;
    }
    return stage === "execute";
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

  private readString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  private readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => this.readString(item))
      .filter((item): item is string => Boolean(item));
  }

  private readGenerateStepSummary(
    steps: ExecutionTraceStep[]
  ): Record<string, unknown> | undefined {
    const outputSummary = steps.find((step) => step.node === "generate-sql")?.outputSummary;
    if (typeof outputSummary !== "string") {
      return undefined;
    }
    try {
      const parsed = JSON.parse(outputSummary) as unknown;
      return this.isRecord(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
}
