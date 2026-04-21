import { Injectable } from "@nestjs/common";
import type {
  ContextEnvelope,
  ExecutionTraceStep,
  SqlRun
} from "@text2sql/shared-types";
import type {
  LlmGatewayStreamEvent,
  LlmGatewayToolDefinition
} from "../../../llm/llm-gateway.interface";
import type {
  GraphContextConflictHint,
  GraphEffectiveContextSummary,
  GraphInput
} from "./agent.types";
import {
  createInitialLangGraphState,
  normalizeTraceContext,
  type LangGraphSpanEvent,
  type LangGraphState
} from "./langgraph.state";
import { LangGraphRuntimeService } from "./langgraph.runtime";
import { LangsmithTraceService } from "../../../observability/langsmith-trace.service";
import { AppConfigService } from "../../../config/app-config.service";

export interface GraphRunOptions {
  streamMode?: boolean;
  tools?: Record<string, LlmGatewayToolDefinition>;
  onLlmEvent?: (event: LlmGatewayStreamEvent) => Promise<void> | void;
  onStep?: (event: LangGraphSpanEvent) => Promise<void> | void;
}

interface GraphContextEvidence {
  effectiveContextSummary?: GraphEffectiveContextSummary;
  conflictHint?: GraphContextConflictHint;
}

const CONTEXT_CONFLICT_REGEX = /conflict|mismatch|contradict|inconsistent|冲突/i;

@Injectable()
export class GraphBuilderService {
  constructor(
    private readonly langGraphRuntime: LangGraphRuntimeService,
    private readonly langsmithTrace: LangsmithTraceService,
    private readonly config: AppConfigService
  ) {}

  async run(input: GraphInput, options?: GraphRunOptions): Promise<SqlRun> {
    const traceContext = normalizeTraceContext(input.traceContext);
    const initialState = createInitialLangGraphState(
      {
        ...input,
        planningScaffoldEnabled:
          input.planningScaffoldEnabled ?? this.config.agentPlanningScaffoldEnabled,
        traceContext
      },
      "volcengine"
    );
    const rootTrace = this.langsmithTrace.startRoot({
      runId: input.runId,
      sessionId: input.sessionId,
      question: input.question,
      source: traceContext.source,
      route: traceContext.route,
      requestId: traceContext.requestId,
      jobId: traceContext.jobId,
      caseId: traceContext.caseId
    });
    let runtimeState: LangGraphState | undefined;
    let rootEnded = false;

    try {
      runtimeState = await this.langGraphRuntime.invoke(initialState, {
        configurable: {
          thread_id: input.runId,
          runId: input.runId,
          streamMode: options?.streamMode,
          tools: options?.tools,
          onLlmEvent: options?.onLlmEvent,
          onStep: async (step: ExecutionTraceStep) => {
            await options?.onStep?.({
              step
            });
          }
        }
      });
      this.flushSpanEvents(rootTrace, runtimeState.spanEvents);
      if (runtimeState.fatalError) {
        const message = this.toErrorMessage(runtimeState.fatalError);
        this.langsmithTrace.endRoot(rootTrace, {
          status: "failed",
          provider: runtimeState.provider,
          error: message,
          metadata: this.compact({
            requestId: traceContext.requestId,
            route: traceContext.route,
            source: traceContext.source,
            jobId: traceContext.jobId,
            caseId: traceContext.caseId
          })
        });
        rootEnded = true;
        throw runtimeState.fatalError;
      }
      const finalizedRun = this.toRun(
        runtimeState,
        this.resolveTerminalStatus(runtimeState)
      );
      this.langsmithTrace.endRoot(rootTrace, {
        status: finalizedRun.status,
        provider: finalizedRun.provider,
        outputs: this.compact({
          rowCount: finalizedRun.rows?.length,
          hasError: Boolean(finalizedRun.error),
          retrievalStatus: runtimeState.retrievalBundle?.status,
          selectedContextCount: runtimeState.retrievalBundle?.selected_context?.length ?? 0
        }),
        metadata: this.compact({
          requestId: traceContext.requestId,
          route: traceContext.route,
          source: traceContext.source,
          jobId: traceContext.jobId,
          caseId: traceContext.caseId
        })
      });
      rootEnded = true;
      return finalizedRun;
    } catch (error) {
      if (!rootEnded) {
        this.langsmithTrace.endRoot(rootTrace, {
          status: "failed",
          provider: runtimeState?.provider ?? initialState.provider,
          error: this.toErrorMessage(error),
          metadata: this.compact({
            requestId: traceContext.requestId,
            route: traceContext.route,
            source: traceContext.source,
            jobId: traceContext.jobId,
            caseId: traceContext.caseId
          })
        });
      }
      throw error;
    }
  }

  private resolveTerminalStatus(state: LangGraphState): SqlRun["status"] {
    if (state.terminalStatus) {
      return state.terminalStatus;
    }
    return state.error ? "failed" : "executionResult";
  }

  private flushSpanEvents(
    rootTrace: ReturnType<LangsmithTraceService["startRoot"]>,
    spanEvents: LangGraphSpanEvent[]
  ): void {
    for (const event of spanEvents) {
      this.langsmithTrace.recordSpan(rootTrace, {
        node: event.step.node,
        status: event.step.status,
        detail: event.step.detail,
        runType: event.runType,
        inputs: event.inputs,
        outputs: event.outputs,
        metadata: event.metadata,
        error: event.error
      });
    }
  }

  private toRun(state: LangGraphState, status: SqlRun["status"]): SqlRun {
    const normalizedTrace = this.normalizeTrace(state.trace, state.runId, state.provider);
    const contextEvidence = this.buildContextEvidence(state);
    const traceWithContext = this.withContextEvidence(normalizedTrace, contextEvidence);
    return {
      runId: state.runId,
      sessionId: state.sessionId,
      question: state.question,
      status,
      provider: state.provider,
      model: state.model,
      sql: state.sql,
      explanation: state.explanation,
      answer: state.answer,
      rows: state.rows,
      columns: state.columns,
      error: state.error,
      clarification: state.clarification,
      trace: traceWithContext,
      llmRaw: state.llmRaw ?? null,
      createdAt: new Date().toISOString()
    };
  }

  private normalizeTrace(
    trace: SqlRun["trace"],
    runId: string,
    provider: string
  ): SqlRun["trace"] {
    return {
      ...trace,
      runId: trace.runId ?? runId,
      provider: trace.provider ?? provider,
      retryCount: trace.retryCount ?? 0,
      steps: (trace.steps ?? []).map((step, index) => {
        const sequence = step.sequence ?? index + 1;
        return {
          ...step,
          sequence,
          stepId: step.stepId ?? `${runId}:${step.node}:${sequence}`,
          lifecycle:
            step.lifecycle ??
            (step.status === "failed"
              ? "failed"
              : step.status === "skipped"
                ? "skipped"
                : "completed")
        };
      })
    };
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  private compact(payload: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined)
    );
  }

  private withContextEvidence(
    trace: SqlRun["trace"],
    contextEvidence: GraphContextEvidence
  ): SqlRun["trace"] {
    if (!contextEvidence.effectiveContextSummary && !contextEvidence.conflictHint) {
      return trace;
    }
    return {
      ...trace,
      ...(contextEvidence.effectiveContextSummary
        ? {
            effectiveContextSummary: contextEvidence.effectiveContextSummary
          }
        : {}),
      ...(contextEvidence.conflictHint
        ? {
            conflictHint: contextEvidence.conflictHint
          }
        : {})
    } as SqlRun["trace"];
  }

  private buildContextEvidence(state: LangGraphState): GraphContextEvidence {
    const envelope = state.contextEnvelope;
    if (!this.hasContextEnvelope(envelope)) {
      return {};
    }

    const includeTableCount = this.countNonEmptyStrings(envelope?.mustIncludeTables);
    const excludeTableCount = this.countNonEmptyStrings(envelope?.mustExcludeTables);
    const entityMappingCount = this.countEntityMappings(envelope?.entityMappings);
    const effectiveContextSummary: GraphEffectiveContextSummary = {
      sourcePriority: "user_explicit_over_system",
      userEnvelope: {
        metricDefinitionProvided: this.hasNonEmptyString(envelope?.metricDefinition),
        timeRangeProvided: this.hasTimeRange(envelope?.timeRange),
        entityMappingCount,
        includeTableCount,
        excludeTableCount,
        businessConstraintCount: this.countNonEmptyStrings(envelope?.businessConstraints)
      },
      retrievalContext: {
        status: state.retrievalBundle?.status,
        selectedContextCount: state.retrievalBundle?.selected_context?.length
      }
    };

    const reasonCodes = this.collectConflictReasons(state, includeTableCount, excludeTableCount);
    const conflictHint: GraphContextConflictHint = {
      hasConflict: reasonCodes.length > 0,
      preferredSource: "user_explicit",
      ...(reasonCodes.length > 0 ? { reasonCodes } : {})
    };

    return {
      effectiveContextSummary,
      conflictHint
    };
  }

  private collectConflictReasons(
    state: LangGraphState,
    includeTableCount: number,
    excludeTableCount: number
  ): string[] {
    const reasonCodes: string[] = [];
    if (includeTableCount > 0 && excludeTableCount > 0 && this.hasTableOverlap(state)) {
      reasonCodes.push("user_envelope_include_exclude_overlap");
    }
    if (
      (state.retrievalBundle?.risk_tags ?? []).some((tag) => CONTEXT_CONFLICT_REGEX.test(tag))
    ) {
      reasonCodes.push("retrieval_context_conflict_risk");
    }
    if ((state.planningWarnings ?? []).some((warning) => CONTEXT_CONFLICT_REGEX.test(warning))) {
      reasonCodes.push("planning_conflict_warning");
    }
    return Array.from(new Set(reasonCodes));
  }

  private hasTableOverlap(state: LangGraphState): boolean {
    const include = new Set(
      (state.contextEnvelope?.mustIncludeTables ?? [])
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
    );
    if (include.size === 0) {
      return false;
    }
    return (state.contextEnvelope?.mustExcludeTables ?? [])
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
      .some((item) => include.has(item));
  }

  private hasContextEnvelope(input: ContextEnvelope | undefined): boolean {
    if (!input) {
      return false;
    }
    return (
      this.hasNonEmptyString(input.metricDefinition) ||
      this.hasTimeRange(input.timeRange) ||
      this.countEntityMappings(input.entityMappings) > 0 ||
      this.countNonEmptyStrings(input.mustIncludeTables) > 0 ||
      this.countNonEmptyStrings(input.mustExcludeTables) > 0 ||
      this.countNonEmptyStrings(input.businessConstraints) > 0
    );
  }

  private hasTimeRange(value: ContextEnvelope["timeRange"] | undefined): boolean {
    if (!value || typeof value !== "object") {
      return false;
    }
    const timeRange = value as {
      from?: string;
      to?: string;
      timezone?: string;
    };
    return (
      this.hasNonEmptyString(timeRange.from) ||
      this.hasNonEmptyString(timeRange.to) ||
      this.hasNonEmptyString(timeRange.timezone)
    );
  }

  private countEntityMappings(
    value: ContextEnvelope["entityMappings"] | undefined
  ): number {
    if (!Array.isArray(value)) {
      return 0;
    }
    return value.reduce((count, item) => {
      if (!item || typeof item !== "object") {
        return count;
      }
      const candidate = item as {
        entity?: string;
        mappedTo?: string;
      };
      if (this.hasNonEmptyString(candidate.entity) || this.hasNonEmptyString(candidate.mappedTo)) {
        return count + 1;
      }
      return count;
    }, 0);
  }

  private countNonEmptyStrings(values: string[] | undefined): number {
    if (!values) {
      return 0;
    }
    return values.filter((item) => this.hasNonEmptyString(item)).length;
  }

  private hasNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
  }
}
