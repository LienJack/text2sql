import { Injectable } from "@nestjs/common";
import type { SqlRun } from "@text2sql/shared-types";
import type { Text2SqlPreparedRunContext } from "../../../text2sql/stages/prepare-run.stage";
import { Text2SqlV2RunnerService } from "../text2sql-v2-runner.service";
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

@Injectable()
export class Text2SqlV2LangGraphRunnerService {
  private compiledGraph?: Text2SqlV2LangGraphCompiled;

  constructor(
    private readonly legacyRunner: Text2SqlV2RunnerService,
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

    return this.resultMapper.mapSqlRun(finalState);
  }

  private getCompiledGraph(): Text2SqlV2LangGraphCompiled {
    if (!this.compiledGraph) {
      this.compiledGraph = createText2SqlV2LangGraph({
        runLegacyRuntime: (input) => this.runLegacyRuntime(input)
      });
    }
    return this.compiledGraph;
  }

  private runLegacyRuntime(
    input: Text2SqlV2LangGraphRuntimeInput
  ): Promise<SqlRun> {
    if (input.streamMode) {
      return this.legacyRunner.runStream(
        input.preparedRun,
        input.route,
        input.streamOptions
      );
    }
    return this.legacyRunner.runSync(input.preparedRun, input.route);
  }
}
