import type {
  ClarificationPrompt,
  ExecutionTrace,
  ExecutionTraceStep,
  SqlRun
} from "@text2sql/shared-types";
import type { GraphInput, GraphTraceContext } from "./agent.types";
import type { SqlTableAccessContext } from "../../data/query/sql-table-access-guard.service";
import type { RetrievedKnowledge } from "../nodes/retrieve-knowledge.node";
import type { IntentPlan } from "../nodes/build-intent-plan.node";
import type { SemanticQueryPlan } from "../nodes/build-semantic-query.node";
import type { PhysicalPlan } from "../nodes/build-physical-plan.node";
import type { SqlSafetyDecision } from "../sql/tools/sql-safety.guard";

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
  retrievedKnowledge?: RetrievedKnowledge;
  intentPlan?: IntentPlan;
  semanticQueryPlan?: SemanticQueryPlan;
  physicalPlan?: PhysicalPlan;
  planningStatus?: "legacy" | "ready" | "degraded";
  planningWarnings?: string[];
  safetyDecision?: SqlSafetyDecision;
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

export const normalizeAccessContext = (
  context?: SqlTableAccessContext
): SqlTableAccessContext | undefined => {
  if (!context) {
    return undefined;
  }
  const actorId = context.actorId?.trim();
  const workspaceId = context.workspaceId?.trim();
  if (!actorId || !workspaceId) {
    return undefined;
  }
  return {
    ...context,
    actorId,
    workspaceId,
    roleSet: context.roleSet?.map((item) => item.trim()).filter(Boolean) ?? [],
    allowedTables:
      context.allowedTables?.map((item) => item.trim()).filter(Boolean) ?? []
  };
};

export const createInitialLangGraphState = (
  input: GraphInput,
  fallbackProvider = "volcengine"
): LangGraphState => {
  const traceContext = normalizeTraceContext(input.traceContext);
  const accessContext = normalizeAccessContext(input.accessContext);
  return {
    ...input,
    traceContext,
    accessContext,
    provider: fallbackProvider,
    model: undefined,
    llmRaw: undefined,
    planningScaffoldEnabled: input.planningScaffoldEnabled ?? false,
    planningStatus: input.planningScaffoldEnabled ? "ready" : "legacy",
    planningWarnings: [],
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
