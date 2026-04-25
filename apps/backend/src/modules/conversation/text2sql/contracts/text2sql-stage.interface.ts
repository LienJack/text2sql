import type { Text2SqlRunContext } from "./text2sql-run-context";
import type { Text2SqlStageResult } from "./text2sql-stage-result";
import type { Text2SqlStageName } from "./text2sql-stage-name";

export interface Text2SqlStage<
  TContext extends Text2SqlRunContext = Text2SqlRunContext,
  TPayload = unknown
> {
  readonly stageName: Text2SqlStageName;
  run(context: TContext): Promise<Text2SqlStageResult<TPayload>>;
}
