import { Injectable } from "@nestjs/common";
import type { ExecutionTraceStep, SqlRun } from "@text2sql/shared-types";
import type {
  LlmGatewayStreamEvent,
  LlmGatewayToolDefinition
} from "../../llm/llm-gateway.interface";
import type { GraphInput } from "./agent.types";
import {
  createInitialLangGraphState,
  normalizeTraceContext,
  type LangGraphSpanEvent,
  type LangGraphState
} from "./langgraph.state";
import { LangGraphRuntimeService } from "./langgraph.runtime";
import { LangsmithTraceService } from "../../observability/langsmith-trace.service";
import { AppConfigService } from "../../config/app-config.service";

export interface GraphRunOptions {
  streamMode?: boolean;
  tools?: Record<string, LlmGatewayToolDefinition>;
  onLlmEvent?: (event: LlmGatewayStreamEvent) => Promise<void> | void;
  onStep?: (event: LangGraphSpanEvent) => Promise<void> | void;
}

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
          hasError: Boolean(finalizedRun.error)
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
      trace: this.normalizeTrace(state.trace, state.runId, state.provider),
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
}
