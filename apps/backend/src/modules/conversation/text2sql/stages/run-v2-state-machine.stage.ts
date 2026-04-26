import { Injectable } from "@nestjs/common";
import type { ExecutionTraceStep, SqlRun } from "@text2sql/shared-types";
import type { LlmGatewayStreamEvent } from "../../../llm/llm-gateway.interface";
import { Text2SqlV2RunnerService } from "../../agent/v2/text2sql-v2-runner.service";
import type { Text2SqlPreparedRunContext } from "./prepare-run.stage";

export interface Text2SqlStreamV2StateMachineOptions {
  onLlmEvent?: (event: LlmGatewayStreamEvent) => Promise<void> | void;
  onStep?: (event: { step: ExecutionTraceStep }) => Promise<void> | void;
}

@Injectable()
export class RunV2StateMachineStage {
  constructor(private readonly text2SqlV2Runner: Text2SqlV2RunnerService) {}

  runSync(input: Text2SqlPreparedRunContext, route: string): Promise<SqlRun> {
    return this.text2SqlV2Runner.runSync(input, route);
  }

  runStream(
    input: Text2SqlPreparedRunContext,
    route: string,
    options?: Text2SqlStreamV2StateMachineOptions
  ): Promise<SqlRun> {
    return this.text2SqlV2Runner.runStream(input, route, options);
  }
}
