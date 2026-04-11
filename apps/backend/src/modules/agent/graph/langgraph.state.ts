import type {
  ClarificationPrompt,
  ExecutionTrace,
  ExecutionTraceStep,
  SqlRun
} from "@text2sql/shared-types";
import type { GraphInput, GraphTraceContext } from "./agent.types";

export interface LangGraphSpanEvent {
  step: ExecutionTraceStep;
  runType?: "chain" | "llm" | "tool";
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface LangGraphState extends GraphInput {
  provider: string;
  model?: string;
  llmRaw?: SqlRun["llmRaw"];
  sql?: string;
  explanation?: string;
  rows?: Array<Record<string, unknown>>;
  columns?: string[];
  answer?: string;
  error?: string;
  clarification?: ClarificationPrompt;
  trace: ExecutionTrace;
  spanEvents: LangGraphSpanEvent[];
  terminalStatus?: SqlRun["status"];
  fatalError?: unknown;
}

export const normalizeTraceContext = (context?: GraphTraceContext): GraphTraceContext => {
  if (context) {
    return context;
  }
  return {
    source: "chat",
    route: "unknown"
  };
};

export const createInitialLangGraphState = (
  input: GraphInput,
  fallbackProvider = "volcengine"
): LangGraphState => {
  const traceContext = normalizeTraceContext(input.traceContext);
  return {
    ...input,
    traceContext,
    provider: fallbackProvider,
    model: undefined,
    llmRaw: undefined,
    trace: {
      runId: input.runId,
      provider: fallbackProvider,
      retryCount: 0,
      steps: []
    },
    spanEvents: []
  };
};

export const appendStep = (
  state: Pick<LangGraphState, "trace" | "spanEvents">,
  event: LangGraphSpanEvent
): Pick<LangGraphState, "trace" | "spanEvents"> => {
  const nextSequence = state.trace.steps.length + 1;
  const normalizedStep: ExecutionTraceStep = {
    ...event.step,
    sequence: event.step.sequence ?? nextSequence,
    stepId: event.step.stepId ?? `${state.trace.runId}:${event.step.node}:${nextSequence}`,
    lifecycle:
      event.step.lifecycle ??
      (event.step.status === "failed"
        ? "failed"
        : event.step.status === "skipped"
          ? "skipped"
          : "completed")
  };

  return {
    trace: {
      ...state.trace,
      steps: [...state.trace.steps, normalizedStep]
    },
    spanEvents: [...state.spanEvents, { ...event, step: normalizedStep }]
  };
};
