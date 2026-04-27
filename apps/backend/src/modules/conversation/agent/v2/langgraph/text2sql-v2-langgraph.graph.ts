import { END, START, StateGraph } from "@langchain/langgraph";
import type { SqlRun } from "@text2sql/shared-types";
import {
  Text2SqlV2LangGraphStateAnnotation,
  type Text2SqlV2LangGraphNodeName,
  type Text2SqlV2LangGraphRuntimeInput,
  type Text2SqlV2LangGraphState,
  type Text2SqlV2LangGraphStateUpdate
} from "./text2sql-v2-langgraph.state";

export interface Text2SqlV2LangGraphDeps {
  runLegacyRuntime: (input: Text2SqlV2LangGraphRuntimeInput) => Promise<SqlRun>;
}

const createProgressNode = (
  stage: Text2SqlV2LangGraphNodeName
): (() => Promise<Text2SqlV2LangGraphStateUpdate>) => {
  return async () => ({
    stageProgress: [stage]
  });
};

const toRuntimeInput = (
  state: Text2SqlV2LangGraphState
): Text2SqlV2LangGraphRuntimeInput => ({
  preparedRun: state.preparedRun,
  route: state.route,
  streamMode: state.streamMode,
  streamOptions: state.streamOptions
});

export const createText2SqlV2LangGraph = (
  deps: Text2SqlV2LangGraphDeps
) => {
  const graph = new StateGraph(Text2SqlV2LangGraphStateAnnotation)
    .addNode("intake", createProgressNode("intake"))
    .addNode("retrieve", createProgressNode("retrieve"))
    .addNode("assemble-context", createProgressNode("assemble-context"))
    .addNode("semantic-plan", createProgressNode("semantic-plan"))
    .addNode("generate-sql", createProgressNode("generate-sql"))
    .addNode("validate", createProgressNode("validate"))
    .addNode("correct", createProgressNode("correct"))
    .addNode("execute", createProgressNode("execute"))
    .addNode("answer", async (state) => {
      const legacyRun = await deps.runLegacyRuntime(toRuntimeInput(state));
      return {
        stageProgress: ["answer"],
        legacyRun
      };
    })
    .addEdge(START, "intake")
    .addEdge("intake", "retrieve")
    .addEdge("retrieve", "assemble-context")
    .addEdge("assemble-context", "semantic-plan")
    .addEdge("semantic-plan", "generate-sql")
    .addEdge("generate-sql", "validate")
    .addEdge("validate", "correct")
    .addEdge("correct", "execute")
    .addEdge("execute", "answer")
    .addEdge("answer", END);

  return graph.compile();
};

export type Text2SqlV2LangGraphCompiled = ReturnType<
  typeof createText2SqlV2LangGraph
>;
