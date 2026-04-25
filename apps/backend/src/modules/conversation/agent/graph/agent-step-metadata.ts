import type { ReasoningStage } from "@text2sql/shared-types";
import {
  resolveText2SqlReasoningStage,
  resolveText2SqlTitle
} from "../../text2sql/stages/text2sql-stage-catalog";

type AgentStepStatus = "success" | "failed" | "skipped";

export const resolveAgentReasoningStage = (node: string): ReasoningStage => {
  return resolveText2SqlReasoningStage(node);
};

export const resolveAgentReasoningTitle = (node: string): string => {
  return resolveText2SqlTitle(node);
};

export const resolveAgentStepLifecycle = (
  status: AgentStepStatus
): "completed" | "failed" | "skipped" => {
  if (status === "failed") {
    return "failed";
  }
  if (status === "skipped") {
    return "skipped";
  }
  return "completed";
};
