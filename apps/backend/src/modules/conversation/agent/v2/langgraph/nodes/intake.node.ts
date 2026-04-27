import { Injectable } from "@nestjs/common";
import type {
  ClarificationPrompt,
  ContextEnvelope,
  Text2SqlV2FailureSemantic
} from "@text2sql/shared-types";
import type { SqlSemanticIntent } from "../../../sql/sql-prompt.builder";
import { ClarifyNode } from "../../../nodes/clarify.node";

export type IntakeRouteKind =
  | "needs_clarification"
  | "general"
  | "metadata"
  | "text_to_sql"
  | "unsafe"
  | "unsupported";

export interface IntakeRouteArtifact {
  originalQuestion: string;
  normalizedQuestion: string;
  standaloneQuestion: string;
  route: IntakeRouteKind;
  reasonCodes: string[];
  confidence: number;
  evidenceRefs: string[];
  semanticIntent?: SqlSemanticIntent;
  clarification?: ClarificationPrompt;
  directAnswer?: string;
  failure?: Text2SqlV2FailureSemantic;
}

const GENERAL_INTENT_REGEX =
  /^(你好|您好|hi|hello|thanks|谢谢|help|帮助|你是谁|你能做什么)(?:$|\s|[，。,.!?])|(?:什么是|解释|说明).{0,24}(?:口径|定义|含义)|(?:口径|定义|含义)(?:是什么|说明|解释)/i;
const METADATA_INTENT_REGEX =
  /(有哪些表|哪些表|schema|表结构|字段|列名|show\s+tables|describe|sqlite_master|sqlite_schema|information_schema|pg_catalog|pragma|元数据|数据库结构)/i;
const UNSAFE_WRITE_REGEX =
  /^\s*(insert|update|delete|drop|alter|truncate|create|replace|merge|grant|revoke)\b|\b(删除数据|修改数据|更新数据|写入数据|创建表|删表)\b/i;
const UNSUPPORTED_TASK_REGEX =
  /(发邮件|发送邮件|send\s+email|生成\s*ppt|powerpoint|做幻灯片|导出\s*ppt)/i;
const FOLLOW_UP_PREFIX_REGEX = /^(那|那么|这个|这些|它们|those|them|that)/i;
const COUNT_INTENT_REGEX =
  /(多少|几条|几笔|总数|数量|计数|count|人数|单量|订单量|客户数|用户数)/i;

@Injectable()
export class IntakeNode {
  constructor(private readonly clarifyNode: ClarifyNode) {}

  run(input: {
    question: string;
    contextEnvelope?: ContextEnvelope;
  }): IntakeRouteArtifact {
    const originalQuestion = input.question;
    const normalizedQuestion = this.normalizeQuestion(input.question);
    const standaloneQuestion = this.buildStandaloneQuestion(
      normalizedQuestion,
      input.contextEnvelope
    );
    const evidenceRefs = this.buildEvidenceRefs(input.contextEnvelope);

    if (!normalizedQuestion) {
      return this.buildRejectedArtifact({
        originalQuestion,
        normalizedQuestion,
        standaloneQuestion,
        route: "unsupported",
        reasonCodes: ["empty_question"],
        evidenceRefs,
        message: "问题为空，当前无法建立安全的 Text2SQL 路径。"
      });
    }

    if (UNSUPPORTED_TASK_REGEX.test(normalizedQuestion)) {
      return this.buildRejectedArtifact({
        originalQuestion,
        normalizedQuestion,
        standaloneQuestion,
        route: "unsupported",
        reasonCodes: ["unsupported_non_sql_task"],
        evidenceRefs,
        message: "当前请求不属于 Text2SQL/元数据解释范围，已拒绝执行。"
      });
    }

    if (UNSAFE_WRITE_REGEX.test(normalizedQuestion)) {
      return this.buildRejectedArtifact({
        originalQuestion,
        normalizedQuestion,
        standaloneQuestion,
        route: "unsafe",
        reasonCodes: ["unsafe_write_intent"],
        evidenceRefs,
        message: "检测到写操作或破坏性请求，系统已按 fail-closed 拒绝。"
      });
    }

    if (METADATA_INTENT_REGEX.test(normalizedQuestion)) {
      return {
        originalQuestion,
        normalizedQuestion,
        standaloneQuestion,
        route: "metadata",
        reasonCodes: ["metadata_intent_detected"],
        confidence: 0.95,
        evidenceRefs,
        semanticIntent: "metadata",
        directAnswer:
          "这是元数据问题，我会基于可访问的表结构与语义证据直接说明，不执行 SQL。"
      };
    }

    if (GENERAL_INTENT_REGEX.test(normalizedQuestion)) {
      return {
        originalQuestion,
        normalizedQuestion,
        standaloneQuestion,
        route: "general",
        reasonCodes: ["general_intent_detected"],
        confidence: 0.84,
        evidenceRefs,
        semanticIntent: "general",
        directAnswer: "这是通用说明问题，不需要执行 SQL；我会基于已有语义证据直接解释。"
      };
    }

    const clarificationDecision = this.clarifyNode.evaluate(
      normalizedQuestion,
      input.contextEnvelope
    );
    if (
      clarificationDecision.decisionSource === "sql-write-intent" ||
      clarificationDecision.reasonCodes.includes("bypass_sql_write_intent")
    ) {
      return this.buildRejectedArtifact({
        originalQuestion,
        normalizedQuestion,
        standaloneQuestion,
        route: "unsafe",
        reasonCodes: this.unique([
          ...clarificationDecision.reasonCodes,
          "unsafe_write_intent"
        ]),
        evidenceRefs,
        message: "检测到写操作或破坏性请求，系统已按 fail-closed 拒绝。"
      });
    }

    if (clarificationDecision.reasonCodes.includes("clarification_round_limit_reached")) {
      return this.buildRejectedArtifact({
        originalQuestion,
        normalizedQuestion,
        standaloneQuestion,
        route: "unsupported",
        reasonCodes: clarificationDecision.reasonCodes,
        evidenceRefs,
        message: clarificationDecision.reason
      });
    }

    if (clarificationDecision.shouldClarify) {
      return {
        originalQuestion,
        normalizedQuestion,
        standaloneQuestion,
        route: "needs_clarification",
        reasonCodes: clarificationDecision.reasonCodes,
        confidence: this.confidenceFromDecision(clarificationDecision.confidenceLevel),
        evidenceRefs,
        semanticIntent: this.resolveSemanticIntent(normalizedQuestion),
        clarification: this.clarifyNode.toPrompt(clarificationDecision)
      };
    }

    return {
      originalQuestion,
      normalizedQuestion,
      standaloneQuestion,
      route: "text_to_sql",
      reasonCodes: this.unique([
        ...clarificationDecision.reasonCodes,
        "intake_ready_for_text_to_sql"
      ]),
      confidence: this.confidenceFromDecision(clarificationDecision.confidenceLevel),
      evidenceRefs,
      semanticIntent: this.resolveSemanticIntent(normalizedQuestion)
    };
  }

  private buildRejectedArtifact(input: {
    originalQuestion: string;
    normalizedQuestion: string;
    standaloneQuestion: string;
    route: "unsafe" | "unsupported";
    reasonCodes: string[];
    evidenceRefs: string[];
    message: string;
  }): IntakeRouteArtifact {
    return {
      originalQuestion: input.originalQuestion,
      normalizedQuestion: input.normalizedQuestion,
      standaloneQuestion: input.standaloneQuestion,
      route: input.route,
      reasonCodes: input.reasonCodes,
      confidence: 0.98,
      evidenceRefs: input.evidenceRefs,
      semanticIntent: "general",
      failure: {
        code:
          input.route === "unsafe"
            ? "INTAKE_UNSAFE_REQUEST"
            : "INTAKE_UNSUPPORTED_REQUEST",
        message: input.message,
        category: "intake",
        terminal: true,
        correctable: false
      }
    };
  }

  private normalizeQuestion(question: string): string {
    return question.trim().replace(/\s+/g, " ");
  }

  private buildStandaloneQuestion(
    normalizedQuestion: string,
    contextEnvelope?: ContextEnvelope
  ): string {
    if (!FOLLOW_UP_PREFIX_REGEX.test(normalizedQuestion)) {
      return normalizedQuestion;
    }
    const hints: string[] = [];
    if (contextEnvelope?.metricDefinition?.trim()) {
      hints.push(`metric=${contextEnvelope.metricDefinition.trim()}`);
    }
    if ((contextEnvelope?.pinnedTables ?? []).length > 0) {
      hints.push(`tables=${contextEnvelope?.pinnedTables?.slice(0, 3).join(", ")}`);
    } else if ((contextEnvelope?.mustIncludeTables ?? []).length > 0) {
      hints.push(
        `tables=${contextEnvelope?.mustIncludeTables?.slice(0, 3).join(", ")}`
      );
    }
    if (contextEnvelope?.timeRange?.from || contextEnvelope?.timeRange?.to) {
      hints.push(
        `time=${contextEnvelope.timeRange.from ?? "?"}..${contextEnvelope.timeRange.to ?? "?"}`
      );
    }
    if (hints.length === 0) {
      return normalizedQuestion;
    }
    return `${normalizedQuestion} (context: ${hints.join("; ")})`;
  }

  private buildEvidenceRefs(contextEnvelope?: ContextEnvelope): string[] {
    const evidenceRefs: string[] = [];
    if (contextEnvelope?.metricDefinition?.trim()) {
      evidenceRefs.push("context:metric_definition");
    }
    if ((contextEnvelope?.pinnedTables ?? []).length > 0) {
      evidenceRefs.push("context:pinned_tables");
    }
    if ((contextEnvelope?.pinnedColumns ?? []).length > 0) {
      evidenceRefs.push("context:pinned_columns");
    }
    if ((contextEnvelope?.mustIncludeTables ?? []).length > 0) {
      evidenceRefs.push("context:must_include_tables");
    }
    if ((contextEnvelope?.mustExcludeTables ?? []).length > 0) {
      evidenceRefs.push("context:must_exclude_tables");
    }
    if (contextEnvelope?.timeRange?.from || contextEnvelope?.timeRange?.to) {
      evidenceRefs.push("context:time_range");
    }
    if ((contextEnvelope?.businessConstraints ?? []).length > 0) {
      evidenceRefs.push("context:business_constraints");
    }
    return evidenceRefs;
  }

  private resolveSemanticIntent(question: string): SqlSemanticIntent {
    if (METADATA_INTENT_REGEX.test(question)) {
      return "metadata";
    }
    if (COUNT_INTENT_REGEX.test(question)) {
      return "count";
    }
    return "general";
  }

  private confidenceFromDecision(value?: string): number {
    if (value === "high") {
      return 0.92;
    }
    if (value === "medium") {
      return 0.72;
    }
    return 0.42;
  }

  private unique(values: string[]): string[] {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  }
}
