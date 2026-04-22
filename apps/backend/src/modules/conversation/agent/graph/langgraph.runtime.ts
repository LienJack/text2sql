import { Injectable } from "@nestjs/common";
import {
  Annotation,
  END,
  START,
  StateGraph,
  type LangGraphRunnableConfig
} from "@langchain/langgraph";
import type { DatasourceType } from "@text2sql/shared-types";
import { BuildIntentPlanNode } from "../nodes/build-intent-plan.node";
import { BuildPhysicalPlanNode } from "../nodes/build-physical-plan.node";
import { BuildSemanticQueryNode } from "../nodes/build-semantic-query.node";
import { ClarifyNode } from "../nodes/clarify.node";
import { ExecuteSqlNode } from "../nodes/execute-sql.node";
import { FormatAnswerNode } from "../nodes/format-answer.node";
import { GenerateSqlNode } from "../nodes/generate-sql.node";
import { RetrieveKnowledgeNode } from "../nodes/retrieve-knowledge.node";
import { SafetyCheckNode } from "../nodes/safety-check.node";
import {
  createLangGraphNodeHandlers,
  type LangGraphNodeDependencies
} from "./langgraph.node-handlers";
import type { LangGraphState } from "./langgraph.state";

const LangGraphStateAnnotation = Annotation.Root({
  runId: Annotation<string>(),
  sessionId: Annotation<string>(),
  question: Annotation<string>(),
  datasourceId: Annotation<string>(),
  datasourceType: Annotation<DatasourceType | undefined>(),
  modelCatalogId: Annotation<string | undefined>(),
  contextEnvelope: Annotation<LangGraphState["contextEnvelope"]>(),
  accessContext: Annotation<LangGraphState["accessContext"]>(),
  planningScaffoldEnabled: Annotation<boolean | undefined>(),
  traceContext: Annotation<LangGraphState["traceContext"]>(),
  provider: Annotation<string>(),
  model: Annotation<string | undefined>(),
  llmRaw: Annotation<LangGraphState["llmRaw"]>(),
  retrievedKnowledge: Annotation<LangGraphState["retrievedKnowledge"]>(),
  retrievalBundle: Annotation<LangGraphState["retrievalBundle"]>(),
  intentPlan: Annotation<LangGraphState["intentPlan"]>(),
  semanticQueryPlan: Annotation<LangGraphState["semanticQueryPlan"]>(),
  physicalPlan: Annotation<LangGraphState["physicalPlan"]>(),
  planningStatus: Annotation<LangGraphState["planningStatus"]>(),
  planningWarnings: Annotation<string[] | undefined>(),
  safetyDecision: Annotation<LangGraphState["safetyDecision"]>(),
  sql: Annotation<string | undefined>(),
  explanation: Annotation<string | undefined>(),
  rows: Annotation<Array<Record<string, unknown>> | undefined>(),
  columns: Annotation<string[] | undefined>(),
  answer: Annotation<string | undefined>(),
  error: Annotation<string | undefined>(),
  clarification: Annotation<LangGraphState["clarification"] | undefined>(),
  trace: Annotation<LangGraphState["trace"]>(),
  spanEvents: Annotation<LangGraphState["spanEvents"]>(),
  terminalStatus: Annotation<LangGraphState["terminalStatus"] | undefined>(),
  fatalError: Annotation<unknown>()
});

export const createLangGraphRuntime = (deps: LangGraphNodeDependencies) => {
  const handlers = createLangGraphNodeHandlers(deps);
  return new StateGraph(LangGraphStateAnnotation)
    .addNode("clarify", handlers.clarify)
    .addNode("retrieve-knowledge", handlers.retrieveKnowledge)
    .addNode("build-intent-plan", handlers.buildIntentPlan)
    .addNode("build-semantic-query", handlers.buildSemanticQuery)
    .addNode("build-physical-plan", handlers.buildPhysicalPlan)
    .addNode("generate-sql", handlers.generateSql)
    .addNode("safety-check", handlers.safetyCheck)
    .addNode("execute-sql", handlers.executeSql)
    .addNode("format-answer", handlers.formatAnswer)
    .addEdge(START, "clarify")
    .addConditionalEdges(
      "clarify",
      (state) => (state.terminalStatus === "clarification" ? "done" : "continue"),
      {
        done: END,
        continue: "retrieve-knowledge"
      }
    )
    .addEdge("retrieve-knowledge", "build-intent-plan")
    .addEdge("build-intent-plan", "build-semantic-query")
    .addEdge("build-semantic-query", "build-physical-plan")
    .addEdge("build-physical-plan", "generate-sql")
    .addConditionalEdges(
      "generate-sql",
      (state) => (state.fatalError ? "fatal" : "continue"),
      {
        fatal: END,
        continue: "safety-check"
      }
    )
    .addConditionalEdges(
      "safety-check",
      (state) => (state.terminalStatus === "rejected" ? "rejected" : "continue"),
      {
        rejected: END,
        continue: "execute-sql"
      }
    )
    .addConditionalEdges(
      "execute-sql",
      (state) => (state.terminalStatus === "failed" ? "failed" : "continue"),
      {
        failed: END,
        continue: "format-answer"
      }
    )
    .addEdge("format-answer", END)
    .compile();
};

export type LangGraphRuntime = ReturnType<typeof createLangGraphRuntime>;

@Injectable()
export class LangGraphRuntimeService {
  private readonly graph: LangGraphRuntime;

  constructor(
    private readonly clarifyNode: ClarifyNode,
    private readonly retrieveKnowledgeNode: RetrieveKnowledgeNode,
    private readonly buildIntentPlanNode: BuildIntentPlanNode,
    private readonly buildSemanticQueryNode: BuildSemanticQueryNode,
    private readonly buildPhysicalPlanNode: BuildPhysicalPlanNode,
    private readonly generateSqlNode: GenerateSqlNode,
    private readonly safetyNode: SafetyCheckNode,
    private readonly executeNode: ExecuteSqlNode,
    private readonly formatNode: FormatAnswerNode
  ) {
    this.graph = createLangGraphRuntime({
      clarifyNode: this.clarifyNode,
      retrieveKnowledgeNode: this.retrieveKnowledgeNode,
      buildIntentPlanNode: this.buildIntentPlanNode,
      buildSemanticQueryNode: this.buildSemanticQueryNode,
      buildPhysicalPlanNode: this.buildPhysicalPlanNode,
      generateSqlNode: this.generateSqlNode,
      safetyNode: this.safetyNode,
      executeNode: this.executeNode,
      formatNode: this.formatNode
    });
  }

  async invoke(
    input: LangGraphState,
    config?: LangGraphRunnableConfig
  ): Promise<LangGraphState> {
    return this.graph.invoke(input, config);
  }
}
