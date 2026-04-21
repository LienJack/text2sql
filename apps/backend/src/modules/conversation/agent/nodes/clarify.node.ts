import { Injectable } from "@nestjs/common";
import type { ClarificationPrompt, ContextEnvelope } from "@text2sql/shared-types";
import { decideSlotFilling } from "./slot-filling-context";

@Injectable()
export class ClarifyNode {
  run(
    question: string,
    contextEnvelope?: ContextEnvelope
  ): ClarificationPrompt | undefined {
    try {
      const decision = decideSlotFilling(question, contextEnvelope);
      if (!decision.shouldClarify) {
        return undefined;
      }
      return {
        reason: decision.reason,
        question: decision.question
      };
    } catch {
      return {
        reason: "槽位解析异常",
        question: "请补充分析对象、指标口径和时间范围后重试。"
      };
    }
  }
}
