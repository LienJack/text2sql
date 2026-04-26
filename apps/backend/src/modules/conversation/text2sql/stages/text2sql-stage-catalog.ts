import type { ReasoningStage } from "@text2sql/shared-types";
import type { Text2SqlV2StageName } from "@text2sql/shared-types";
import type { Text2SqlStageName } from "../contracts/text2sql-stage-name";

export interface Text2SqlStageCatalogItem {
  title: string;
  reasoningStage: ReasoningStage;
}

export const TEXT2SQL_STAGE_CATALOG: Record<
  Text2SqlStageName,
  Text2SqlStageCatalogItem
> = {
  "prepare-run": {
    title: "准备运行上下文",
    reasoningStage: "analysis"
  },
  "plan-intent": {
    title: "规划意图",
    reasoningStage: "analysis"
  },
  "retrieve-context": {
    title: "检索上下文",
    reasoningStage: "analysis"
  },
  "generate-sql": {
    title: "生成 SQL",
    reasoningStage: "generation"
  },
  "validate-sql": {
    title: "校验 SQL 与策略",
    reasoningStage: "validation"
  },
  "execute-sql": {
    title: "执行查询",
    reasoningStage: "execution"
  },
  "format-answer": {
    title: "整理回答",
    reasoningStage: "response"
  },
  "persist-run": {
    title: "持久化运行记录",
    reasoningStage: "response"
  },
  "post-run-hooks": {
    title: "执行后置钩子",
    reasoningStage: "response"
  },
  generic: {
    title: "通用流程",
    reasoningStage: "unknown"
  }
};

const TEXT2SQL_LANGGRAPH_NODE_REASONING_STAGE_MAP: Record<string, ReasoningStage> = {
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

const TEXT2SQL_LANGGRAPH_NODE_TITLE_MAP: Record<string, string> = {
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

export interface Text2SqlV2StageCatalogItem {
  title: string;
  reasoningStage: ReasoningStage;
  taskProfile: string;
  defaultReasoningTier: "low" | "medium" | "high";
}

export const TEXT2SQL_V2_STAGE_CATALOG: Record<
  Text2SqlV2StageName,
  Text2SqlV2StageCatalogItem
> = {
  intake: {
    title: "理解问题",
    reasoningStage: "analysis",
    taskProfile: "intake-fast",
    defaultReasoningTier: "low"
  },
  retrieve: {
    title: "检索上下文",
    reasoningStage: "analysis",
    taskProfile: "retrieval-support",
    defaultReasoningTier: "low"
  },
  "assemble-context": {
    title: "装配语义上下文",
    reasoningStage: "analysis",
    taskProfile: "context-assembly",
    defaultReasoningTier: "low"
  },
  "semantic-plan": {
    title: "语义规划",
    reasoningStage: "analysis",
    taskProfile: "semantic-planning",
    defaultReasoningTier: "high"
  },
  "generate-sql": {
    title: "生成 SQL",
    reasoningStage: "generation",
    taskProfile: "sql-generation",
    defaultReasoningTier: "high"
  },
  validate: {
    title: "校验 SQL 与策略",
    reasoningStage: "validation",
    taskProfile: "sql-validation",
    defaultReasoningTier: "medium"
  },
  correct: {
    title: "纠正 SQL",
    reasoningStage: "validation",
    taskProfile: "sql-correction",
    defaultReasoningTier: "medium"
  },
  execute: {
    title: "执行查询",
    reasoningStage: "execution",
    taskProfile: "sql-execution",
    defaultReasoningTier: "low"
  },
  answer: {
    title: "整理回答",
    reasoningStage: "response",
    taskProfile: "answer-rendering",
    defaultReasoningTier: "low"
  }
};

export const resolveText2SqlV2StageCatalogEntry = (
  stage: Text2SqlV2StageName
): Text2SqlV2StageCatalogItem => {
  return TEXT2SQL_V2_STAGE_CATALOG[stage];
};

export const resolveText2SqlReasoningStage = (node: string): ReasoningStage => {
  return TEXT2SQL_LANGGRAPH_NODE_REASONING_STAGE_MAP[node] ?? "unknown";
};

export const resolveText2SqlTitle = (node: string): string => {
  return TEXT2SQL_LANGGRAPH_NODE_TITLE_MAP[node] ?? node;
};
