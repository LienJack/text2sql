import type {
  ClarificationPrompt,
  ExecutionTrace,
  ExecutionTraceStep,
  SqlRun
} from "@text2sql/shared-types";
import type { GraphInput, GraphTraceContext } from "./agent.types";
import type { SqlTableAccessContext } from "../../../platform/data/query/index";
import type { RetrievedKnowledge } from "../nodes/retrieve-knowledge.node";
import type { IntentPlan } from "../nodes/build-intent-plan.node";
import type { SemanticQueryPlan } from "../nodes/build-semantic-query.node";
import type { PhysicalPlan } from "../nodes/build-physical-plan.node";
import type { SqlSafetyDecision } from "../sql/tools/sql-safety.guard";
import type {
  RagContextPack,
  RagRetrievalBundle
} from "../../../knowledge/rag/retrieval/rag-retrieval.types";

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
  retrievalBundle?: RagRetrievalBundle;
  contextPack?: RagContextPack;
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
  relationCorrectionRetryCount?: number;
  terminalStatus?: SqlRun["status"];
  fatalError?: unknown;
}

export const MAX_RELATIONSHIP_CORRECTION_RETRY = 2;
export const RELATIONSHIP_CORRECTION_ERROR_MARKERS = [
  "missing_relation_path",
  "join_key_mismatch",
  "ambiguous_join_path",
  "join path",
  "relationship",
  "relation"
] as const;

export const shouldRetryRelationshipCorrection = (input: {
  error?: string;
  retryCount?: number;
}): boolean => {
  const retryCount = input.retryCount ?? 0;
  if (retryCount >= MAX_RELATIONSHIP_CORRECTION_RETRY) {
    return false;
  }
  const error = input.error?.trim().toLowerCase();
  if (!error) {
    return false;
  }
  return RELATIONSHIP_CORRECTION_ERROR_MARKERS.some((marker) =>
    error.includes(marker)
  );
};

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
    spanEvents: [],
    relationCorrectionRetryCount: 0
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
