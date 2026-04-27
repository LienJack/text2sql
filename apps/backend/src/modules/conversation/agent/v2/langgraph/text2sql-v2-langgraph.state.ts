import { Annotation } from "@langchain/langgraph";
import type { ExecutionTraceStep, SqlRun } from "@text2sql/shared-types";
import type { LlmGatewayStreamEvent } from "../../../../llm/llm-gateway.interface";
import type { Text2SqlPreparedRunContext } from "../../../text2sql/stages/prepare-run.stage";

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

export const Text2SqlV2LangGraphStateAnnotation = Annotation.Root({
  runId: Annotation<string>,
  sessionId: Annotation<string>,
  question: Annotation<string>,
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
  legacyRun: Annotation<SqlRun | undefined>({
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
  requestId: input.preparedRun.requestId,
  route: input.route,
  streamMode: input.streamMode,
  preparedRun: input.preparedRun,
  streamOptions: input.streamOptions,
  stageProgress: [],
  legacyRun: undefined
});
