import { Injectable } from "@nestjs/common";
import type { ExecutionTraceStep, SqlRun } from "@text2sql/shared-types";
import type { LlmGatewayStreamEvent } from "../../../llm/llm-gateway.interface";
import { Text2SqlV2LangGraphRunnerService } from "../../agent/v2/langgraph/text2sql-v2-langgraph-runner.service";
import type { Text2SqlPreparedRunContext } from "./prepare-run.stage";

export interface Text2SqlStreamV2LangGraphOptions {
  onLlmEvent?: (event: LlmGatewayStreamEvent) => Promise<void> | void;
  onStep?: (event: { step: ExecutionTraceStep }) => Promise<void> | void;
}

@Injectable()
export class RunV2LangGraphStage {
  constructor(
    private readonly text2SqlV2LangGraphRunner: Text2SqlV2LangGraphRunnerService
  ) {}

  runSync(input: Text2SqlPreparedRunContext, route: string): Promise<SqlRun> {
    return this.text2SqlV2LangGraphRunner.runSync(input, route);
  }

  runStream(
    input: Text2SqlPreparedRunContext,
    route: string,
    options?: Text2SqlStreamV2LangGraphOptions
  ): Promise<SqlRun> {
    return this.text2SqlV2LangGraphRunner.runStream(input, route, options);
  }
}
