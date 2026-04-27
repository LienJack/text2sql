import { Injectable } from "@nestjs/common";
import type { ClarificationPrompt, ContextEnvelope } from "@text2sql/shared-types";
import {
  buildFallbackSlotFillingDecision,
  decideSlotFilling,
  type SlotFillingDecision
} from "./slot-filling-context";

export interface ClarificationRoundPolicy {
  round: number;
  maxRounds: number;
}

@Injectable()
export class ClarifyNode {
  evaluate(question: string, contextEnvelope?: ContextEnvelope): SlotFillingDecision {
    const roundPolicy = this.resolveRoundPolicy(contextEnvelope);
    try {
      const decision = decideSlotFilling(question, contextEnvelope);
      if (!decision.shouldClarify) {
        return decision;
      }
      const targetedQuestion = this.toSingleTargetQuestion(decision);
      if (roundPolicy.round >= roundPolicy.maxRounds) {
        return {
          ...decision,
          reason: "澄清轮次已达上限，按 fail-closed 指引终止。",
          question:
            "当前信息仍不足以生成安全 SQL。请直接补充分析对象、指标口径和时间范围后重试。",
          reasonCodes: this.unique([
            ...decision.reasonCodes,
            "clarification_round_limit_reached"
          ])
        };
      }
      return {
        ...decision,
        question: targetedQuestion,
        reasonCodes: this.unique([
          ...decision.reasonCodes,
          `clarification_round:${roundPolicy.round}`,
          `clarification_max_rounds:${roundPolicy.maxRounds}`
        ])
      };
    } catch {
      const fallback = buildFallbackSlotFillingDecision();
      if (roundPolicy.round >= roundPolicy.maxRounds) {
        return {
          ...fallback,
          reason: "澄清轮次已达上限，按 fail-closed 指引终止。",
          question:
            "当前信息仍不足以生成安全 SQL。请直接补充分析对象、指标口径和时间范围后重试。",
          reasonCodes: this.unique([
            ...fallback.reasonCodes,
            "clarification_round_limit_reached"
          ])
        };
      }
      return fallback;
    }
  }

  run(
    question: string,
    contextEnvelope?: ContextEnvelope
  ): ClarificationPrompt | undefined {
    const decision = this.evaluate(question, contextEnvelope);
    return this.toPrompt(decision);
  }

  toPrompt(decision: SlotFillingDecision): ClarificationPrompt | undefined {
    if (!decision.shouldClarify) {
      return undefined;
    }
    return {
      reason: decision.reason,
      question: decision.question,
      decision: decision.decision,
      triggerPath: decision.triggerPath,
      decisionSource: decision.decisionSource,
      bypassed: decision.bypassed,
      ...(decision.bypassReasonCode ? { bypassReasonCode: decision.bypassReasonCode } : {}),
      confidenceLevel: decision.confidenceLevel,
      missingCriticalSlots: decision.missingCriticalSlots,
      ...(decision.reasonCodes.length > 0 ? { reasonCodes: decision.reasonCodes } : {})
    };
  }

  resolveRoundPolicy(contextEnvelope?: ContextEnvelope): ClarificationRoundPolicy {
    const policy: ClarificationRoundPolicy = {
      round: 0,
      maxRounds: 2
    };
    for (const constraint of contextEnvelope?.businessConstraints ?? []) {
      const normalized = constraint.trim().toLowerCase();
      if (!normalized) {
        continue;
      }
      const roundMatch = /^clarification_round\s*[:=]\s*(\d+)$/i.exec(normalized);
      if (roundMatch?.[1]) {
        policy.round = Math.max(0, Number(roundMatch[1]));
      }
      const maxMatch = /^clarification_max_rounds\s*[:=]\s*(\d+)$/i.exec(normalized);
      if (maxMatch?.[1]) {
        policy.maxRounds = Math.max(1, Number(maxMatch[1]));
      }
    }
    return policy;
  }

  private toSingleTargetQuestion(decision: SlotFillingDecision): string {
    const missing = decision.missingCriticalSlots ?? [];
    const targetSlot = missing[0];
    if (!targetSlot) {
      return decision.question;
    }
    if (targetSlot === "subject") {
      return "请先补充分析对象（例如订单、用户、商品或门店）。";
    }
    if (targetSlot === "metric") {
      return "请先补充要统计的指标口径（例如订单数、退款金额、转化率）。";
    }
    if (targetSlot === "time") {
      return "请先补充时间范围（例如近30天、本季度或具体起止日期）。";
    }
    if (targetSlot === "dimension") {
      return "请先补充需要分组的维度（例如地区、渠道、支付方式）。";
    }
    return "请先补充过滤条件（例如状态、地区、金额区间）。";
  }

  private unique(values: string[]): string[] {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  }
}
