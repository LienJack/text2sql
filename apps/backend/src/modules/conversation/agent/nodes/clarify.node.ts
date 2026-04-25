import { Injectable } from "@nestjs/common";
import type { ClarificationPrompt, ContextEnvelope } from "@text2sql/shared-types";
import {
  buildFallbackSlotFillingDecision,
  decideSlotFilling,
  type SlotFillingDecision
} from "./slot-filling-context";

@Injectable()
export class ClarifyNode {
  evaluate(question: string, contextEnvelope?: ContextEnvelope): SlotFillingDecision {
    try {
      return decideSlotFilling(question, contextEnvelope);
    } catch {
      return buildFallbackSlotFillingDecision();
    }
  }

  run(
    question: string,
    contextEnvelope?: ContextEnvelope
  ): ClarificationPrompt | undefined {
    const decision = this.evaluate(question, contextEnvelope);
    if (!decision.shouldClarify) {
      return undefined;
    }
    return {
      reason: decision.reason,
      question: decision.question
    };
  }
}
