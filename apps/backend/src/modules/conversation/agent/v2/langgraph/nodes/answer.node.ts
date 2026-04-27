import { Injectable } from "@nestjs/common";
import type {
  ClarificationPrompt,
  SemanticPlanV1,
  Text2SqlV2FailureSemantic
} from "@text2sql/shared-types";
import { FormatAnswerNode } from "../../../nodes/format-answer.node";
import type { StructuredSqlGenerationArtifact } from "../../../sql/sql-generation.service";
import type { ExecuteSqlNodeResult } from "./execute-sql.node";

export interface AnswerNodeResult {
  mode:
    | "execution_result"
    | "direct_answer"
    | "clarification"
    | "fail_closed"
    | "execution_failure";
  answer: string;
  status: "executionResult" | "clarification" | "rejected" | "failed";
  evidenceRefs: string[];
  warnings: string[];
  failure?: Text2SqlV2FailureSemantic;
}

@Injectable()
export class AnswerNode {
  constructor(private readonly formatAnswerNode: FormatAnswerNode) {}

  run(input: {
    question: string;
    directAnswer?: string;
    clarification?: ClarificationPrompt;
    executionResult?: ExecuteSqlNodeResult;
    sqlArtifact?: StructuredSqlGenerationArtifact;
    semanticPlan?: SemanticPlanV1;
    failure?: Text2SqlV2FailureSemantic;
    warnings?: string[];
  }): AnswerNodeResult {
    const evidenceRefs = this.unique([
      ...(input.sqlArtifact?.evidenceRefs ?? []),
      ...(input.semanticPlan?.evidenceRefs ?? [])
    ]);
    const warnings = this.unique(input.warnings ?? []);

    if (input.clarification) {
      return {
        mode: "clarification",
        answer: input.clarification.question,
        status: "clarification",
        evidenceRefs,
        warnings: this.unique([
          ...warnings,
          input.clarification.reason,
          ...(input.clarification.reasonCodes ?? [])
        ]),
        failure: input.failure
      };
    }

    if (input.directAnswer?.trim()) {
      return {
        mode: "direct_answer",
        answer: this.formatAnswerNode.runDirectAnswer(input.directAnswer, warnings),
        status: "executionResult",
        evidenceRefs,
        warnings,
        failure: input.failure
      };
    }

    if (input.failure?.terminal) {
      return {
        mode: "fail_closed",
        answer: this.formatAnswerNode.runFailClosed(input.failure.message),
        status:
          input.failure.category === "execution" ? "failed" : "rejected",
        evidenceRefs,
        warnings,
        failure: input.failure
      };
    }

    if (!input.executionResult) {
      return {
        mode: "execution_failure",
        answer: this.formatAnswerNode.runFailClosed(
          "缺少执行结果，无法生成最终回答。"
        ),
        status: "failed",
        evidenceRefs,
        warnings,
        failure: input.failure
      };
    }

    return {
      mode: "execution_result",
      answer: this.formatAnswerNode.run(
        input.question,
        input.executionResult.rows,
        input.executionResult.columns
      ),
      status: "executionResult",
      evidenceRefs,
      warnings
    };
  }

  private unique(values: string[]): string[] {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  }
}
