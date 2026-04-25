import type { AppConfigService } from "../../src/modules/config/app-config.service";
import {
  ClarificationSemanticEvaluatorService
} from "../../src/modules/conversation/agent/nodes/clarification-semantic-evaluator.service";

describe("ClarificationSemanticEvaluatorService", () => {
  const createService = (timeoutMs = 20) => {
    const config = {
      clarificationSemanticTimeoutMs: timeoutMs
    } as Pick<AppConfigService, "clarificationSemanticTimeoutMs">;
    return new ClarificationSemanticEvaluatorService(config as AppConfigService);
  };

  it("returns semantic clarify decision for missing slots", async () => {
    const service = createService();
    const result = await service.evaluate({
      question: "帮我看下订单",
      ruleDecision: {
        decision: "clarify",
        triggerPath: "rule",
        confidenceLevel: "low",
        missingCriticalSlots: ["metric"],
        reasonCodes: ["missing_metric_slot"]
      }
    });

    expect(result.status).toBe("success");
    expect(result.decision).toMatchObject({
      decision: "clarify",
      triggerPath: "semantic"
    });
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining(["semantic_classifier_v1", "semantic_needs_clarification"])
    );
    expect(result.metadata.fallbackApplied).toBe(false);
  });

  it("falls back with timeout when semantic evaluator times out", async () => {
    class TimeoutEvaluator extends ClarificationSemanticEvaluatorService {
      protected override async runSemanticArbitration(): Promise<never> {
        await new Promise((resolve) => setTimeout(resolve, 15));
        throw new Error("should timeout first");
      }
    }
    const config = {
      clarificationSemanticTimeoutMs: 5
    } as Pick<AppConfigService, "clarificationSemanticTimeoutMs">;
    const service = new TimeoutEvaluator(config as AppConfigService);

    const result = await service.evaluate({
      question: "统计订单",
      ruleDecision: {
        decision: "clarify",
        triggerPath: "rule",
        confidenceLevel: "low",
        missingCriticalSlots: ["metric"],
        reasonCodes: ["missing_metric_slot"]
      }
    });

    expect(result.status).toBe("timeout");
    expect(result.metadata.fallbackApplied).toBe(true);
    expect(result.metadata.fallbackReason).toBe("timeout");
    expect(result.reasonCodes).toEqual(["semantic_timeout"]);
  });
});
