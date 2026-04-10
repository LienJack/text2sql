import { Injectable } from "@nestjs/common";
import type { ExecutionTraceStep, SqlRun } from "@text2sql/shared-types";
import { ClarifyNode } from "../nodes/clarify.node";
import { GenerateSqlNode } from "../nodes/generate-sql.node";
import { SafetyCheckNode } from "../nodes/safety-check.node";
import { ExecuteSqlNode } from "../nodes/execute-sql.node";
import { FormatAnswerNode } from "../nodes/format-answer.node";
import type { GraphInput, GraphState } from "./agent.types";

@Injectable()
export class GraphBuilderService {
  constructor(
    private readonly clarifyNode: ClarifyNode,
    private readonly generateSqlNode: GenerateSqlNode,
    private readonly safetyNode: SafetyCheckNode,
    private readonly executeNode: ExecuteSqlNode,
    private readonly formatNode: FormatAnswerNode
  ) {}

  async run(input: GraphInput): Promise<SqlRun> {
    const now = new Date().toISOString();
    const state: GraphState = {
      ...input,
      provider: "volcengine",
      trace: {
        runId: input.runId,
        provider: "volcengine",
        retryCount: 0,
        steps: []
      }
    };

    const addStep = (step: ExecutionTraceStep): void => {
      state.trace.steps.push(step);
    };

    const clarification = this.clarifyNode.run(input.question);
    if (clarification) {
      addStep({
        node: "clarify",
        status: "success",
        detail: clarification.reason,
        at: now
      });
      state.clarification = clarification;
      state.answer = clarification.question;
      return this.toRun(state, "clarification");
    }
    addStep({
      node: "clarify",
      status: "skipped",
      detail: "问题信息充足，跳过澄清。",
      at: now
    });

    const generated = await this.generateSqlNode.run(input.question);
    state.provider = generated.provider;
    state.trace.provider = generated.provider;
    state.sql = generated.sql;
    state.explanation = generated.explanation;
    addStep({
      node: "generate-sql",
      status: "success",
      detail: generated.provider,
      at: new Date().toISOString()
    });

    const safety = this.safetyNode.run(generated.sql);
    if (!safety.safe) {
      state.error = safety.reason;
      addStep({
        node: "safety-check",
        status: "failed",
        detail: safety.reason,
        at: new Date().toISOString()
      });
      return this.toRun(state, "rejected");
    }
    addStep({
      node: "safety-check",
      status: "success",
      detail: "SQL 通过只读校验。",
      at: new Date().toISOString()
    });

    try {
      const execution = await this.executeNode.run(generated.sql);
      state.rows = execution.rows;
      state.columns = execution.columns;
      addStep({
        node: "execute-sql",
        status: "success",
        detail: `rows=${execution.rows.length}`,
        at: new Date().toISOString()
      });
      state.answer = this.formatNode.run(
        input.question,
        execution.rows,
        execution.columns
      );
      addStep({
        node: "format-answer",
        status: "success",
        detail: "结果已格式化。",
        at: new Date().toISOString()
      });
      return this.toRun(state, "executionResult");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.error = message;
      addStep({
        node: "execute-sql",
        status: "failed",
        detail: message,
        at: new Date().toISOString()
      });
      return this.toRun(state, "failed");
    }
  }

  private toRun(state: GraphState, status: SqlRun["status"]): SqlRun {
    return {
      runId: state.runId,
      sessionId: state.sessionId,
      question: state.question,
      status,
      provider: state.provider,
      sql: state.sql,
      explanation: state.explanation,
      answer: state.answer,
      rows: state.rows,
      columns: state.columns,
      error: state.error,
      clarification: state.clarification,
      trace: state.trace,
      createdAt: new Date().toISOString()
    };
  }
}

