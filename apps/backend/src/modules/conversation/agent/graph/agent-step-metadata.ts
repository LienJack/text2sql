import type { ReasoningStage } from "@text2sql/shared-types";

type AgentStepStatus = "success" | "failed" | "skipped";

const AGENT_STEP_STAGE_MAP: Record<string, ReasoningStage> = {
  clarify: "analysis",
  "retrieve-knowledge": "analysis",
  "build-intent-plan": "analysis",
  "build-semantic-query": "analysis",
  "build-physical-plan": "analysis",
  "resolve-saved-prior-sql": "analysis",
  "generate-sql": "generation",
  "safety-check": "validation",
  "execute-sql": "execution",
  "format-answer": "response"
};

const AGENT_STEP_TITLE_MAP: Record<string, string> = {
  clarify: "理解问题",
  "retrieve-knowledge": "检索上下文",
  "build-intent-plan": "意图规划",
  "build-semantic-query": "语义规划",
  "build-physical-plan": "物理规划",
  "resolve-saved-prior-sql": "Prior SQL 复用判断",
  "generate-sql": "生成 SQL",
  "safety-check": "安全校验",
  "execute-sql": "执行查询",
  "format-answer": "整理回答"
};

export const resolveAgentReasoningStage = (node: string): ReasoningStage => {
  return AGENT_STEP_STAGE_MAP[node] ?? "unknown";
};

export const resolveAgentReasoningTitle = (node: string): string => {
  return AGENT_STEP_TITLE_MAP[node] ?? node;
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
