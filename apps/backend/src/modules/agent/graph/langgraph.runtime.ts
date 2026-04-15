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
import { ClarifyNode } from "../nodes/clarify.node";
import { ExecuteSqlNode } from "../nodes/execute-sql.node";
import { FormatAnswerNode } from "../nodes/format-answer.node";
import { GenerateSqlNode } from "../nodes/generate-sql.node";
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
  traceContext: Annotation<LangGraphState["traceContext"]>(),
  provider: Annotation<string>(),
  model: Annotation<string | undefined>(),
  llmRaw: Annotation<LangGraphState["llmRaw"]>(),
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

export interface LangGraphNodeDependencies {
  clarifyNode: Pick<ClarifyNode, "run">;
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
                onEvent: callbacks.onLlmEvent
              }
            : undefined
        );
        const endedAt = new Date().toISOString();
        const inputs = {
          question: state.question,
          datasourceType: state.datasourceType,
          modelCatalogId: state.modelCatalogId,
          systemPrompt: generated.prompt.systemPrompt,
          userPrompt: generated.prompt.userPrompt
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
        accessContext: state.accessContext
      });
      const endedAt = new Date().toISOString();
      const inputs = {
        sql: state.sql,
        datasourceId: state.datasourceId,
        workspaceId: state.accessContext?.workspaceId
      };
      if (!safety.safe) {
        const trace = appendStep(state, {
          step: {
            node: "safety-check",
            status: "failed",
            detail: safety.reason,
            ...withTiming(startedAt, endedAt),
            inputSummary: summarize(inputs),
            errorSummary: summarize(safety.reason)
          },
          runType: "tool",
          inputs,
          error: safety.reason
        });
        await emitStep(config, latestStep(trace));
        return {
          ...trace,
          error: safety.reason,
          terminalStatus: "rejected"
        };
      }

      const trace = appendStep(state, {
        step: {
          node: "safety-check",
          status: "success",
          detail: "SQL 通过只读校验。",
          ...withTiming(startedAt, endedAt),
          inputSummary: summarize(inputs)
        }
      });
      await emitStep(config, latestStep(trace));
      return trace;
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
        continue: "generate-sql"
      }
    )
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
    private readonly generateSqlNode: GenerateSqlNode,
    private readonly safetyNode: SafetyCheckNode,
    private readonly executeNode: ExecuteSqlNode,
    private readonly formatNode: FormatAnswerNode
  ) {
    this.graph = createLangGraphRuntime({
      clarifyNode: this.clarifyNode,
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
