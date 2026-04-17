import { Injectable } from "@nestjs/common";
import {
  Annotation,
  END,
  START,
  StateGraph,
  type LangGraphRunnableConfig
} from "@langchain/langgraph";
import type { ExecutionTraceStep } from "@text2sql/shared-types";
import type { DatasourceType } from "@text2sql/shared-types";
import { BuildIntentPlanNode } from "../nodes/build-intent-plan.node";
import { BuildPhysicalPlanNode } from "../nodes/build-physical-plan.node";
import { BuildSemanticQueryNode } from "../nodes/build-semantic-query.node";
import { ClarifyNode } from "../nodes/clarify.node";
import { ExecuteSqlNode } from "../nodes/execute-sql.node";
import { FormatAnswerNode } from "../nodes/format-answer.node";
import { GenerateSqlNode } from "../nodes/generate-sql.node";
import { RetrieveKnowledgeNode } from "../nodes/retrieve-knowledge.node";
import { SafetyCheckNode } from "../nodes/safety-check.node";
import type {
  LlmGatewayStreamEvent,
  LlmGatewayToolDefinition
} from "../../llm/llm-gateway.interface";
import { appendStep, type LangGraphState } from "./langgraph.state";

const LangGraphStateAnnotation = Annotation.Root({
  runId: Annotation<string>(),
  sessionId: Annotation<string>(),
  question: Annotation<string>(),
  datasourceId: Annotation<string>(),
  datasourceType: Annotation<DatasourceType | undefined>(),
  modelCatalogId: Annotation<string | undefined>(),
  accessContext: Annotation<LangGraphState["accessContext"]>(),
  planningScaffoldEnabled: Annotation<boolean | undefined>(),
  traceContext: Annotation<LangGraphState["traceContext"]>(),
  provider: Annotation<string>(),
  model: Annotation<string | undefined>(),
  llmRaw: Annotation<LangGraphState["llmRaw"]>(),
  retrievedKnowledge: Annotation<LangGraphState["retrievedKnowledge"]>(),
  retrievalBundle: Annotation<LangGraphState["retrievalBundle"]>(),
  intentPlan: Annotation<LangGraphState["intentPlan"]>(),
  semanticQueryPlan: Annotation<LangGraphState["semanticQueryPlan"]>(),
  physicalPlan: Annotation<LangGraphState["physicalPlan"]>(),
  planningStatus: Annotation<LangGraphState["planningStatus"]>(),
  planningWarnings: Annotation<string[] | undefined>(),
  safetyDecision: Annotation<LangGraphState["safetyDecision"]>(),
  sql: Annotation<string | undefined>(),
  explanation: Annotation<string | undefined>(),
  rows: Annotation<Array<Record<string, unknown>> | undefined>(),
  columns: Annotation<string[] | undefined>(),
  answer: Annotation<string | undefined>(),
  error: Annotation<string | undefined>(),
  clarification: Annotation<LangGraphState["clarification"] | undefined>(),
  trace: Annotation<LangGraphState["trace"]>(),
  spanEvents: Annotation<LangGraphState["spanEvents"]>(),
  terminalStatus: Annotation<LangGraphState["terminalStatus"] | undefined>(),
  fatalError: Annotation<unknown>()
});

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const MAX_SUMMARY_LENGTH = 240;

const truncate = (value: string): string => {
  if (value.length <= MAX_SUMMARY_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_SUMMARY_LENGTH)}…`;
};

const summarize = (value: unknown): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    const compact = value.replace(/\s+/g, " ").trim();
    return compact ? truncate(compact) : undefined;
  }
  try {
    return truncate(JSON.stringify(value));
  } catch {
    return undefined;
  }
};

const withTiming = (startedAt: string, endedAt: string) => ({
  at: endedAt,
  startedAt,
  endedAt,
  durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt))
});

interface RuntimeCallbacks {
  streamMode?: boolean;
  tools?: Record<string, LlmGatewayToolDefinition>;
  onStep?: (step: ExecutionTraceStep) => Promise<void> | void;
  onLlmEvent?: (event: LlmGatewayStreamEvent) => Promise<void> | void;
}

const getCallbacks = (config?: LangGraphRunnableConfig): RuntimeCallbacks => {
  return (config?.configurable as RuntimeCallbacks | undefined) ?? {};
};

const emitStep = async (
  config: LangGraphRunnableConfig | undefined,
  step?: ExecutionTraceStep
) => {
  if (!step) {
    return;
  }
  const callbacks = getCallbacks(config);
  if (!callbacks.onStep) {
    return;
  }
  await callbacks.onStep(step);
};

const latestStep = (
  traceState: Pick<LangGraphState, "trace">
): ExecutionTraceStep | undefined => traceState.trace.steps.at(-1);

const buildRunningStep = (
  state: Pick<LangGraphState, "runId" | "trace">,
  node: string,
  startedAt: string,
  detail: string
): ExecutionTraceStep => {
  const sequence = state.trace.steps.length + 1;
  return {
    node,
    status: "success",
    lifecycle: "running",
    stepId: `${state.runId}:${node}:${sequence}`,
    sequence,
    detail,
    at: startedAt,
    startedAt
  };
};

const appendPlanningWarning = (
  state: LangGraphState,
  warning: string
): string[] => {
  return [...(state.planningWarnings ?? []), warning];
};

export interface LangGraphNodeDependencies {
  clarifyNode: Pick<ClarifyNode, "run">;
  retrieveKnowledgeNode: Pick<RetrieveKnowledgeNode, "run">;
  buildIntentPlanNode: Pick<BuildIntentPlanNode, "run">;
  buildSemanticQueryNode: Pick<BuildSemanticQueryNode, "run">;
  buildPhysicalPlanNode: Pick<BuildPhysicalPlanNode, "run">;
  generateSqlNode: Pick<GenerateSqlNode, "run">;
  safetyNode: Pick<SafetyCheckNode, "run">;
  executeNode: Pick<ExecuteSqlNode, "run">;
  formatNode: Pick<FormatAnswerNode, "run">;
}

export const createLangGraphRuntime = (deps: LangGraphNodeDependencies) => {
  const graph = new StateGraph(LangGraphStateAnnotation)
    .addNode("clarify", async (state, config) => {
      const startedAt = new Date().toISOString();
      await emitStep(
        config,
        buildRunningStep(state, "clarify", startedAt, "正在理解问题")
      );
      const clarification = deps.clarifyNode.run(state.question);
      const endedAt = new Date().toISOString();
      if (clarification) {
        const outputs = {
          clarificationQuestion: clarification.question
        };
        const trace = appendStep(state, {
          step: {
            node: "clarify",
            status: "success",
            detail: clarification.reason,
            ...withTiming(startedAt, endedAt),
            outputSummary: summarize(outputs)
          },
          runType: "tool",
          outputs
        });
        await emitStep(config, latestStep(trace));
        return {
          ...trace,
          clarification,
          answer: clarification.question,
          terminalStatus: "clarification"
        };
      }
      const trace = appendStep(state, {
        step: {
          node: "clarify",
          status: "skipped",
          detail: "问题信息充足，跳过澄清。",
          ...withTiming(startedAt, endedAt)
        }
      });
      await emitStep(config, latestStep(trace));
      return trace;
    })
    .addNode("retrieve-knowledge", async (state, config) => {
      const startedAt = new Date().toISOString();
      await emitStep(
        config,
        buildRunningStep(state, "retrieve-knowledge", startedAt, "正在检索知识上下文")
      );
      if (!state.planningScaffoldEnabled) {
        const endedAt = new Date().toISOString();
        const trace = appendStep(state, {
          step: {
            node: "retrieve-knowledge",
            status: "skipped",
            detail: "规划骨架未启用，跳过检索节点。",
            ...withTiming(startedAt, endedAt)
          }
        });
        await emitStep(config, latestStep(trace));
        return {
          ...trace,
          planningStatus: "legacy"
        };
      }

      try {
        const knowledge = await deps.retrieveKnowledgeNode.run({
          question: state.question,
          datasourceId: state.datasourceId,
          runId: state.runId,
          modelCatalogId: state.modelCatalogId
        });
        const endedAt = new Date().toISOString();
        const outputs = {
          status: knowledge.status,
          snippets: knowledge.snippets,
          degradeReasons: knowledge.retrievalBundle?.degrade_reasons ?? [],
          candidateCount: knowledge.retrievalBundle?.candidates.length ?? 0,
          selectedContextCount:
            knowledge.retrievalBundle?.selected_context?.length ?? 0
        };
        const trace = appendStep(state, {
          step: {
            node: "retrieve-knowledge",
            status: "success",
            detail: knowledge.summary,
            ...withTiming(startedAt, endedAt),
            outputSummary: summarize(outputs)
          },
          outputs
        });
        await emitStep(config, latestStep(trace));
        return {
          ...trace,
          retrievedKnowledge: knowledge,
          retrievalBundle: knowledge.retrievalBundle,
          planningStatus: knowledge.status === "ready" ? "ready" : "degraded",
          planningWarnings:
            knowledge.status === "ready"
              ? state.planningWarnings
              : appendPlanningWarning(state, knowledge.summary)
        };
      } catch (error) {
        const message = toErrorMessage(error);
        const endedAt = new Date().toISOString();
        const trace = appendStep(state, {
          step: {
            node: "retrieve-knowledge",
            status: "failed",
            detail: message,
            ...withTiming(startedAt, endedAt),
            errorSummary: summarize(message)
          },
          error: message
        });
        await emitStep(config, latestStep(trace));
        return {
          ...trace,
          planningStatus: "degraded",
          planningWarnings: appendPlanningWarning(state, message)
        };
      }
    })
    .addNode("build-intent-plan", async (state, config) => {
      const startedAt = new Date().toISOString();
      await emitStep(
        config,
        buildRunningStep(state, "build-intent-plan", startedAt, "正在构建意图规划")
      );
      if (!state.planningScaffoldEnabled) {
        const endedAt = new Date().toISOString();
        const trace = appendStep(state, {
          step: {
            node: "build-intent-plan",
            status: "skipped",
            detail: "规划骨架未启用，跳过意图规划节点。",
            ...withTiming(startedAt, endedAt)
          }
        });
        await emitStep(config, latestStep(trace));
        return trace;
      }

      if (!state.retrievedKnowledge) {
        const reason = "缺少检索上下文，意图规划降级。";
        const endedAt = new Date().toISOString();
        const trace = appendStep(state, {
          step: {
            node: "build-intent-plan",
            status: "failed",
            detail: reason,
            ...withTiming(startedAt, endedAt),
            errorSummary: summarize(reason)
          },
          error: reason
        });
        await emitStep(config, latestStep(trace));
        return {
          ...trace,
          planningStatus: "degraded",
          planningWarnings: appendPlanningWarning(state, reason)
        };
      }

      try {
        const intentPlan = deps.buildIntentPlanNode.run(
          state.question,
          state.retrievedKnowledge
        );
        const endedAt = new Date().toISOString();
        const outputs = {
          status: intentPlan.status,
          intent: intentPlan.intent,
          constraints: intentPlan.constraints
        };
        const trace = appendStep(state, {
          step: {
            node: "build-intent-plan",
            status: "success",
            detail: intentPlan.summary,
            ...withTiming(startedAt, endedAt),
            outputSummary: summarize(outputs)
          },
          outputs
        });
        await emitStep(config, latestStep(trace));
        return {
          ...trace,
          intentPlan,
          planningStatus: intentPlan.status === "ready" ? state.planningStatus : "degraded",
          planningWarnings:
            intentPlan.status === "ready"
              ? state.planningWarnings
              : appendPlanningWarning(state, intentPlan.summary)
        };
      } catch (error) {
        const message = toErrorMessage(error);
        const endedAt = new Date().toISOString();
        const trace = appendStep(state, {
          step: {
            node: "build-intent-plan",
            status: "failed",
            detail: message,
            ...withTiming(startedAt, endedAt),
            errorSummary: summarize(message)
          },
          error: message
        });
        await emitStep(config, latestStep(trace));
        return {
          ...trace,
          planningStatus: "degraded",
          planningWarnings: appendPlanningWarning(state, message)
        };
      }
    })
    .addNode("build-semantic-query", async (state, config) => {
      const startedAt = new Date().toISOString();
      await emitStep(
        config,
        buildRunningStep(
          state,
          "build-semantic-query",
          startedAt,
          "正在构建语义检索计划"
        )
      );
      if (!state.planningScaffoldEnabled) {
        const endedAt = new Date().toISOString();
        const trace = appendStep(state, {
          step: {
            node: "build-semantic-query",
            status: "skipped",
            detail: "规划骨架未启用，跳过语义检索节点。",
            ...withTiming(startedAt, endedAt)
          }
        });
        await emitStep(config, latestStep(trace));
        return trace;
      }

      if (!state.intentPlan) {
        const reason = "缺少意图规划，语义检索降级。";
        const endedAt = new Date().toISOString();
        const trace = appendStep(state, {
          step: {
            node: "build-semantic-query",
            status: "failed",
            detail: reason,
            ...withTiming(startedAt, endedAt),
            errorSummary: summarize(reason)
          },
          error: reason
        });
        await emitStep(config, latestStep(trace));
        return {
          ...trace,
          planningStatus: "degraded",
          planningWarnings: appendPlanningWarning(state, reason)
        };
      }

      try {
        const semanticQueryPlan = deps.buildSemanticQueryNode.run(state.intentPlan);
        const endedAt = new Date().toISOString();
        const outputs = {
          status: semanticQueryPlan.status,
          semanticHints: semanticQueryPlan.semanticHints
        };
        const trace = appendStep(state, {
          step: {
            node: "build-semantic-query",
            status: "success",
            detail: semanticQueryPlan.summary,
            ...withTiming(startedAt, endedAt),
            outputSummary: summarize(outputs)
          },
          outputs
        });
        await emitStep(config, latestStep(trace));
        return {
          ...trace,
          semanticQueryPlan,
          planningStatus:
            semanticQueryPlan.status === "ready" ? state.planningStatus : "degraded",
          planningWarnings:
            semanticQueryPlan.status === "ready"
              ? state.planningWarnings
              : appendPlanningWarning(state, semanticQueryPlan.summary)
        };
      } catch (error) {
        const message = toErrorMessage(error);
        const endedAt = new Date().toISOString();
        const trace = appendStep(state, {
          step: {
            node: "build-semantic-query",
            status: "failed",
            detail: message,
            ...withTiming(startedAt, endedAt),
            errorSummary: summarize(message)
          },
          error: message
        });
        await emitStep(config, latestStep(trace));
        return {
          ...trace,
          planningStatus: "degraded",
          planningWarnings: appendPlanningWarning(state, message)
        };
      }
    })
    .addNode("build-physical-plan", async (state, config) => {
      const startedAt = new Date().toISOString();
      await emitStep(
        config,
        buildRunningStep(
          state,
          "build-physical-plan",
          startedAt,
          "正在构建物理执行计划"
        )
      );
      if (!state.planningScaffoldEnabled) {
        const endedAt = new Date().toISOString();
        const trace = appendStep(state, {
          step: {
            node: "build-physical-plan",
            status: "skipped",
            detail: "规划骨架未启用，跳过物理规划节点。",
            ...withTiming(startedAt, endedAt)
          }
        });
        await emitStep(config, latestStep(trace));
        return trace;
      }

      if (!state.semanticQueryPlan) {
        const reason = "缺少语义规划，物理计划降级。";
        const endedAt = new Date().toISOString();
        const trace = appendStep(state, {
          step: {
            node: "build-physical-plan",
            status: "failed",
            detail: reason,
            ...withTiming(startedAt, endedAt),
            errorSummary: summarize(reason)
          },
          error: reason
        });
        await emitStep(config, latestStep(trace));
        return {
          ...trace,
          planningStatus: "degraded",
          planningWarnings: appendPlanningWarning(state, reason)
        };
      }

      try {
        const physicalPlan = deps.buildPhysicalPlanNode.run(state.semanticQueryPlan);
        const endedAt = new Date().toISOString();
        const outputs = {
          status: physicalPlan.status,
          strategy: physicalPlan.strategy
        };
        const trace = appendStep(state, {
          step: {
            node: "build-physical-plan",
            status: "success",
            detail: physicalPlan.summary,
            ...withTiming(startedAt, endedAt),
            outputSummary: summarize(outputs)
          },
          outputs
        });
        await emitStep(config, latestStep(trace));
        return {
          ...trace,
          physicalPlan,
          planningStatus: physicalPlan.status === "ready" ? state.planningStatus : "degraded",
          planningWarnings:
            physicalPlan.status === "ready"
              ? state.planningWarnings
              : appendPlanningWarning(state, physicalPlan.summary)
        };
      } catch (error) {
        const message = toErrorMessage(error);
        const endedAt = new Date().toISOString();
        const trace = appendStep(state, {
          step: {
            node: "build-physical-plan",
            status: "failed",
            detail: message,
            ...withTiming(startedAt, endedAt),
            errorSummary: summarize(message)
          },
          error: message
        });
        await emitStep(config, latestStep(trace));
        return {
          ...trace,
          planningStatus: "degraded",
          planningWarnings: appendPlanningWarning(state, message)
        };
      }
    })
    .addNode("generate-sql", async (state, config) => {
      const startedAt = new Date().toISOString();
      await emitStep(
        config,
        buildRunningStep(state, "generate-sql", startedAt, "正在生成 SQL")
      );
      const callbacks = getCallbacks(config);
      try {
        const generated = await deps.generateSqlNode.run(
          state.question,
          state.datasourceType,
          state.modelCatalogId,
          callbacks.streamMode
            ? {
                stream: true,
                tools: callbacks.tools,
                onEvent: callbacks.onLlmEvent,
                selectedContext: state.retrievalBundle?.selected_context
              }
            : {
                selectedContext: state.retrievalBundle?.selected_context
              }
        );
        const endedAt = new Date().toISOString();
        const inputs = {
          question: state.question,
          datasourceType: state.datasourceType,
          selectedContextCount: state.retrievalBundle?.selected_context?.length ?? 0,
          retrievalStatus: state.retrievalBundle?.status,
          retrievalDegradeReasons: state.retrievalBundle?.degrade_reasons,
          retrievalRiskTags: state.retrievalBundle?.risk_tags ?? [],
          modelCatalogId: state.modelCatalogId,
          planningScaffoldEnabled: state.planningScaffoldEnabled,
          planningStatus: state.planningStatus,
          planningWarnings: state.planningWarnings,
          retrieveSummary: state.retrievedKnowledge?.summary,
          intent: state.intentPlan?.intent,
          semanticHints: state.semanticQueryPlan?.semanticHints,
          physicalStrategy: state.physicalPlan?.strategy
        };
        const outputs = {
          provider: generated.provider,
          model: generated.model,
          modelCatalogId: generated.modelCatalogId,
          sql: generated.sql,
          rawText: generated.rawText
        };
        const trace = appendStep(state, {
          step: {
            node: "generate-sql",
            status: "success",
            detail: generated.provider,
            ...withTiming(startedAt, endedAt),
            inputSummary: summarize(inputs),
            outputSummary: summarize(outputs)
          },
          runType: "llm",
          inputs,
          outputs
        });
        await emitStep(config, latestStep(trace));
        return {
          ...trace,
          trace: {
            ...trace.trace,
            provider: generated.provider
          },
          provider: generated.provider,
          model: generated.model,
          llmRaw: {
            provider: generated.provider,
            model: generated.model,
            rawText: generated.rawText,
            createdAt: endedAt
          },
          sql: generated.sql,
          explanation: generated.explanation,
          error: undefined,
          fatalError: undefined
        };
      } catch (error) {
        const endedAt = new Date().toISOString();
        const message = toErrorMessage(error);
        const inputs = {
          question: state.question
        };
        const trace = appendStep(state, {
          step: {
            node: "generate-sql",
            status: "failed",
            detail: message,
            ...withTiming(startedAt, endedAt),
            inputSummary: summarize(inputs),
            errorSummary: summarize(message)
          },
          runType: "llm",
          inputs,
          error: message
        });
        await emitStep(config, latestStep(trace));
        return {
          ...trace,
          error: message,
          terminalStatus: "failed",
          fatalError: error
        };
      }
    })
    .addNode("safety-check", async (state, config) => {
      const startedAt = new Date().toISOString();
      await emitStep(
        config,
        buildRunningStep(state, "safety-check", startedAt, "正在执行安全校验")
      );
      if (!state.sql) {
        const reason = "未生成 SQL，无法执行安全校验。";
        const endedAt = new Date().toISOString();
        const trace = appendStep(state, {
          step: {
            node: "safety-check",
            status: "failed",
            detail: reason,
            ...withTiming(startedAt, endedAt),
            errorSummary: summarize(reason)
          },
          runType: "tool",
          error: reason
        });
        await emitStep(config, latestStep(trace));
        return {
          ...trace,
          error: reason,
          terminalStatus: "failed"
        };
      }

      const safety = await deps.safetyNode.run({
        sql: state.sql,
        datasourceId: state.datasourceId,
        accessContext: state.accessContext,
        riskTags: state.retrievalBundle?.risk_tags
      });
      const endedAt = new Date().toISOString();
      const inputs = {
        sql: state.sql,
        datasourceId: state.datasourceId,
        workspaceId: state.accessContext?.workspaceId
      };
      if (!safety.allowed) {
        const trace = appendStep(state, {
          step: {
            node: "safety-check",
            status: "failed",
            detail: safety.reason ?? "SQL 未通过安全策略校验。",
            ...withTiming(startedAt, endedAt),
            inputSummary: summarize(inputs),
            errorSummary: summarize(safety.reason)
          },
          runType: "tool",
          inputs,
          metadata: {
            mode: safety.mode,
            riskLevel: safety.riskLevel,
            riskTags: safety.riskTags
          },
          error: safety.reason
        });
        await emitStep(config, latestStep(trace));
        return {
          ...trace,
          error: safety.reason,
          safetyDecision: safety,
          terminalStatus: "rejected"
        };
      }

      const detail =
        safety.mode === "soft-warn"
          ? `SQL 通过只读校验（软告警：${safety.riskTags.join(", ") || "none"}）。`
          : "SQL 通过只读校验。";
      const trace = appendStep(state, {
        step: {
          node: "safety-check",
          status: "success",
          detail,
          ...withTiming(startedAt, endedAt),
          inputSummary: summarize(inputs),
          outputSummary: summarize({
            mode: safety.mode,
            riskLevel: safety.riskLevel,
            riskTags: safety.riskTags
          })
        },
        metadata: {
          mode: safety.mode,
          riskLevel: safety.riskLevel,
          riskTags: safety.riskTags
        }
      });
      await emitStep(config, latestStep(trace));
      return {
        ...trace,
        safetyDecision: safety
      };
    })
    .addNode("execute-sql", async (state, config) => {
      const startedAt = new Date().toISOString();
      await emitStep(
        config,
        buildRunningStep(state, "execute-sql", startedAt, "正在执行查询")
      );
      if (!state.sql) {
        const reason = "未生成 SQL，无法执行查询。";
        const endedAt = new Date().toISOString();
        const trace = appendStep(state, {
          step: {
            node: "execute-sql",
            status: "failed",
            detail: reason,
            ...withTiming(startedAt, endedAt),
            errorSummary: summarize(reason)
          },
          runType: "tool",
          error: reason
        });
        await emitStep(config, latestStep(trace));
        return {
          ...trace,
          error: reason,
          terminalStatus: "failed"
        };
      }
      try {
        const execution = await deps.executeNode.run({
          sql: state.sql,
          datasourceId: state.datasourceId,
          sessionId: state.sessionId,
          requestId: state.traceContext?.requestId,
          accessContext: state.accessContext
        });
        const endedAt = new Date().toISOString();
        const inputs = {
          sql: state.sql,
          datasourceId: state.datasourceId,
          sessionId: state.sessionId,
          workspaceId: state.accessContext?.workspaceId
        };
        const outputs = {
          rowCount: execution.rows.length,
          columns: execution.columns
        };
        const trace = appendStep(state, {
          step: {
            node: "execute-sql",
            status: "success",
            detail: `rows=${execution.rows.length}`,
            ...withTiming(startedAt, endedAt),
            inputSummary: summarize(inputs),
            outputSummary: summarize(outputs)
          },
          runType: "tool",
          inputs,
          outputs
        });
        await emitStep(config, latestStep(trace));
        return {
          ...trace,
          rows: execution.rows,
          columns: execution.columns,
          error: undefined
        };
      } catch (error) {
        const endedAt = new Date().toISOString();
        const message = toErrorMessage(error);
        const inputs = {
          sql: state.sql
        };
        const trace = appendStep(state, {
          step: {
            node: "execute-sql",
            status: "failed",
            detail: message,
            ...withTiming(startedAt, endedAt),
            inputSummary: summarize(inputs),
            errorSummary: summarize(message)
          },
          runType: "tool",
          inputs,
          error: message
        });
        await emitStep(config, latestStep(trace));
        return {
          ...trace,
          error: message,
          terminalStatus: "failed"
        };
      }
    })
    .addNode("format-answer", async (state, config) => {
      const startedAt = new Date().toISOString();
      await emitStep(
        config,
        buildRunningStep(state, "format-answer", startedAt, "正在整理回答")
      );
      const answer = deps.formatNode.run(
        state.question,
        state.rows ?? [],
        state.columns ?? []
      );
      const endedAt = new Date().toISOString();
      const trace = appendStep(state, {
        step: {
          node: "format-answer",
          status: "success",
          detail: "结果已格式化。",
          ...withTiming(startedAt, endedAt),
          outputSummary: summarize(answer)
        }
      });
      await emitStep(config, latestStep(trace));
      return {
        ...trace,
        answer,
        terminalStatus: "executionResult"
      };
    })
    .addEdge(START, "clarify")
    .addConditionalEdges(
      "clarify",
      (state) => (state.terminalStatus === "clarification" ? "done" : "continue"),
      {
        done: END,
        continue: "retrieve-knowledge"
      }
    )
    .addEdge("retrieve-knowledge", "build-intent-plan")
    .addEdge("build-intent-plan", "build-semantic-query")
    .addEdge("build-semantic-query", "build-physical-plan")
    .addEdge("build-physical-plan", "generate-sql")
    .addConditionalEdges(
      "generate-sql",
      (state) => (state.fatalError ? "fatal" : "continue"),
      {
        fatal: END,
        continue: "safety-check"
      }
    )
    .addConditionalEdges(
      "safety-check",
      (state) => (state.terminalStatus === "rejected" ? "rejected" : "continue"),
      {
        rejected: END,
        continue: "execute-sql"
      }
    )
    .addConditionalEdges(
      "execute-sql",
      (state) => (state.terminalStatus === "failed" ? "failed" : "continue"),
      {
        failed: END,
        continue: "format-answer"
      }
    )
    .addEdge("format-answer", END)
    .compile();

  return graph;
};

export type LangGraphRuntime = ReturnType<typeof createLangGraphRuntime>;

@Injectable()
export class LangGraphRuntimeService {
  private readonly graph: LangGraphRuntime;

  constructor(
    private readonly clarifyNode: ClarifyNode,
    private readonly retrieveKnowledgeNode: RetrieveKnowledgeNode,
    private readonly buildIntentPlanNode: BuildIntentPlanNode,
    private readonly buildSemanticQueryNode: BuildSemanticQueryNode,
    private readonly buildPhysicalPlanNode: BuildPhysicalPlanNode,
    private readonly generateSqlNode: GenerateSqlNode,
    private readonly safetyNode: SafetyCheckNode,
    private readonly executeNode: ExecuteSqlNode,
    private readonly formatNode: FormatAnswerNode
  ) {
    this.graph = createLangGraphRuntime({
      clarifyNode: this.clarifyNode,
      retrieveKnowledgeNode: this.retrieveKnowledgeNode,
      buildIntentPlanNode: this.buildIntentPlanNode,
      buildSemanticQueryNode: this.buildSemanticQueryNode,
      buildPhysicalPlanNode: this.buildPhysicalPlanNode,
      generateSqlNode: this.generateSqlNode,
      safetyNode: this.safetyNode,
      executeNode: this.executeNode,
      formatNode: this.formatNode
    });
  }

  async invoke(
    input: LangGraphState,
    config?: LangGraphRunnableConfig
  ): Promise<LangGraphState> {
    return this.graph.invoke(input, config);
  }
}
