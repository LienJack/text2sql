import type { ReasoningStage } from "@text2sql/shared-types";
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

export const TEXT2SQL_LANGGRAPH_NODE_STAGE_MAP = {
  clarify: "plan-intent",
  "retrieve-knowledge": "retrieve-context",
  "build-intent-plan": "plan-intent",
  "build-semantic-query": "plan-intent",
  "build-physical-plan": "plan-intent",
  "resolve-saved-prior-sql": "generate-sql",
  "generate-sql": "generate-sql",
  "safety-check": "validate-sql",
  "execute-sql": "execute-sql",
  "relationship-correction": "generate-sql",
  "format-answer": "format-answer"
} as const satisfies Record<string, Text2SqlStageName>;

export type Text2SqlLangGraphNodeName =
  keyof typeof TEXT2SQL_LANGGRAPH_NODE_STAGE_MAP;

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

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

export interface Text2SqlNodeStageCatalogEntry {
  node: string;
  stageName: Text2SqlStageName;
  stageTitle: string;
  reasoningStage: ReasoningStage;
  title: string;
}

export const resolveText2SqlStageName = (node: string): Text2SqlStageName => {
  if (hasOwn(TEXT2SQL_LANGGRAPH_NODE_STAGE_MAP, node)) {
    return TEXT2SQL_LANGGRAPH_NODE_STAGE_MAP[node as Text2SqlLangGraphNodeName];
  }
  return "generic";
};

export const resolveText2SqlReasoningStage = (node: string): ReasoningStage => {
  return TEXT2SQL_LANGGRAPH_NODE_REASONING_STAGE_MAP[node] ?? "unknown";
};

export const resolveText2SqlTitle = (node: string): string => {
  return TEXT2SQL_LANGGRAPH_NODE_TITLE_MAP[node] ?? node;
};

export const resolveText2SqlNodeStageCatalogEntry = (
  node: string
): Text2SqlNodeStageCatalogEntry => {
  const stageName = resolveText2SqlStageName(node);
  const stage = TEXT2SQL_STAGE_CATALOG[stageName];
  return {
    node,
    stageName,
    stageTitle: stage.title,
    reasoningStage: resolveText2SqlReasoningStage(node),
    title: resolveText2SqlTitle(node)
  };
};
