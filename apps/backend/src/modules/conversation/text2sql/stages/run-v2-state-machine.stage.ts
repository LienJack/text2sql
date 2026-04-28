import { Injectable } from "@nestjs/common";
import type { SqlRun } from "@text2sql/shared-types";
import {
  RunV2LangGraphStage,
  type Text2SqlStreamV2LangGraphOptions
} from "../../runtime/stages/run-v2-langgraph.stage";
import type { Text2SqlPreparedRunContext } from "./prepare-run.stage";

export type Text2SqlStreamV2StateMachineOptions = Text2SqlStreamV2LangGraphOptions;

@Injectable()
/**
 * @deprecated Use `RunV2LangGraphStage` as the active runtime seam.
 */
export class RunV2StateMachineStage {
  constructor(private readonly runV2LangGraphStage: RunV2LangGraphStage) {}

  runSync(input: Text2SqlPreparedRunContext, route: string): Promise<SqlRun> {
    return this.runV2LangGraphStage.runSync(input, route);
  }

  runStream(
    input: Text2SqlPreparedRunContext,
    route: string,
    options?: Text2SqlStreamV2StateMachineOptions
  ): Promise<SqlRun> {
    return this.runV2LangGraphStage.runStream(input, route, options);
  }
}
