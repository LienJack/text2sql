import { Injectable } from "@nestjs/common";
import {
  Annotation,
  END,
  START,
  StateGraph,
  type LangGraphRunnableConfig
} from "@langchain/langgraph";
import { ClarifyNode } from "../nodes/clarify.node";
import { ExecuteSqlNode } from "../nodes/execute-sql.node";
import { FormatAnswerNode } from "../nodes/format-answer.node";
import { GenerateSqlNode } from "../nodes/generate-sql.node";
import { SafetyCheckNode } from "../nodes/safety-check.node";
import { appendStep, type LangGraphState } from "./langgraph.state";

const LangGraphStateAnnotation = Annotation.Root({
  runId: Annotation<string>(),
  sessionId: Annotation<string>(),
  question: Annotation<string>(),
  traceContext: Annotation<LangGraphState["traceContext"]>(),
  provider: Annotation<string>(),
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

export interface LangGraphNodeDependencies {
  clarifyNode: Pick<ClarifyNode, "run">;
  generateSqlNode: Pick<GenerateSqlNode, "run">;
  safetyNode: Pick<SafetyCheckNode, "run">;
  executeNode: Pick<ExecuteSqlNode, "run">;
  formatNode: Pick<FormatAnswerNode, "run">;
}

export const createLangGraphRuntime = (deps: LangGraphNodeDependencies) => {
  const graph = new StateGraph(LangGraphStateAnnotation)
    .addNode("clarify", (state) => {
      const clarification = deps.clarifyNode.run(state.question);
      if (clarification) {
        const trace = appendStep(state, {
          step: {
            node: "clarify",
            status: "success",
            detail: clarification.reason,
            at: new Date().toISOString()
          },
          runType: "tool",
          outputs: {
            clarificationQuestion: clarification.question
          }
        });
        return {
          ...trace,
          clarification,
          answer: clarification.question,
          terminalStatus: "clarification"
        };
      }
      return appendStep(state, {
        step: {
          node: "clarify",
          status: "skipped",
          detail: "问题信息充足，跳过澄清。",
          at: new Date().toISOString()
        }
      });
    })
    .addNode("generate-sql", async (state) => {
      try {
        const generated = await deps.generateSqlNode.run(state.question);
        const trace = appendStep(state, {
          step: {
            node: "generate-sql",
            status: "success",
            detail: generated.provider,
            at: new Date().toISOString()
          },
          runType: "llm",
          inputs: {
            question: state.question,
            systemPrompt: generated.prompt.systemPrompt,
            userPrompt: generated.prompt.userPrompt
          },
          outputs: {
            provider: generated.provider,
            sql: generated.sql,
            rawText: generated.rawText
          }
        });
        return {
          ...trace,
          trace: {
            ...trace.trace,
            provider: generated.provider
          },
          provider: generated.provider,
          sql: generated.sql,
          explanation: generated.explanation,
          error: undefined,
          fatalError: undefined
        };
      } catch (error) {
        const message = toErrorMessage(error);
        const trace = appendStep(state, {
          step: {
            node: "generate-sql",
            status: "failed",
            detail: message,
            at: new Date().toISOString()
          },
          runType: "llm",
          inputs: {
            question: state.question
          },
          error: message
        });
        return {
          ...trace,
          error: message,
          terminalStatus: "failed",
          fatalError: error
        };
      }
    })
    .addNode("safety-check", (state) => {
      if (!state.sql) {
        const reason = "未生成 SQL，无法执行安全校验。";
        const trace = appendStep(state, {
          step: {
            node: "safety-check",
            status: "failed",
            detail: reason,
            at: new Date().toISOString()
          },
          runType: "tool",
          error: reason
        });
        return {
          ...trace,
          error: reason,
          terminalStatus: "failed"
        };
      }

      const safety = deps.safetyNode.run(state.sql);
      if (!safety.safe) {
        const trace = appendStep(state, {
          step: {
            node: "safety-check",
            status: "failed",
            detail: safety.reason,
            at: new Date().toISOString()
          },
          runType: "tool",
          inputs: {
            sql: state.sql
          },
          error: safety.reason
        });
        return {
          ...trace,
          error: safety.reason,
          terminalStatus: "rejected"
        };
      }

      return appendStep(state, {
        step: {
          node: "safety-check",
          status: "success",
          detail: "SQL 通过只读校验。",
          at: new Date().toISOString()
        }
      });
    })
    .addNode("execute-sql", async (state) => {
      if (!state.sql) {
        const reason = "未生成 SQL，无法执行查询。";
        const trace = appendStep(state, {
          step: {
            node: "execute-sql",
            status: "failed",
            detail: reason,
            at: new Date().toISOString()
          },
          runType: "tool",
          error: reason
        });
        return {
          ...trace,
          error: reason,
          terminalStatus: "failed"
        };
      }
      try {
        const execution = await deps.executeNode.run(state.sql);
        const trace = appendStep(state, {
          step: {
            node: "execute-sql",
            status: "success",
            detail: `rows=${execution.rows.length}`,
            at: new Date().toISOString()
          },
          runType: "tool",
          inputs: {
            sql: state.sql
          },
          outputs: {
            rowCount: execution.rows.length,
            columns: execution.columns
          }
        });
        return {
          ...trace,
          rows: execution.rows,
          columns: execution.columns,
          error: undefined
        };
      } catch (error) {
        const message = toErrorMessage(error);
        const trace = appendStep(state, {
          step: {
            node: "execute-sql",
            status: "failed",
            detail: message,
            at: new Date().toISOString()
          },
          runType: "tool",
          inputs: {
            sql: state.sql
          },
          error: message
        });
        return {
          ...trace,
          error: message,
          terminalStatus: "failed"
        };
      }
    })
    .addNode("format-answer", (state) => {
      const answer = deps.formatNode.run(
        state.question,
        state.rows ?? [],
        state.columns ?? []
      );
      const trace = appendStep(state, {
        step: {
          node: "format-answer",
          status: "success",
          detail: "结果已格式化。",
          at: new Date().toISOString()
        }
      });
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
