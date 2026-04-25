import { Injectable } from "@nestjs/common";
import type {
  ClarificationConfidenceLevel,
  ClarificationDecision,
  ClarificationDecisionEvidence,
  ClarificationSlotKey
} from "@text2sql/shared-types";
import { AppConfigService } from "../../../config/app-config.service";

const METRIC_HINT_REGEX =
  /(总数|数量|计数|count|金额|交易额|销售额|gmv|平均|均值|占比|比例|转化率|留存|退款率|分布|top|排行|环比|同比)/i;
const COUNT_METRIC_HINT_REGEX = /(有多少|多少|几(个|笔|单|条|次|家|人|位))/i;
const SUBJECT_HINT_REGEX =
  /(订单|用户|客户|顾客|消费者|商品|sku|门店|支付|退款|交易|会话|工单|发票|供应商|渠道|地区|市场|销售|商家|账单)/i;
const TIME_HINT_REGEX =
  /(今天|昨日|昨天|本周|上周|本月|上月|本季度|上季度|本年|去年|近\d+\s*(天|周|月|年)|最近|过去|between|from|to|日期|时间)/i;
const TREND_HINT_REGEX = /(趋势|变化|对比|同比|环比|走势)/i;
const AMBIGUOUS_REFERENCE_REGEX = /(这个|那个|它|他们|这项|该指标|这个指标)/i;

class SemanticEvaluatorTimeoutError extends Error {
  constructor() {
    super("semantic evaluator timed out");
  }
}

export type ClarificationSemanticEvaluationStatus =
  | "success"
  | "timeout"
  | "error"
  | "invalid";

export interface ClarificationSemanticEvaluationInput {
  question: string;
  ruleDecision: ClarificationDecisionEvidence;
}

export interface ClarificationSemanticEvaluationMetadata {
  timeoutMs: number;
  elapsedMs: number;
  fallbackApplied: boolean;
  fallbackReason?: "timeout" | "error" | "invalid_payload";
  errorMessage?: string;
}

export interface ClarificationSemanticEvaluationResult {
  status: ClarificationSemanticEvaluationStatus;
  decision?: ClarificationDecisionEvidence;
  reasonCodes: string[];
  metadata: ClarificationSemanticEvaluationMetadata;
}

interface SemanticArbitrationPayload {
  decision: ClarificationDecision;
  confidenceLevel: ClarificationConfidenceLevel;
  missingCriticalSlots: ClarificationSlotKey[];
  reasonCodes: string[];
  reason: string;
  question: string;
}

@Injectable()
export class ClarificationSemanticEvaluatorService {
  constructor(private readonly appConfig: AppConfigService) {}

  async evaluate(
    input: ClarificationSemanticEvaluationInput
  ): Promise<ClarificationSemanticEvaluationResult> {
    const timeoutMs = this.appConfig.clarificationSemanticTimeoutMs;
    const startedAt = Date.now();

    try {
      const payload = await this.withTimeout(
        this.runSemanticArbitration(input),
        timeoutMs
      );
      const elapsedMs = this.resolveElapsedMs(startedAt);
      const normalized = this.normalizePayload(payload, input.ruleDecision);
      if (!normalized) {
        return {
          status: "invalid",
          reasonCodes: ["semantic_invalid_payload"],
          metadata: {
            timeoutMs,
            elapsedMs,
            fallbackApplied: true,
            fallbackReason: "invalid_payload"
          }
        };
      }

      return {
        status: "success",
        decision: normalized,
        reasonCodes: normalized.reasonCodes ?? [],
        metadata: {
          timeoutMs,
          elapsedMs,
          fallbackApplied: false
        }
      };
    } catch (error) {
      const elapsedMs = this.resolveElapsedMs(startedAt);
      if (error instanceof SemanticEvaluatorTimeoutError) {
        return {
          status: "timeout",
          reasonCodes: ["semantic_timeout"],
          metadata: {
            timeoutMs,
            elapsedMs,
            fallbackApplied: true,
            fallbackReason: "timeout"
          }
        };
      }
      return {
        status: "error",
        reasonCodes: ["semantic_error"],
        metadata: {
          timeoutMs,
          elapsedMs,
          fallbackApplied: true,
          fallbackReason: "error",
          errorMessage: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  protected async runSemanticArbitration(
    input: ClarificationSemanticEvaluationInput
  ): Promise<SemanticArbitrationPayload> {
    const normalizedQuestion = input.question.trim();
    const normalized = normalizedQuestion.toLowerCase();

    const missingCriticalSlots = this.collectMissingCriticalSlots(normalized);
    const decision: ClarificationDecision =
      missingCriticalSlots.length > 0 ? "clarify" : "continue";

    const ambiguousReference = AMBIGUOUS_REFERENCE_REGEX.test(normalized);
    const confidenceLevel = this.resolveConfidenceLevel(
      decision,
      missingCriticalSlots,
      ambiguousReference
    );
    const reasonCodes = this.resolveReasonCodes({
      decision,
      missingCriticalSlots,
      ambiguousReference
    });

    return {
      decision,
      confidenceLevel,
      missingCriticalSlots,
      reasonCodes,
      reason:
        decision === "clarify"
          ? this.buildClarificationReason(missingCriticalSlots)
          : "语义评估通过，关键槽位完整。",
      question:
        decision === "clarify"
          ? this.buildClarificationQuestion(missingCriticalSlots)
          : ""
    };
  }

  private normalizePayload(
    payload: SemanticArbitrationPayload,
    ruleDecision: ClarificationDecisionEvidence
  ): ClarificationDecisionEvidence | undefined {
    if (payload.decision !== "continue" && payload.decision !== "clarify") {
      return undefined;
    }

    const confidenceLevel =
      payload.confidenceLevel === "high" ||
      payload.confidenceLevel === "medium" ||
      payload.confidenceLevel === "low"
        ? payload.confidenceLevel
        : "medium";

    const missingCriticalSlots = Array.isArray(payload.missingCriticalSlots)
      ? payload.missingCriticalSlots.filter((slot): slot is ClarificationSlotKey => {
          return typeof slot === "string" && slot.trim().length > 0;
        })
      : [];

    const reasonCodes = this.unique([
      "semantic_classifier_v1",
      ...(Array.isArray(payload.reasonCodes)
        ? payload.reasonCodes.filter(
            (item): item is string => typeof item === "string" && item.trim().length > 0
          )
        : [])
    ]);

    return {
      decision: payload.decision,
      triggerPath: "semantic",
      confidenceLevel,
      missingCriticalSlots,
      conflictDetected:
        ruleDecision.decision !== undefined && ruleDecision.decision !== payload.decision,
      reasonCodes,
      question: payload.question,
      reason: payload.reason
    };
  }

  private collectMissingCriticalSlots(question: string): ClarificationSlotKey[] {
    const missing = new Set<ClarificationSlotKey>();
    const subjectDetected = SUBJECT_HINT_REGEX.test(question);
    const metricDetected =
      METRIC_HINT_REGEX.test(question) || COUNT_METRIC_HINT_REGEX.test(question);

    if (!subjectDetected) {
      missing.add("subject");
    }
    if (!metricDetected) {
      missing.add("metric");
    }
    if (TREND_HINT_REGEX.test(question) && !TIME_HINT_REGEX.test(question)) {
      missing.add("time");
    }

    return [...missing];
  }

  private resolveConfidenceLevel(
    decision: ClarificationDecision,
    missingCriticalSlots: ClarificationSlotKey[],
    ambiguousReference: boolean
  ): ClarificationConfidenceLevel {
    if (decision === "clarify") {
      return missingCriticalSlots.length > 1 ? "low" : "medium";
    }
    return ambiguousReference ? "medium" : "high";
  }

  private resolveReasonCodes(input: {
    decision: ClarificationDecision;
    missingCriticalSlots: ClarificationSlotKey[];
    ambiguousReference: boolean;
  }): string[] {
    const reasonCodes: string[] = [];
    if (input.decision === "clarify") {
      reasonCodes.push("semantic_needs_clarification");
      if (input.missingCriticalSlots.includes("subject")) {
        reasonCodes.push("semantic_missing_subject");
      }
      if (input.missingCriticalSlots.includes("metric")) {
        reasonCodes.push("semantic_missing_metric");
      }
      if (input.missingCriticalSlots.includes("time")) {
        reasonCodes.push("semantic_missing_time");
      }
    } else {
      reasonCodes.push("semantic_ready_to_continue");
    }
    if (input.ambiguousReference) {
      reasonCodes.push("semantic_ambiguous_reference");
    }
    return this.unique(reasonCodes);
  }

  private buildClarificationReason(missingCriticalSlots: ClarificationSlotKey[]): string {
    const labels: Record<string, string> = {
      subject: "分析对象",
      metric: "指标口径",
      time: "时间范围"
    };
    const missingLabels = missingCriticalSlots
      .map((slot) => labels[slot])
      .filter((label): label is string => Boolean(label));
    if (missingLabels.length === 0) {
      return "语义评估建议补充关键信息。";
    }
    return `语义评估发现关键槽位不足：${missingLabels.join("、")}。`;
  }

  private buildClarificationQuestion(missingCriticalSlots: ClarificationSlotKey[]): string {
    const missingSet = new Set(missingCriticalSlots);
    if (missingSet.has("subject") && missingSet.has("metric")) {
      return "请补充分析对象和指标口径，例如“近30天订单总数”或“按渠道统计退款金额”。";
    }
    if (missingSet.has("subject")) {
      return "请补充分析对象（例如订单、用户、商品或门店）。";
    }
    if (missingSet.has("metric")) {
      return "请补充要统计的指标口径（例如订单数、GMV、退款金额）。";
    }
    if (missingSet.has("time")) {
      return "请补充时间范围（例如近30天、本季度或具体起止日期）。";
    }
    return "请补充关键分析信息后继续。";
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new SemanticEvaluatorTimeoutError()), timeoutMs);
      promise
        .then((value) => {
          clearTimeout(timeout);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  private resolveElapsedMs(startedAt: number): number {
    return Math.max(0, Date.now() - startedAt);
  }

  private unique(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  }
}
