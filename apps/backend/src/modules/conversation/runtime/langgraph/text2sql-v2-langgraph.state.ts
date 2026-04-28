import { Annotation } from "@langchain/langgraph";
import type {
  ClarificationPrompt,
  ExecutionTraceStep,
  SemanticContextPackV1,
  SemanticPlanV1,
  SqlValidationArtifactV1,
  Text2SqlV2FailureSemantic,
  Text2SqlV2LoopEvidence,
  Text2SqlV2StageArtifact,
  Text2SqlV2TerminationReason
} from "@text2sql/shared-types";
import type { LlmGatewayStreamEvent } from "../../../llm/llm-gateway.interface";
import type { Text2SqlPreparedRunContext } from "../../text2sql/stages/prepare-run.stage";
import type { StructuredSqlGenerationArtifact } from "../../agent/sql/sql-generation.service";
import type { AnswerNodeResult } from "../../nodes/answer.node";
import type { AssembleContextNodeSummary } from "../../nodes/assemble-context.node";
import type { CorrectSqlNodeResult } from "../../nodes/correct-sql.node";
import type { ExecuteSqlNodeResult } from "../../nodes/execute-sql.node";
import type { GenerateSqlNodeResult } from "../../nodes/generate-sql.node";
import type { IntakeRouteArtifact } from "../../nodes/intake.node";
import type {
  RetrieveContextNodeOutput,
  RetrieveContextNodeState
} from "../../nodes/retrieve-context.node";
import type { SemanticPlanNodeResult } from "../../nodes/semantic-plan.node";
import type { ValidateSqlNodeResult } from "../../nodes/validate-sql.node";

export const TEXT2SQL_V2_LANGGRAPH_NODE_ORDER = [
  "intake",
  "retrieve",
  "assemble-context",
  "semantic-plan",
  "generate-sql",
  "validate",
  "correct",
  "execute",
  "answer"
] as const;

export type Text2SqlV2LangGraphNodeName =
  (typeof TEXT2SQL_V2_LANGGRAPH_NODE_ORDER)[number];

export interface Text2SqlV2LangGraphStreamOptions {
  onLlmEvent?: (event: LlmGatewayStreamEvent) => Promise<void> | void;
  onStep?: (event: { step: ExecutionTraceStep }) => Promise<void> | void;
}

export interface Text2SqlV2LangGraphRuntimeInput {
  preparedRun: Text2SqlPreparedRunContext;
  route: string;
  streamMode: boolean;
  streamOptions?: Text2SqlV2LangGraphStreamOptions;
}

const replaceValueReducer = <T>(_left: T, right: T): T => right;

export type Text2SqlV2LangGraphSqlDraft = Omit<
  GenerateSqlNodeResult["draft"],
  "rawText" | "prompt"
>;

type LangGraphRetrievedArtifact = RetrieveContextNodeOutput["artifact"];

export const Text2SqlV2LangGraphStateAnnotation = Annotation.Root({
  runId: Annotation<string>,
  sessionId: Annotation<string>,
  question: Annotation<string>,
  createdAt: Annotation<string>,
  completedAt: Annotation<string | undefined>({
    reducer: replaceValueReducer,
    default: () => undefined
  }),
  requestId: Annotation<string | undefined>({
    reducer: replaceValueReducer,
    default: () => undefined
  }),
  route: Annotation<string>,
  streamMode: Annotation<boolean>,
  preparedRun: Annotation<Text2SqlPreparedRunContext>,
  streamOptions: Annotation<Text2SqlV2LangGraphStreamOptions | undefined>({
    reducer: replaceValueReducer,
    default: () => undefined
  }),
  stageProgress: Annotation<Text2SqlV2LangGraphNodeName[]>({
    reducer: (left, right) => left.concat(right),
    default: () => []
  }),
  stageArtifacts: Annotation<Text2SqlV2StageArtifact[]>({
    reducer: (left, right) => left.concat(right),
    default: () => []
  }),
  traceSteps: Annotation<ExecutionTraceStep[]>({
    reducer: (left, right) => left.concat(right),
    default: () => []
  }),
  routeArtifact: Annotation<IntakeRouteArtifact | undefined>({
    reducer: replaceValueReducer,
    default: () => undefined
  }),
  standaloneQuestion: Annotation<string | undefined>({
    reducer: replaceValueReducer,
    default: () => undefined
  }),
  directAnswer: Annotation<string | undefined>({
    reducer: replaceValueReducer,
    default: () => undefined
  }),
  clarification: Annotation<ClarificationPrompt | undefined>({
    reducer: replaceValueReducer,
    default: () => undefined
  }),
  failure: Annotation<Text2SqlV2FailureSemantic | undefined>({
    reducer: replaceValueReducer,
    default: () => undefined
  }),
  terminationReason: Annotation<Text2SqlV2TerminationReason | undefined>({
    reducer: replaceValueReducer,
    default: () => undefined
  }),
  retrieveState: Annotation<RetrieveContextNodeState | undefined>({
    reducer: replaceValueReducer,
    default: () => undefined
  }),
  retrievedArtifact: Annotation<LangGraphRetrievedArtifact | undefined>({
    reducer: replaceValueReducer,
    default: () => undefined
  }),
  contextPack: Annotation<SemanticContextPackV1 | undefined>({
    reducer: replaceValueReducer,
    default: () => undefined
  }),
  contextPackSummary: Annotation<AssembleContextNodeSummary | undefined>({
    reducer: replaceValueReducer,
    default: () => undefined
  }),
  semanticPlanResult: Annotation<SemanticPlanNodeResult | undefined>({
    reducer: replaceValueReducer,
    default: () => undefined
  }),
  semanticPlan: Annotation<SemanticPlanV1 | undefined>({
    reducer: replaceValueReducer,
    default: () => undefined
  }),
  sqlDraft: Annotation<Text2SqlV2LangGraphSqlDraft | undefined>({
    reducer: replaceValueReducer,
    default: () => undefined
  }),
  sqlGenerationArtifact: Annotation<StructuredSqlGenerationArtifact | undefined>({
    reducer: replaceValueReducer,
    default: () => undefined
  }),
  validationOutcome: Annotation<ValidateSqlNodeResult["outcome"] | undefined>({
    reducer: replaceValueReducer,
    default: () => undefined
  }),
  sqlValidationArtifact: Annotation<SqlValidationArtifactV1 | undefined>({
    reducer: replaceValueReducer,
    default: () => undefined
  }),
  correctionResult: Annotation<CorrectSqlNodeResult | undefined>({
    reducer: replaceValueReducer,
    default: () => undefined
  }),
  correctionAttemptCount: Annotation<number>({
    reducer: replaceValueReducer,
    default: () => 0
  }),
  correctionArtifacts: Annotation<CorrectSqlNodeResult["artifact"][]>({
    reducer: (left, right) => left.concat(right),
    default: () => []
  }),
  loopEvidence: Annotation<Text2SqlV2LoopEvidence[]>({
    reducer: (left, right) => left.concat(right),
    default: () => []
  }),
  executionResult: Annotation<ExecuteSqlNodeResult | undefined>({
    reducer: replaceValueReducer,
    default: () => undefined
  }),
  answerResult: Annotation<AnswerNodeResult | undefined>({
    reducer: replaceValueReducer,
    default: () => undefined
  })
});

export type Text2SqlV2LangGraphState =
  typeof Text2SqlV2LangGraphStateAnnotation.State;

export type Text2SqlV2LangGraphStateUpdate =
  typeof Text2SqlV2LangGraphStateAnnotation.Update;

export const createText2SqlV2LangGraphInitialState = (
  input: Text2SqlV2LangGraphRuntimeInput
): Text2SqlV2LangGraphState => ({
  runId: input.preparedRun.runId,
  sessionId: input.preparedRun.session.id,
  question: input.preparedRun.question,
  createdAt: new Date().toISOString(),
  completedAt: undefined,
  requestId: input.preparedRun.requestId,
  route: input.route,
  streamMode: input.streamMode,
  preparedRun: input.preparedRun,
  streamOptions: input.streamOptions,
  stageProgress: [],
  stageArtifacts: [],
  traceSteps: [],
  routeArtifact: undefined,
  standaloneQuestion: undefined,
  directAnswer: undefined,
  clarification: undefined,
  failure: undefined,
  terminationReason: undefined,
  retrieveState: undefined,
  retrievedArtifact: undefined,
  contextPack: undefined,
  contextPackSummary: undefined,
  semanticPlanResult: undefined,
  semanticPlan: undefined,
  sqlDraft: undefined,
  sqlGenerationArtifact: undefined,
  validationOutcome: undefined,
  sqlValidationArtifact: undefined,
  correctionResult: undefined,
  correctionAttemptCount: 0,
  correctionArtifacts: [],
  loopEvidence: [],
  executionResult: undefined,
  answerResult: undefined
});
