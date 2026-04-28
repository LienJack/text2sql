import type { ReasoningStage } from "@text2sql/shared-types";
import type {
  Text2SqlStageName,
  Text2SqlStageOutcome
} from "./text2sql-stage-name";

export interface Text2SqlStageResult<TPayload = unknown> {
  stage: Text2SqlStageName;
  outcome: Text2SqlStageOutcome;
  title: string;
  reasoningStage: ReasoningStage;
  detail?: string;
  payload?: TPayload;
}
