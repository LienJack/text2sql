import { END, START, StateGraph } from "@langchain/langgraph";
import type {
  ClarificationPrompt,
  ExecutionTraceStep,
  Text2SqlAccuracyGateReceiptV1,
  Text2SqlEvalVersionTupleV1,
  Text2SqlV2FailureSemantic,
  Text2SqlV2LoopEvidence,
  Text2SqlV2RuntimePlanV1,
  Text2SqlV2StageArtifact,
  Text2SqlV2StageName
} from "@text2sql/shared-types";
import { throwIfAborted } from "../../../../common/abort-utils";
import { DomainError } from "../../../../common/domain-error";
import type { LlmGatewayToolDefinition } from "../../../llm/llm-gateway.interface";
import {
  resolveText2SqlV2StageCatalogEntry
} from "../../text2sql/stages/text2sql-stage-catalog";
import type { AnswerNode } from "../../nodes/answer.node";
import type { AssembleContextNode } from "../../nodes/assemble-context.node";
import type { CorrectSqlNode } from "../../nodes/correct-sql.node";
import type { ExecuteSqlNode } from "../../nodes/execute-sql.node";
import type {
  GenerateSqlNode,
  GenerateSqlNodeResult
} from "../../nodes/generate-sql.node";
import type { IntakeNode } from "../../nodes/intake.node";
import type {
  RetrieveContextNode,
  RetrieveContextNodeInput
} from "../../nodes/retrieve-context.node";
import type {
  SemanticPlanNode,
  SemanticPlanNodeResult
} from "../../nodes/semantic-plan.node";
import type { ValidateSqlNode } from "../../nodes/validate-sql.node";
import {
  Text2SqlV2LangGraphStateAnnotation,
  type Text2SqlV2LangGraphNodeName,
  type Text2SqlV2LangGraphSqlDraft,
  type Text2SqlV2LangGraphState,
  type Text2SqlV2LangGraphStateUpdate
} from "./text2sql-v2-langgraph.state";
import {
  createText2SqlClosureReceipt,
  createText2SqlPolicyReceipt
} from "../../contracts/text2sql-v2.types";

type NodeRouteKey = "answer" | "retrieve" | "assemble-context" | "semantic-plan" | "generate-sql" | "validate" | "correct" | "execute";

export interface Text2SqlV2LangGraphDeps {
  intakeNode: IntakeNode;
  retrieveContextNode: RetrieveContextNode;
  assembleContextNode: AssembleContextNode;
  semanticPlanNode: SemanticPlanNode;
  generateSqlNode: GenerateSqlNode;
  validateSqlNode: ValidateSqlNode;
  correctSqlNode: CorrectSqlNode;
  executeSqlNode: ExecuteSqlNode;
  answerNode: AnswerNode;
  accuracyMode?: "shadow" | "enforce";
  resolveSqlTools: (
    state: Text2SqlV2LangGraphState
  ) => Record<string, LlmGatewayToolDefinition>;
}

const STAGE_NODE_TO_STEP_NODE: Record<Text2SqlV2LangGraphNodeName, string> = {
  intake: "intake",
  retrieve: "retrieve-context",
  "assemble-context": "assemble-context",
  "semantic-plan": "semantic-plan",
  "generate-sql": "generate-sql",
  validate: "validate-sql",
  correct: "correct-sql",
  execute: "execute-sql",
  answer: "answer"
};

const toStepStatus = (
  status: Text2SqlV2StageArtifact["status"]
): ExecutionTraceStep["status"] => {
  if (status === "failed") {
    return "failed";
  }
  if (status === "skipped") {
    return "skipped";
  }
  return "success";
};

const normalizeFailure = (
  error: unknown,
  defaults: Partial<Text2SqlV2FailureSemantic>
): Text2SqlV2FailureSemantic => {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error
  ) {
    const candidate = error as { code?: unknown; message?: unknown };
    if (typeof candidate.code === "string" && typeof candidate.message === "string") {
      return {
        code: candidate.code,
        message: candidate.message,
        category: defaults.category ?? "unknown",
        terminal: defaults.terminal ?? true,
        correctable: defaults.correctable ?? false
      };
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    code: defaults.code ?? "TEXT2SQL_V2_LANGGRAPH_STAGE_FAILED",
    message,
    category: defaults.category ?? "unknown",
    terminal: defaults.terminal ?? true,
    correctable: defaults.correctable ?? false
  };
};

const nowIso = (): string => new Date().toISOString();

const computeDurationMs = (startedAt: string, endedAt: string): number => {
  const started = Date.parse(startedAt);
  const ended = Date.parse(endedAt);
  if (Number.isNaN(started) || Number.isNaN(ended)) {
    return 0;
  }
  return Math.max(0, ended - started);
};

const unique = (values: string[]): string[] => {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))
  );
};

const uniqueGateReceipts = (
  receipts: Text2SqlAccuracyGateReceiptV1[]
): Text2SqlAccuracyGateReceiptV1[] => {
  const byGate = new Map<Text2SqlAccuracyGateReceiptV1["gate"], Text2SqlAccuracyGateReceiptV1>();
  for (const receipt of receipts) {
    byGate.set(receipt.gate, receipt);
  }
  return Array.from(byGate.values());
};

const safeJsonStringify = (payload: Record<string, unknown>): string | undefined => {
  try {
    return JSON.stringify(payload);
  } catch {
    return undefined;
  }
};

const createStageArtifact = (input: {
  stage: Text2SqlV2StageName;
  status: Text2SqlV2StageArtifact["status"];
  warnings?: string[];
  evidenceIds?: string[];
  failure?: Text2SqlV2FailureSemantic;
  metadata?: Record<string, unknown>;
  provider?: Text2SqlV2StageArtifact["provider"];
  startedAt?: string;
}): Text2SqlV2StageArtifact => {
  const startedAt = input.startedAt ?? nowIso();
  const endedAt = nowIso();
  const catalog = resolveText2SqlV2StageCatalogEntry(input.stage);
  return {
    stage: input.stage,
    status: input.status,
    startedAt,
    endedAt,
    durationMs: computeDurationMs(startedAt, endedAt),
    warnings: unique(input.warnings ?? []),
    evidenceIds: unique(input.evidenceIds ?? []),
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.failure ? { failure: input.failure } : {}),
    metadata: {
      taskProfile: catalog.taskProfile,
      reasoningTier: catalog.defaultReasoningTier,
      policySource: "langgraph-runtime",
      ...(input.metadata ?? {})
    }
  };
};

const createStep = (input: {
  state: Text2SqlV2LangGraphState;
  node: Text2SqlV2LangGraphNodeName;
  stageArtifact: Text2SqlV2StageArtifact;
  detail: string;
  runtimePlanStatus?: Text2SqlV2RuntimePlanV1["items"][number]["status"];
  inputSummary?: Record<string, unknown>;
  outputSummary?: Record<string, unknown>;
}): ExecutionTraceStep => {
  const at = nowIso();
  const outputSummaryV2 =
    input.outputSummary?.v2 && typeof input.outputSummary.v2 === "object"
      ? (input.outputSummary.v2 as Record<string, unknown>)
      : {};
  const inputSummaryV2 =
    input.inputSummary?.v2 && typeof input.inputSummary.v2 === "object"
      ? (input.inputSummary.v2 as Record<string, unknown>)
      : {};
  const outputPayload: Record<string, unknown> = {
    ...(input.outputSummary ?? {}),
    v2: {
      ...outputSummaryV2,
      stageArtifact: input.stageArtifact,
      runtimePlan: createRuntimePlanUpdate({
        stageArtifact: input.stageArtifact,
        detail: input.detail,
        status: input.runtimePlanStatus
      })
    }
  };
  const inputPayload: Record<string, unknown> = {
    ...(input.inputSummary ?? {}),
    v2: {
      ...inputSummaryV2,
      stageArtifact: input.stageArtifact,
      runtimePlan: createRuntimePlanUpdate({
        stageArtifact: input.stageArtifact,
        detail: input.detail,
        status: input.runtimePlanStatus
      })
    }
  };

  return {
    node: STAGE_NODE_TO_STEP_NODE[input.node],
    status: toStepStatus(input.stageArtifact.status),
    detail: input.detail,
    at,
    startedAt: input.stageArtifact.startedAt,
    endedAt: input.stageArtifact.endedAt,
    durationMs: input.stageArtifact.durationMs,
    inputSummary: safeJsonStringify(inputPayload),
    outputSummary: safeJsonStringify(outputPayload),
    errorSummary:
      input.stageArtifact.status === "failed"
        ? input.stageArtifact.failure?.message
        : undefined
  };
};

const toRuntimePlanStatus = (
  status: Text2SqlV2StageArtifact["status"]
): Text2SqlV2RuntimePlanV1["items"][number]["status"] => {
  if (status === "success" || status === "degraded") {
    return "completed";
  }
  if (status === "clarification") {
    return "clarification";
  }
  return status;
};

const createRuntimePlanUpdate = (input: {
  stageArtifact: Text2SqlV2StageArtifact;
  detail: string;
  status?: Text2SqlV2RuntimePlanV1["items"][number]["status"];
}): Text2SqlV2RuntimePlanV1 => {
  const catalog = resolveText2SqlV2StageCatalogEntry(input.stageArtifact.stage);
  const reasonCodes = unique([
    ...(input.stageArtifact.warnings ?? []),
    ...(input.stageArtifact.failure?.code ? [input.stageArtifact.failure.code] : [])
  ]);
  const evidenceRefs = unique(input.stageArtifact.evidenceIds ?? []);
  const correctionIntent = readCorrectionIntent(input.stageArtifact);
  return {
    version: "runtime-plan.v1",
    currentItemId: `runtime-plan:${input.stageArtifact.stage}`,
    summary: input.detail,
    items: [
      {
        id: `runtime-plan:${input.stageArtifact.stage}`,
        stage: input.stageArtifact.stage,
        goal: catalog.title,
        status: input.status ?? toRuntimePlanStatus(input.stageArtifact.status),
        ...(reasonCodes.length > 0 ? { reasonCodes } : {}),
        ...(evidenceRefs.length > 0 ? { evidenceRefs } : {}),
        ...(correctionIntent ? { correctionIntent } : {}),
        ...(input.stageArtifact.startedAt
          ? { startedAt: input.stageArtifact.startedAt }
          : {}),
        ...(input.stageArtifact.endedAt
          ? { endedAt: input.stageArtifact.endedAt }
          : {}),
        summary: input.detail
      }
    ]
  };
};

const readCorrectionIntent = (
  artifact: Text2SqlV2StageArtifact
): Text2SqlV2RuntimePlanV1["items"][number]["correctionIntent"] | undefined => {
  if (artifact.stage !== "correct" || artifact.status !== "success") {
    return undefined;
  }
  const grounding = artifact.metadata?.correctionGrounding;
  const retryReason =
    typeof grounding === "object" &&
    grounding !== null &&
    "retryReason" in grounding &&
    typeof grounding.retryReason === "string"
      ? grounding.retryReason
      : artifact.warnings?.[0];
  if (!retryReason) {
    return undefined;
  }
  const failureCode =
    typeof grounding === "object" &&
    grounding !== null &&
    "failureCode" in grounding &&
    typeof grounding.failureCode === "string"
      ? grounding.failureCode
      : undefined;
  return {
    failedStage: "validate",
    ...(failureCode ? { failureCode } : {}),
    retryReason,
    targetStage: "validate"
  };
};

const createNodeUpdate = async (input: {
  state: Text2SqlV2LangGraphState;
  node: Text2SqlV2LangGraphNodeName;
  stageArtifact: Text2SqlV2StageArtifact;
  detail: string;
  inputSummary?: Record<string, unknown>;
  outputSummary?: Record<string, unknown>;
  patch?: Partial<Text2SqlV2LangGraphStateUpdate>;
}): Promise<Text2SqlV2LangGraphStateUpdate> => {
  assertStateNotAborted(input.state, `after_${input.node}`);
  const step = createStep({
    state: input.state,
    node: input.node,
    stageArtifact: input.stageArtifact,
    detail: input.detail,
    inputSummary: input.inputSummary,
    outputSummary: input.outputSummary
  });
  if (input.state.streamMode && input.state.streamOptions?.onStep) {
    const sequence = input.state.traceSteps.length + 1;
    await input.state.streamOptions.onStep({
      step: {
        ...step,
        stepId: `${input.state.runId}:${step.node}:${sequence}`,
        sequence,
        lifecycle:
          input.stageArtifact.status === "failed"
            ? "failed"
            : input.stageArtifact.status === "skipped"
              ? "skipped"
              : "completed"
      }
    });
  }

  return {
    stageProgress: [input.node],
    stageArtifacts: [input.stageArtifact],
    traceSteps: [step],
    runtimePlan: createRuntimePlanUpdate({
      stageArtifact: input.stageArtifact,
      detail: input.detail
    }),
    ...(input.patch ?? {})
  };
};

const emitRunningStep = async (input: {
  state: Text2SqlV2LangGraphState;
  node: Text2SqlV2LangGraphNodeName;
  detail: string;
  evidenceIds?: string[];
  metadata?: Record<string, unknown>;
}): Promise<string> => {
  assertStateNotAborted(input.state, `before_${input.node}`);
  const startedAt = nowIso();
  if (!input.state.streamMode || !input.state.streamOptions?.onStep) {
    return startedAt;
  }

  const stageArtifact = createStageArtifact({
    stage: input.node,
    status: "success",
    evidenceIds: input.evidenceIds,
    metadata: input.metadata,
    startedAt
  });
  const runningStageArtifact = {
    ...stageArtifact,
    endedAt: undefined,
    durationMs: undefined
  };
  const sequence = input.state.traceSteps.length + 1;
  const stepNode = STAGE_NODE_TO_STEP_NODE[input.node];
  const step = createStep({
    state: input.state,
    node: input.node,
    stageArtifact: runningStageArtifact,
    detail: input.detail,
    runtimePlanStatus: "running"
  });

  await input.state.streamOptions.onStep({
    step: {
      ...step,
      stepId: `${input.state.runId}:${stepNode}:${sequence}`,
      sequence,
      lifecycle: "running",
      endedAt: undefined,
      durationMs: undefined
    }
  });

  return startedAt;
};

const emitSkippedStepsBeforeAnswer = async (
  state: Text2SqlV2LangGraphState
): Promise<void> => {
  if (!state.streamMode || !state.streamOptions?.onStep) {
    return;
  }
  const visited = new Set(state.stageProgress);
  const skippedStages = (Object.keys(STAGE_NODE_TO_STEP_NODE) as Text2SqlV2LangGraphNodeName[])
    .filter((stage) => stage !== "answer" && !visited.has(stage));

  let offset = 0;
  for (const stage of skippedStages) {
    offset += 1;
    const reasonCodes = resolveSkippedReasonCodes(state, stage);
    const stageArtifact = createStageArtifact({
      stage,
      status: "skipped",
      warnings: reasonCodes,
      metadata: {
        skippedBy: "langgraph-route"
      }
    });
    const step = createStep({
      state,
      node: stage,
      stageArtifact,
      detail: `stage ${stage} skipped`,
      runtimePlanStatus: "skipped"
    });
    const sequence = state.traceSteps.length + offset;
    await state.streamOptions.onStep({
      step: {
        ...step,
        stepId: `${state.runId}:${step.node}:${sequence}:skipped`,
        sequence,
        lifecycle: "skipped"
      }
    });
  }
};

const resolveSkippedReasonCodes = (
  state: Text2SqlV2LangGraphState,
  stage: Text2SqlV2LangGraphNodeName
): string[] => {
  if (
    state.routeArtifact?.route === "metadata" ||
    state.semanticPlanResult?.validation.routeKind === "metadata"
  ) {
    return ["metadata_no_sql"];
  }
  if (
    state.routeArtifact?.route === "general" ||
    state.semanticPlanResult?.validation.routeKind === "general"
  ) {
    return ["general_no_sql"];
  }
  if (stage === "correct" && state.validationOutcome === "pass") {
    return ["validation_passed"];
  }
  if (state.failure?.code) {
    return [state.failure.code];
  }
  return ["route_skipped"];
};

const resolveIntakeRoute = (state: Text2SqlV2LangGraphState): NodeRouteKey => {
  if (state.failure?.terminal) {
    return "answer";
  }
  const route = state.routeArtifact?.route;
  return route === "text_to_sql" || route === "metadata" ? "retrieve" : "answer";
};

const resolveRetrieveRoute = (state: Text2SqlV2LangGraphState): NodeRouteKey => {
  return state.failure?.terminal ? "answer" : "assemble-context";
};

const resolveAssembleRoute = (state: Text2SqlV2LangGraphState): NodeRouteKey => {
  return state.failure?.terminal ? "answer" : "semantic-plan";
};

const resolveSemanticPlanRoute = (state: Text2SqlV2LangGraphState): NodeRouteKey => {
  if (state.failure?.terminal) {
    return "answer";
  }
  const semanticRouteKind = state.semanticPlanResult?.validation.routeKind;
  if (state.routeArtifact?.route === "metadata" || semanticRouteKind === "metadata") {
    return "answer";
  }
  return state.semanticPlanResult?.route === "ready" ? "generate-sql" : "answer";
};

const resolveGenerateRoute = (state: Text2SqlV2LangGraphState): NodeRouteKey => {
  return state.failure?.terminal ? "answer" : "validate";
};

const resolveValidateRoute = (state: Text2SqlV2LangGraphState): NodeRouteKey => {
  if (state.failure?.terminal || state.validationOutcome === "terminal") {
    return "answer";
  }
  if (state.validationOutcome === "correctable") {
    return "correct";
  }
  return "execute";
};

const resolveCorrectRoute = (state: Text2SqlV2LangGraphState): NodeRouteKey => {
  if (state.failure?.terminal || state.correctionResult?.outcome === "terminal") {
    return "answer";
  }
  return "validate";
};

const assertStateNotAborted = (
  state: Text2SqlV2LangGraphState,
  phase: string
): void => {
  throwIfAborted(state.streamOptions?.abortSignal, {
    runId: state.runId,
    sessionId: state.sessionId,
    phase
  });
};

const semanticClarificationPrompt = (
  reasons: string[]
): ClarificationPrompt => {
  return {
    decision: "clarify",
    triggerPath: "rule",
    decisionSource: "semantic-plan",
    confidenceLevel: "low",
    reasonCodes: reasons,
    question: "请补充分析对象、指标与时间范围，以便生成可执行 SQL。",
    reason: reasons[0] ?? "semantic_plan_requires_clarification"
  };
};

const semanticFailClosedFailure = (reasons: string[]): Text2SqlV2FailureSemantic => {
  return {
    code: "SEMANTIC_PLAN_FAIL_CLOSED",
    message: "语义规划未通过，系统已按 fail-closed 终止本次执行。",
    category: "planning",
    terminal: true,
    correctable: false
  };
};

const TARGETED_REPLAN_REASON_CODES = new Set([
  "missing_join_path",
  "join_closure_missing",
  "mandatory_dependency_pruned"
]);

const buildRetrieveContextInput = (
  state: Text2SqlV2LangGraphState,
  question: string,
  accuracyEnforced: boolean
): RetrieveContextNodeInput => ({
  question,
  datasourceId: state.preparedRun.datasource.id,
  datasource: state.preparedRun.datasource,
  runId: state.runId,
  workspaceId: state.preparedRun.session.workspaceId ?? undefined,
  allowedTables: state.preparedRun.sqlAccessContext?.allowedTables,
  requiresSqlPolicy:
    accuracyEnforced &&
    state.routeArtifact?.route === "text_to_sql" &&
    Boolean(state.preparedRun.schemaGrounding),
  policyVersion: state.preparedRun.sqlAccessContext?.policyVersion,
  policyDigest: state.preparedRun.sqlAccessContext?.policyDigest,
  schemaSnapshotId: state.preparedRun.schemaGrounding?.snapshot?.snapshotId,
  schemaSnapshotDigest: state.preparedRun.schemaGrounding?.snapshot?.digest,
  allowedColumnsDigest: state.preparedRun.schemaGrounding?.snapshot?.allowedSchemaSet.digest,
  modelCatalogId: state.preparedRun.session.modelCatalogId ?? undefined,
  pinnedTables: state.preparedRun.contextEnvelope?.pinnedTables,
  pinnedColumns: state.preparedRun.contextEnvelope?.pinnedColumns
});

const resolveTargetedReplanReasons = (
  result: SemanticPlanNodeResult,
  contextPack: Text2SqlV2LangGraphState["contextPack"]
): string[] => {
  if (
    result.validation.routeKind !== "text_to_sql" ||
    (result.route !== "needs_clarification" && result.route !== "fail_closed")
  ) {
    return [];
  }
  const reasonCodes = unique([
    ...result.validation.reasons,
    ...(result.plan.planLedger?.summary.reasonCodes ?? []),
    ...(contextPack?.dependencyClosure?.reasonCodes ?? [])
  ]);
  return reasonCodes.filter((reasonCode) => TARGETED_REPLAN_REASON_CODES.has(reasonCode));
};

const buildTargetedRetrievalQuestion = (input: {
  question: string;
  selectedTables: string[];
  reasonCodes: string[];
}): string => {
  const dependencyScope = input.selectedTables.length > 0
    ? `tables=${input.selectedTables.join(",")}`
    : "tables=unresolved";
  return [
    input.question,
    `[targeted_dependency_closure ${dependencyScope} reasons=${input.reasonCodes.join(",")}]`
  ].join("\n");
};

const buildAccuracyVersionTuple = (
  state: Text2SqlV2LangGraphState
): Text2SqlEvalVersionTupleV1 => ({
  questionSet: "online-runtime.v1",
  semantic: [
    state.contextPack?.semanticVersion ?? "none",
    state.contextPack?.modelingRevision ?? "none",
    state.contextPack?.semanticLockStatus ?? "none"
  ].join(":"),
  schema:
    state.preparedRun.schemaGrounding?.snapshot?.digest ?? "schema-unavailable",
  policy:
    state.preparedRun.sqlAccessContext?.policyDigest ?? "policy-unavailable",
  data:
    state.preparedRun.schemaGrounding?.snapshot?.digest ?? "data-version-unavailable",
  model: [
    state.preparedRun.session.modelProvider ?? "unknown",
    state.preparedRun.session.modelName ?? "unknown"
  ].join(":"),
  prompt: state.preparedRun.session.modelCatalogId ?? "runtime-default",
  workflow: "text2sql-v2-langgraph.v1",
  code: "text2sql-accuracy-closure.v1"
});

const enrichSemanticPlanFromSqlArtifact = (
  semanticPlan: Text2SqlV2LangGraphState["semanticPlan"],
  sqlArtifact: Text2SqlV2LangGraphState["sqlGenerationArtifact"]
): Text2SqlV2LangGraphState["semanticPlan"] => {
  if (!semanticPlan || !sqlArtifact) {
    return semanticPlan;
  }
  const selectedTables =
    semanticPlan.selectedTables.length > 0
      ? semanticPlan.selectedTables
      : sqlArtifact.usedTables;
  const selectedColumns =
    semanticPlan.selectedColumns.length > 0
      ? semanticPlan.selectedColumns
      : sqlArtifact.usedColumns.filter((column) => column.includes("."));
  const evidenceRefs =
    semanticPlan.evidenceRefs.length > 0
      ? semanticPlan.evidenceRefs
      : sqlArtifact.evidenceRefs;

  return {
    ...semanticPlan,
    selectedTables,
    selectedColumns,
    evidenceRefs
  };
};

const summarizeSqlDraft = (
  draft: GenerateSqlNodeResult["draft"]
): Text2SqlV2LangGraphSqlDraft => {
  return {
    provider: draft.provider,
    model: draft.model,
    modelCatalogId: draft.modelCatalogId,
    sql: draft.sql,
    explanation: draft.explanation,
    promptTemplate: draft.promptTemplate,
    retryCount: draft.retryCount,
    semanticIntent: draft.semanticIntent,
    coverage: draft.coverage,
    semanticPlan: draft.semanticPlan,
    semanticContextPack: draft.semanticContextPack
  };
};

export const createText2SqlV2LangGraph = (
  deps: Text2SqlV2LangGraphDeps
) => {
  const accuracyEnforced = deps.accuracyMode !== "shadow";
  const graph = new StateGraph(Text2SqlV2LangGraphStateAnnotation)
    .addNode("intake", async (state) => {
      const stageStartedAt = await emitRunningStep({
        state,
        node: "intake",
        detail: "intake running"
      });
      const routeArtifact = deps.intakeNode.run({
        question: state.question,
        contextEnvelope: state.preparedRun.contextEnvelope
      });
      const stageStatus: Text2SqlV2StageArtifact["status"] =
        routeArtifact.route === "needs_clarification"
          ? "clarification"
          : routeArtifact.route === "unsafe" || routeArtifact.route === "unsupported"
            ? "failed"
            : "success";
      const stageArtifact = createStageArtifact({
        stage: "intake",
        status: stageStatus,
        warnings: routeArtifact.reasonCodes,
        evidenceIds: routeArtifact.evidenceRefs,
        failure:
          routeArtifact.route === "unsafe" || routeArtifact.route === "unsupported"
            ? routeArtifact.failure
            : undefined,
        metadata: {
          route: routeArtifact.route,
          confidence: routeArtifact.confidence
        },
        startedAt: stageStartedAt
      });

      return createNodeUpdate({
        state,
        node: "intake",
        stageArtifact,
        detail: `intake routed to ${routeArtifact.route}`,
        outputSummary: {
          route: routeArtifact.route,
          confidence: routeArtifact.confidence
        },
        patch: {
          routeArtifact,
          standaloneQuestion: routeArtifact.standaloneQuestion,
          directAnswer: routeArtifact.directAnswer,
          clarification: routeArtifact.clarification,
          failure:
            routeArtifact.route === "unsafe" || routeArtifact.route === "unsupported"
              ? routeArtifact.failure
              : undefined,
          terminationReason:
            routeArtifact.route === "needs_clarification"
              ? "clarification_requested"
              : undefined
        }
      });
    })
    .addNode("retrieve", async (state) => {
      const stageStartedAt = await emitRunningStep({
        state,
        node: "retrieve",
        detail: "retrieve-context running"
      });
      try {
        const output = await deps.retrieveContextNode.run(
          buildRetrieveContextInput(
            state,
            state.standaloneQuestion ?? state.question,
            accuracyEnforced
          )
        );
        const stageArtifact = createStageArtifact({
          stage: "retrieve",
          status: output.state.status === "degraded" ? "degraded" : "success",
          warnings: output.state.warnings,
          evidenceIds: output.state.evidenceRefs,
          metadata: {
            retrievalStatus: output.state.status,
            selectedContextCount: output.state.selectedContextSummary.count
          },
          startedAt: stageStartedAt
        });
        return createNodeUpdate({
          state,
          node: "retrieve",
          stageArtifact,
          detail: `retrieve-context ${output.state.status}`,
          outputSummary: {
            retrievalStatus: output.state.status,
            selectedContextCount: output.state.selectedContextSummary.count
          },
          patch: {
            retrieveState: output.state,
            retrievedArtifact: output.artifact
          }
        });
      } catch (error) {
        const failure = normalizeFailure(error, {
          code: "RETRIEVE_CONTEXT_FAILED",
          category: "retrieval"
        });
        const stageArtifact = createStageArtifact({
          stage: "retrieve",
          status: "failed",
          failure,
          startedAt: stageStartedAt
        });
        return createNodeUpdate({
          state,
          node: "retrieve",
          stageArtifact,
          detail: failure.message,
          patch: {
            failure
          }
        });
      }
    })
    .addNode("assemble-context", async (state) => {
      const stageStartedAt = await emitRunningStep({
        state,
        node: "assemble-context",
        detail: "assemble-context running",
        evidenceIds: state.retrieveState?.evidenceRefs
      });
      try {
        const output = deps.assembleContextNode.run({
          retrievalBundle: state.retrievedArtifact?.retrievalBundle,
          selectedContext: state.retrievedArtifact?.retrievalBundle?.selected_context,
          additionalWarnings: state.retrieveState?.warnings
        });
        const stageArtifact = createStageArtifact({
          stage: "assemble-context",
          status: output.contextPack.status === "degraded" ? "degraded" : "success",
          warnings: output.contextPack.warnings,
          evidenceIds: output.evidenceRefs,
          metadata: {
            selectedEvidenceCount: output.typedSummary.selectedEvidenceCount,
            selectedTableCount: output.typedSummary.selectedTableCount,
            selectedColumnCount: output.typedSummary.selectedColumnCount
          },
          startedAt: stageStartedAt
        });
        return createNodeUpdate({
          state,
          node: "assemble-context",
          stageArtifact,
          detail: `assemble-context ${output.contextPack.status}`,
          outputSummary: {
            status: output.contextPack.status,
            selectedEvidenceCount: output.typedSummary.selectedEvidenceCount
          },
          patch: {
            contextPack: output.contextPack,
            contextPackSummary: output.typedSummary
          }
        });
      } catch (error) {
        const failure = normalizeFailure(error, {
          code: "ASSEMBLE_CONTEXT_FAILED",
          category: "retrieval"
        });
        const stageArtifact = createStageArtifact({
          stage: "assemble-context",
          status: "failed",
          failure,
          startedAt: stageStartedAt
        });
        return createNodeUpdate({
          state,
          node: "assemble-context",
          stageArtifact,
          detail: failure.message,
          patch: {
            failure
          }
        });
      }
    })
    .addNode("semantic-plan", async (state) => {
      const stageStartedAt = await emitRunningStep({
        state,
        node: "semantic-plan",
        detail: "semantic-plan running",
        evidenceIds: state.contextPack?.selectedEvidenceIds
      });
      try {
        if (!state.contextPack) {
          throw new DomainError(
            "SEMANTIC_PLAN_PRECONDITION_FAILED",
            "semantic-plan stage requires context pack",
            422
          );
        }

        const semanticPlanInput = {
          question: state.standaloneQuestion ?? state.question,
          contextPack: state.contextPack,
          semanticIntent: state.routeArtifact?.semanticIntent,
          allowedTables: state.preparedRun.sqlAccessContext?.allowedTables,
          runId: state.runId,
          frozenAt: state.createdAt,
          requiresTrustedGrounding:
            accuracyEnforced &&
            state.routeArtifact?.route === "text_to_sql" &&
            Boolean(state.preparedRun.schemaGrounding)
        };
        const initialResult = deps.semanticPlanNode.run(semanticPlanInput);
        let result = initialResult;
        let effectiveContextPack = state.contextPack;
        let targetedRetrieveState = state.retrieveState;
        let targetedRetrievedArtifact = state.retrievedArtifact;
        let targetedContextPackSummary = state.contextPackSummary;
        const loopEvidence: Text2SqlV2LoopEvidence[] = [];
        const targetedReplanReasons = resolveTargetedReplanReasons(
          initialResult,
          state.contextPack
        );

        if (targetedReplanReasons.length > 0) {
          try {
            const targetedQuestion = buildTargetedRetrievalQuestion({
              question: semanticPlanInput.question,
              selectedTables: initialResult.plan.selectedTables,
              reasonCodes: targetedReplanReasons
            });
            const targetedRetrieval = await deps.retrieveContextNode.run(
              buildRetrieveContextInput(state, targetedQuestion, accuracyEnforced)
            );
            const targetedAssembly = deps.assembleContextNode.run({
              retrievalBundle: targetedRetrieval.artifact.retrievalBundle,
              selectedContext:
                targetedRetrieval.artifact.retrievalBundle?.selected_context,
              additionalWarnings: targetedRetrieval.state.warnings
            });
            effectiveContextPack = targetedAssembly.contextPack;
            targetedRetrieveState = targetedRetrieval.state;
            targetedRetrievedArtifact = targetedRetrieval.artifact;
            targetedContextPackSummary = targetedAssembly.typedSummary;
            result = deps.semanticPlanNode.run({
              ...semanticPlanInput,
              contextPack: effectiveContextPack
            });
            loopEvidence.push({
              loopIndex: 1,
              triggerReason: targetedReplanReasons.join("|"),
              actionType: "replan",
              planDelta: {
                route: {
                  from: initialResult.plan.route,
                  to: result.plan.route
                },
                snapshotId: result.plan.snapshotId,
                reasonCodes: unique([
                  "targeted_dependency_retrieval",
                  ...targetedReplanReasons,
                  ...result.validation.reasons
                ])
              },
              convergencePath: [
                "semantic-plan",
                "retrieve:targeted",
                "assemble-context:targeted",
                "semantic-plan:replan"
              ]
            });
          } catch (error) {
            loopEvidence.push({
              loopIndex: 1,
              triggerReason: targetedReplanReasons.join("|"),
              actionType: "replan",
              planDelta: {
                route: {
                  from: initialResult.plan.route,
                  to: initialResult.plan.route
                },
                snapshotId: initialResult.plan.snapshotId,
                reasonCodes: unique([
                  "targeted_dependency_retrieval_failed",
                  ...targetedReplanReasons,
                  normalizeFailure(error, {
                    category: "retrieval",
                    terminal: false
                  }).code
                ])
              },
              convergencePath: [
                "semantic-plan",
                "retrieve:targeted",
                "semantic-plan:original-result"
              ]
            });
          }
        }
        const ledgerSummary = result.plan.planLedger?.summary;
        const ledgerReasons = ledgerSummary?.reasonCodes ?? [];
        const reasons = unique([...result.validation.reasons, ...ledgerReasons]);
        let status: Text2SqlV2StageArtifact["status"] = "success";
        let failure: Text2SqlV2FailureSemantic | undefined;
        let clarification: ClarificationPrompt | undefined;
        let directAnswer: string | undefined;
        let terminationReason = state.terminationReason;

        if (result.route === "needs_clarification") {
          status = "clarification";
          clarification = semanticClarificationPrompt(reasons);
          terminationReason = "semantic_plan_requires_clarification";
        } else if (result.route === "direct_answer") {
          directAnswer =
            result.validation.routeKind === "metadata"
              ? "这是元数据问题，我会基于已检索到的表结构与语义证据给出只读说明。"
              : state.routeArtifact?.directAnswer ??
                "这是解释类问题，不需要执行 SQL；我会直接给出说明。";
        } else if (result.route === "fail_closed") {
          status = "failed";
          failure = semanticFailClosedFailure(reasons);
          terminationReason = "semantic_plan_fail_closed";
        }

        const stageArtifact = createStageArtifact({
          stage: "semantic-plan",
          status,
          warnings: reasons,
          evidenceIds: result.plan.evidenceRefs,
          failure,
          metadata: {
            route: result.route,
            routeKind: result.validation.routeKind,
            confidence: result.plan.confidence,
            ledgerGateOutcome: result.validation.ledgerGateOutcome ?? "pass",
            blockedObligationCount: result.validation.blockedObligationIds?.length ?? 0,
            warningObligationCount: result.validation.warningObligationIds?.length ?? 0
          },
          startedAt: stageStartedAt
        });
        const accuracyVersions = buildAccuracyVersionTuple(state);
        const queryContract = result.plan.queryContract;
        const access = state.preparedRun.sqlAccessContext;
        const schemaSnapshot = state.preparedRun.schemaGrounding?.snapshot;
        const closure = effectiveContextPack?.dependencyClosure;
        const policyReceipt = queryContract
          ? createText2SqlPolicyReceipt({
              runId: state.runId,
              queryContractDigest: queryContract.digest,
              versions: accuracyVersions,
              workspaceId: access?.workspaceId ?? "unavailable",
              datasourceId: state.preparedRun.datasource.id,
              workspaceDatasourceBindingId:
                access?.workspaceDatasourceBindingId ?? "unavailable",
              policyVersion: String(access?.policyVersion ?? "unavailable"),
              allowedTables: access?.allowedTables ?? [],
              schemaSnapshotDigest: schemaSnapshot?.digest ?? "unavailable",
              status: access && schemaSnapshot ? "passed" : "unavailable",
              reasonCodes:
                access && schemaSnapshot
                  ? ["frozen_policy_schema_bound"]
                  : ["frozen_policy_schema_unavailable"],
              issuedAt: state.createdAt
            })
          : undefined;
        const closureReceipt = queryContract
          ? createText2SqlClosureReceipt({
              runId: state.runId,
              queryContractDigest: queryContract.digest,
              versions: accuracyVersions,
              status: closure
                ? closure.status === "ready"
                  ? "passed"
                  : "failed"
                : "unavailable",
              conflictSet: closure?.conflictSet,
              joinClosure: closure?.joinClosure,
              metricDependencies: closure?.metricDependencies,
              calculatedDependencies: closure?.calculatedDependencies,
              filterDependencies: closure?.filterDependencies,
              timeDependencies: closure?.timeDependencies,
              mandatoryEvidenceRefs: closure?.mandatoryEvidenceRefs,
              optionalEvidenceRefs: closure?.optionalEvidenceRefs,
              reasonCodes: closure?.reasonCodes ?? ["dependency_closure_unavailable"],
              issuedAt: state.createdAt
            })
          : undefined;

        return createNodeUpdate({
          state,
          node: "semantic-plan",
          stageArtifact,
          detail: `semantic-plan route ${result.route}`,
          outputSummary: {
            route: result.route,
            confidence: result.plan.confidence,
            v2: {
              planLedger: ledgerSummary
            }
          },
          patch: {
            retrieveState: targetedRetrieveState,
            retrievedArtifact: targetedRetrievedArtifact,
            contextPack: effectiveContextPack,
            contextPackSummary: targetedContextPackSummary,
            semanticPlanResult: result,
            semanticPlan: result.plan,
            ...(queryContract
              ? {
                  accuracyEvidence: {
                    version: "text2sql-accuracy-evidence.v1" as const,
                    mode: accuracyEnforced ? "enforce" as const : "shadow" as const,
                    queryContract,
                    versions: accuracyVersions,
                    policyReceipt,
                    closureReceipt
                  }
                }
              : {}),
            loopEvidence,
            clarification,
            directAnswer,
            failure,
            terminationReason
          }
        });
      } catch (error) {
        const failure = normalizeFailure(error, {
          code: "SEMANTIC_PLAN_FAILED",
          category: "planning"
        });
        const stageArtifact = createStageArtifact({
          stage: "semantic-plan",
          status: "failed",
          failure,
          startedAt: stageStartedAt
        });
        return createNodeUpdate({
          state,
          node: "semantic-plan",
          stageArtifact,
          detail: failure.message,
          patch: {
            failure,
            terminationReason: "semantic_plan_fail_closed"
          }
        });
      }
    })
    .addNode("generate-sql", async (state) => {
      const stageStartedAt = await emitRunningStep({
        state,
        node: "generate-sql",
        detail: "generate-sql running",
        evidenceIds: state.semanticPlan?.evidenceRefs,
        metadata: {
          routeKind: "text_to_sql",
          selectedTableCount: state.semanticPlan?.selectedTables.length ?? 0,
          selectedColumnCount: state.semanticPlan?.selectedColumns.length ?? 0
        }
      });
      try {
        if (!state.semanticPlan) {
          throw new DomainError(
            "SQL_GENERATION_PRECONDITION_FAILED",
            "generate-sql stage requires semantic plan",
            422
          );
        }
        const explicitPinning =
          state.preparedRun.contextEnvelope?.pinnedTables?.length ||
          state.preparedRun.contextEnvelope?.pinnedColumns?.length
            ? {
                source: "context-envelope",
                tables: state.preparedRun.contextEnvelope?.pinnedTables ?? [],
                columns: state.preparedRun.contextEnvelope?.pinnedColumns ?? []
              }
            : undefined;

        const result = await deps.generateSqlNode.run({
          question: state.standaloneQuestion ?? state.question,
          datasourceType: state.preparedRun.datasource.type,
          modelCatalogId: state.preparedRun.session.modelCatalogId ?? undefined,
          datasourceId: state.preparedRun.datasource.id,
          workspaceId: state.preparedRun.session.workspaceId ?? undefined,
          semanticIntent: state.routeArtifact?.semanticIntent,
          selectedContext:
            state.retrievedArtifact?.retrievalBundle?.selected_context,
          semanticContextPack: state.retrievedArtifact?.contextPack,
          semanticPlan: state.semanticPlan,
          explicitPinning,
          cause: state.correctionAttemptCount > 0 ? "correction" : "initial",
          retryReason: state.correctionResult?.artifact.retryReason,
          correctionGrounding: state.correctionResult?.artifact.grounding,
          stream: state.streamMode,
          abortSignal: state.streamOptions?.abortSignal,
          tools: deps.resolveSqlTools(state),
          onEvent: state.streamOptions?.onLlmEvent
        });
        const stageArtifact = createStageArtifact({
          stage: "generate-sql",
          status: "success",
          warnings:
            result.artifact.coverage?.gateStatus === "failed"
              ? ["sql_coverage_gate_failed"]
              : undefined,
          evidenceIds: result.artifact.evidenceRefs,
          provider: {
            provider: result.draft.provider,
            model: result.draft.model
          },
          metadata: {
            cause: result.artifact.cause,
            retryReason: result.artifact.retryReason,
            correctionGrounding: result.artifact.correctionGrounding,
            usedTableCount: result.artifact.usedTables.length,
            usedColumnCount: result.artifact.usedColumns.length
          },
          startedAt: stageStartedAt
        });
        const nextSemanticPlan = enrichSemanticPlanFromSqlArtifact(
          state.semanticPlan,
          result.artifact
        );

        return createNodeUpdate({
          state,
          node: "generate-sql",
          stageArtifact,
          detail: "generate-sql completed",
          outputSummary: {
            sql: result.artifact.sql,
            cause: result.artifact.cause,
            correctionGrounding: result.artifact.correctionGrounding
          },
          patch: {
            sqlDraft: summarizeSqlDraft(result.draft),
            sqlGenerationArtifact: result.artifact,
            semanticPlan: nextSemanticPlan,
            failure: undefined
          }
        });
      } catch (error) {
        const failure = normalizeFailure(error, {
          code: "SQL_GENERATION_FAILED",
          category: "generation"
        });
        const stageArtifact = createStageArtifact({
          stage: "generate-sql",
          status: "failed",
          failure,
          startedAt: stageStartedAt
        });
        return createNodeUpdate({
          state,
          node: "generate-sql",
          stageArtifact,
          detail: failure.message,
          patch: {
            failure
          }
        });
      }
    })
    .addNode("validate", async (state) => {
      const stageStartedAt = await emitRunningStep({
        state,
        node: "validate",
        detail: "validate-sql running",
        evidenceIds: state.semanticPlan?.evidenceRefs
      });
      try {
        if (!state.sqlGenerationArtifact?.sql) {
          throw new DomainError(
            "SQL_VALIDATION_PRECONDITION_FAILED",
            "validate stage requires generated SQL",
            422
          );
        }
        const accuracyVersions = buildAccuracyVersionTuple(state);
        const result = await deps.validateSqlNode.run({
          sqlArtifact: state.sqlGenerationArtifact,
          datasourceId: state.preparedRun.datasource.id,
          datasourceType: state.preparedRun.datasource.type,
          semanticPlan: state.semanticPlan,
          accessContext: state.preparedRun.sqlAccessContext,
          allowedTables: state.preparedRun.sqlAccessContext?.allowedTables,
          schemaSnapshot: state.preparedRun.schemaGrounding?.snapshot,
          requiresCatalog: state.preparedRun.schemaGrounding?.status === "ready",
          runId: state.runId,
          accuracyVersions,
          requiresAccuracyReceipts: Boolean(
            accuracyEnforced && state.semanticPlan?.queryContract
          )
        });
        const stageStatus: Text2SqlV2StageArtifact["status"] =
          result.outcome === "pass"
            ? "success"
            : result.outcome === "correctable"
              ? "degraded"
              : "failed";
        const stageArtifact = createStageArtifact({
          stage: "validate",
          status: stageStatus,
          warnings: result.artifact.checks
            .filter((item) => item.status !== "passed")
            .map((item) => item.code ?? item.check),
          evidenceIds: state.semanticPlan?.evidenceRefs,
          failure: result.outcome === "terminal" ? result.artifact.failure : undefined,
          metadata: {
            outcome: result.outcome,
            checkCount: result.artifact.checks.length,
            correctable: result.artifact.correctable
          },
          startedAt: stageStartedAt
        });

        return createNodeUpdate({
          state,
          node: "validate",
          stageArtifact,
          detail: `validate outcome ${result.outcome}`,
          outputSummary: {
            outcome: result.outcome
          },
          patch: {
            validationOutcome: result.outcome,
            sqlValidationArtifact: result.artifact,
            ...(result.artifact.accuracy
              ? {
                  accuracyEvidence: {
                    version: "text2sql-accuracy-evidence.v1" as const,
                    ...state.accuracyEvidence,
                    queryContract: state.semanticPlan?.queryContract,
                    versions: accuracyVersions,
                    gateReceipts: result.artifact.accuracy.gateReceipts,
                    executionPermit: undefined,
                    executionReceipt: undefined,
                    resultContract: undefined,
                    resultReceipt: undefined,
                    validationReceipt: undefined
                  }
                }
              : {}),
            failure:
              result.outcome === "terminal"
                ? result.artifact.failure
                : undefined
          }
        });
      } catch (error) {
        const failure = normalizeFailure(error, {
          code: "SQL_VALIDATION_FAILED",
          category: "validation"
        });
        const stageArtifact = createStageArtifact({
          stage: "validate",
          status: "failed",
          failure,
          startedAt: stageStartedAt
        });
        return createNodeUpdate({
          state,
          node: "validate",
          stageArtifact,
          detail: failure.message,
          patch: {
            validationOutcome: "terminal",
            failure
          }
        });
      }
    })
    .addNode("correct", async (state) => {
      const stageStartedAt = await emitRunningStep({
        state,
        node: "correct",
        detail: "correct-sql running",
        evidenceIds: state.semanticPlan?.evidenceRefs,
        metadata: {
          attemptCount: state.correctionAttemptCount + 1
        }
      });
      try {
        if (!state.sqlValidationArtifact || !state.sqlGenerationArtifact?.sql) {
          throw new DomainError(
            "SQL_CORRECTION_PRECONDITION_FAILED",
            "correct stage requires failed validation artifact and SQL",
            422
          );
        }
        const result = deps.correctSqlNode.run({
          failedSql: state.sqlGenerationArtifact.sql,
          validationArtifact: state.sqlValidationArtifact,
          attemptCount: state.correctionAttemptCount,
          maxAttempts: state.correctionResult?.budget.maxAttempts,
          semanticPlan: state.semanticPlan,
          contextPack: state.contextPack,
          runId: state.runId,
          versions: state.accuracyEvidence?.versions ?? buildAccuracyVersionTuple(state),
          datasourceType: state.preparedRun.datasource.type,
          schemaSnapshot: state.preparedRun.schemaGrounding?.snapshot,
          seenSqlDigests: state.seenSqlDigests,
          seenFailureSignatures: state.seenFailureSignatures
        });
        const terminal = result.outcome === "terminal";
        const stageArtifact = createStageArtifact({
          stage: "correct",
          status: terminal ? "failed" : "success",
          warnings: [result.artifact.retryReason],
          evidenceIds: result.artifact.evidenceRefs,
          failure: result.failure,
          metadata: {
            attemptCount: result.budget.attemptCount,
            maxAttempts: result.budget.maxAttempts,
            exhausted: result.budget.exhausted,
            correctionGrounding: result.artifact.grounding
          },
          startedAt: stageStartedAt
        });
        const loopEvidence = [
          {
            loopIndex: result.budget.attemptCount,
            triggerReason: result.artifact.retryReason,
            actionType: terminal ? "fail_closed" : "continue",
            ...(terminal
              ? {
                  terminationReason: "correction_budget_exhausted"
                }
              : {}),
            convergencePath: terminal
              ? ["validate", "correct", "answer"]
              : ["validate", "correct", "validate"],
            planDelta: {
              snapshotId: state.semanticPlan?.snapshotId,
              reasonCodes: [result.artifact.failureCode ?? result.artifact.category]
            }
          }
        ];

        return createNodeUpdate({
          state,
          node: "correct",
          stageArtifact,
          detail: terminal ? "correction reached terminal state" : "correction requests retry",
          outputSummary: {
            outcome: result.outcome,
            attemptCount: result.budget.attemptCount,
            maxAttempts: result.budget.maxAttempts,
            correctionGrounding: result.artifact.grounding
          },
          patch: {
            correctionResult: result,
            correctionAttemptCount: result.budget.attemptCount,
            correctionArtifacts: [result.artifact],
            ...(result.artifact.repairReceipt
              ? {
                  seenSqlDigests: [result.artifact.repairReceipt.parentSqlDigest],
                  seenFailureSignatures: result.artifact.failureSignature
                    ? [result.artifact.failureSignature]
                    : [],
                  accuracyEvidence: {
                    version: "text2sql-accuracy-evidence.v1" as const,
                    ...state.accuracyEvidence,
                    repairReceipts: [
                      ...(state.accuracyEvidence?.repairReceipts ?? []),
                      result.artifact.repairReceipt
                    ],
                    gateReceipts: undefined,
                    executionPermit: undefined,
                    executionReceipt: undefined,
                    resultContract: undefined,
                    resultReceipt: undefined,
                    validationReceipt: undefined
                  }
                }
              : {}),
            ...(!terminal && result.artifact.patchedSql && state.sqlGenerationArtifact
              ? {
                  sqlGenerationArtifact: {
                    ...state.sqlGenerationArtifact,
                    sql: result.artifact.patchedSql,
                    correctionGrounding: result.artifact.grounding
                  },
                  validationOutcome: undefined,
                  sqlValidationArtifact: undefined
                }
              : {}),
            loopEvidence,
            failure: terminal ? result.failure : undefined,
            ...(terminal
              ? {
                  terminationReason: "correction_budget_exhausted"
                }
              : {})
          }
        });
      } catch (error) {
        const failure = normalizeFailure(error, {
          code: "SQL_CORRECTION_FAILED",
          category: "validation"
        });
        const stageArtifact = createStageArtifact({
          stage: "correct",
          status: "failed",
          failure,
          startedAt: stageStartedAt
        });
        return createNodeUpdate({
          state,
          node: "correct",
          stageArtifact,
          detail: failure.message,
          patch: {
            failure,
            terminationReason: "correction_budget_exhausted"
          }
        });
      }
    })
    .addNode("execute", async (state) => {
      const stageStartedAt = await emitRunningStep({
        state,
        node: "execute",
        detail: "execute-sql running",
        evidenceIds: state.sqlGenerationArtifact?.evidenceRefs
      });
      try {
        if (!state.sqlValidationArtifact || !state.sqlGenerationArtifact) {
          throw new DomainError(
            "SQL_EXECUTE_PRECONDITION_FAILED",
            "execute stage requires SQL and validation artifact",
            422
          );
        }

        const result = await deps.executeSqlNode.run({
          sqlArtifact: state.sqlGenerationArtifact,
          validationArtifact: state.sqlValidationArtifact,
          datasourceId: state.preparedRun.datasource.id,
          sessionId: state.sessionId,
          requestId: state.requestId,
          accessContext: state.preparedRun.sqlAccessContext,
          semanticPlan: state.semanticPlan,
          datasourceType: state.preparedRun.datasource.type,
          runId: state.runId,
          accuracyVersions: accuracyEnforced
            ? state.accuracyEvidence?.versions
            : undefined,
          accuracyGateReceipts: accuracyEnforced
            ? state.accuracyEvidence?.gateReceipts
            : undefined,
          repairReceipts: accuracyEnforced
            ? state.accuracyEvidence?.repairReceipts
            : undefined,
          abortSignal: state.streamOptions?.abortSignal
        });
        const stageArtifact = createStageArtifact({
          stage: "execute",
          status: "success",
          evidenceIds: state.sqlGenerationArtifact.evidenceRefs,
          metadata: {
            rowCount: result.rowCount,
            byteCount: result.byteCount,
            emptyResult: result.emptyResult,
            executionReceiptRef: result.executionReceipt?.receiptId,
            validationReceiptRef: result.validationReceipt?.receiptId
          },
          startedAt: stageStartedAt
        });
        return createNodeUpdate({
          state,
          node: "execute",
          stageArtifact,
          detail: "execute-sql completed",
          outputSummary: {
            rowCount: result.rowCount,
            emptyResult: result.emptyResult
          },
          patch: {
            executionResult: result,
            ...(result.executionPermit && result.executionReceipt
              ? {
                  accuracyEvidence: {
                    version: "text2sql-accuracy-evidence.v1" as const,
                    ...state.accuracyEvidence,
                    gateReceipts: uniqueGateReceipts([
                      ...(state.accuracyEvidence?.gateReceipts ?? []),
                      ...(result.resourceGateReceipt
                        ? [result.resourceGateReceipt]
                        : []),
                      ...(result.sandboxGateReceipt
                        ? [result.sandboxGateReceipt]
                        : []),
                      ...(result.resultGateReceipt
                        ? [result.resultGateReceipt]
                        : [])
                    ]),
                    executionPermit: result.executionPermit,
                    executionReceipt: result.executionReceipt,
                    resultContract: result.resultContract,
                    resultReceipt: result.resultReceipt,
                    validationReceipt: result.validationReceipt
                  }
                }
              : {})
          }
        });
      } catch (error) {
        const failure = normalizeFailure(error, {
          code: "SQL_EXECUTION_FAILED",
          category: "execution"
        });
        const stageArtifact = createStageArtifact({
          stage: "execute",
          status: "failed",
          failure,
          startedAt: stageStartedAt
        });
        return createNodeUpdate({
          state,
          node: "execute",
          stageArtifact,
          detail: failure.message,
          patch: {
            failure
          }
        });
      }
    })
    .addNode("answer", async (state) => {
      await emitSkippedStepsBeforeAnswer(state);
      const stageStartedAt = await emitRunningStep({
        state,
        node: "answer",
        detail: "answer running",
        evidenceIds: [
          ...(state.contextPack?.selectedEvidenceIds ?? []),
          ...(state.sqlGenerationArtifact?.evidenceRefs ?? [])
        ]
      });
      const warnings = unique([
        ...(state.retrieveState?.warnings ?? []),
        ...(state.contextPack?.warnings ?? []),
        ...(state.routeArtifact?.reasonCodes ?? []),
        ...(state.semanticPlanResult?.validation.reasons ?? [])
      ]);
      const answerResult = deps.answerNode.run({
        question: state.question,
        directAnswer: state.directAnswer,
        clarification: state.clarification,
        executionResult: state.executionResult,
        sqlArtifact: state.sqlGenerationArtifact,
        semanticPlan: state.semanticPlan,
        contextPack: state.contextPack,
        routeKind:
          state.semanticPlanResult?.validation.routeKind ?? state.routeArtifact?.route,
        failure: state.failure,
        warnings,
        requiresFinalValidationReceipt: accuracyEnforced
      });

      const stageStatus: Text2SqlV2StageArtifact["status"] =
        answerResult.mode === "clarification"
          ? "clarification"
          : answerResult.mode === "fail_closed" ||
              answerResult.mode === "execution_failure"
            ? "failed"
            : "success";
      const stageArtifact = createStageArtifact({
        stage: "answer",
        status: stageStatus,
        warnings: answerResult.warnings,
        evidenceIds: answerResult.evidenceRefs,
        failure: answerResult.failure,
        metadata: {
          mode: answerResult.mode,
          status: answerResult.status
        },
        startedAt: stageStartedAt
      });

      return createNodeUpdate({
        state,
        node: "answer",
        stageArtifact,
        detail: `answer mode ${answerResult.mode}`,
        outputSummary: {
          mode: answerResult.mode,
          status: answerResult.status
        },
        patch: {
          answerResult,
          failure: answerResult.failure ?? state.failure,
          completedAt: nowIso()
        }
      });
    })
    .addEdge(START, "intake")
    .addConditionalEdges("intake", resolveIntakeRoute, {
      retrieve: "retrieve",
      answer: "answer"
    })
    .addConditionalEdges("retrieve", resolveRetrieveRoute, {
      "assemble-context": "assemble-context",
      answer: "answer"
    })
    .addConditionalEdges("assemble-context", resolveAssembleRoute, {
      "semantic-plan": "semantic-plan",
      answer: "answer"
    })
    .addConditionalEdges("semantic-plan", resolveSemanticPlanRoute, {
      "generate-sql": "generate-sql",
      answer: "answer"
    })
    .addConditionalEdges("generate-sql", resolveGenerateRoute, {
      validate: "validate",
      answer: "answer"
    })
    .addConditionalEdges("validate", resolveValidateRoute, {
      execute: "execute",
      correct: "correct",
      answer: "answer"
    })
    .addConditionalEdges("correct", resolveCorrectRoute, {
      validate: "validate",
      answer: "answer"
    })
    .addEdge("execute", "answer")
    .addEdge("answer", END);

  return graph.compile();
};

export type Text2SqlV2LangGraphCompiled = ReturnType<
  typeof createText2SqlV2LangGraph
>;
