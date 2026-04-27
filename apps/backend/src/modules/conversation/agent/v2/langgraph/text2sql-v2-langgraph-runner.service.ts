import { Injectable } from "@nestjs/common";
import type { SqlRun } from "@text2sql/shared-types";
import type { Text2SqlPreparedRunContext } from "../../../text2sql/stages/prepare-run.stage";
import { SqlToolRegistryService } from "../../sql/tools/sql-tool-registry.service";
import {
  createText2SqlV2LangGraph,
  type Text2SqlV2LangGraphCompiled
} from "./text2sql-v2-langgraph.graph";
import { Text2SqlV2LangGraphResultMapper } from "./text2sql-v2-langgraph-result.mapper";
import {
  createText2SqlV2LangGraphInitialState,
  type Text2SqlV2LangGraphRuntimeInput,
  type Text2SqlV2LangGraphState,
  type Text2SqlV2LangGraphStreamOptions
} from "./text2sql-v2-langgraph.state";
import { AnswerNode } from "./nodes/answer.node";
import { AssembleContextNode } from "./nodes/assemble-context.node";
import { CorrectSqlNode } from "./nodes/correct-sql.node";
import { ExecuteSqlNode } from "./nodes/execute-sql.node";
import { GenerateSqlNode } from "./nodes/generate-sql.node";
import { IntakeNode } from "./nodes/intake.node";
import { RetrieveContextNode } from "./nodes/retrieve-context.node";
import { SemanticPlanNode } from "./nodes/semantic-plan.node";
import { ValidateSqlNode } from "./nodes/validate-sql.node";

@Injectable()
export class Text2SqlV2LangGraphRunnerService {
  private compiledGraph?: Text2SqlV2LangGraphCompiled;

  constructor(
    private readonly intakeNode: IntakeNode,
    private readonly retrieveContextNode: RetrieveContextNode,
    private readonly assembleContextNode: AssembleContextNode,
    private readonly semanticPlanNode: SemanticPlanNode,
    private readonly generateSqlNode: GenerateSqlNode,
    private readonly validateSqlNode: ValidateSqlNode,
    private readonly correctSqlNode: CorrectSqlNode,
    private readonly executeSqlNode: ExecuteSqlNode,
    private readonly answerNode: AnswerNode,
    private readonly sqlToolRegistry: SqlToolRegistryService,
    private readonly resultMapper: Text2SqlV2LangGraphResultMapper
  ) {}

  async runSync(input: Text2SqlPreparedRunContext, route: string): Promise<SqlRun> {
    return this.runWithGraph({
      preparedRun: input,
      route,
      streamMode: false
    });
  }

  async runStream(
    input: Text2SqlPreparedRunContext,
    route: string,
    options?: Text2SqlV2LangGraphStreamOptions
  ): Promise<SqlRun> {
    return this.runWithGraph({
      preparedRun: input,
      route,
      streamMode: true,
      streamOptions: options
    });
  }

  private async runWithGraph(
    runtimeInput: Text2SqlV2LangGraphRuntimeInput
  ): Promise<SqlRun> {
    const finalState = (await this.getCompiledGraph().invoke(
      createText2SqlV2LangGraphInitialState(runtimeInput)
    )) as Text2SqlV2LangGraphState;

    if (runtimeInput.streamMode && runtimeInput.streamOptions?.onStep) {
      const steps = this.resultMapper.mapTraceSteps(finalState);
      for (const step of steps) {
        await runtimeInput.streamOptions.onStep({ step });
      }
    }

    return this.resultMapper.mapSqlRun(finalState);
  }

  private getCompiledGraph(): Text2SqlV2LangGraphCompiled {
    if (!this.compiledGraph) {
      this.compiledGraph = createText2SqlV2LangGraph({
        intakeNode: this.intakeNode,
        retrieveContextNode: this.retrieveContextNode,
        assembleContextNode: this.assembleContextNode,
        semanticPlanNode: this.semanticPlanNode,
        generateSqlNode: this.generateSqlNode,
        validateSqlNode: this.validateSqlNode,
        correctSqlNode: this.correctSqlNode,
        executeSqlNode: this.executeSqlNode,
        answerNode: this.answerNode,
        resolveSqlTools: (state) =>
          this.sqlToolRegistry.getToolsForDatasource(
            state.preparedRun.datasource,
            {
              accessContext: state.preparedRun.sqlAccessContext
            }
          )
      });
    }
    return this.compiledGraph;
  }
}
