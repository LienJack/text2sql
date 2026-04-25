import type { AppConfigService } from "../../src/modules/config/app-config.service";
import {
  ClarificationFusionPolicy,
  mapRuleDecisionToEvidence
} from "../../src/modules/conversation/agent/nodes/clarification-fusion.policy";

describe("ClarificationFusionPolicy", () => {
  const createPolicy = (options?: {
    hybridEnabled?: boolean;
    rulesOnlyKillSwitch?: boolean;
  }) => {
    const config = {
      clarificationHybridEnabled: options?.hybridEnabled ?? true,
      clarificationRulesOnlyKillSwitch: options?.rulesOnlyKillSwitch ?? false
    } as Pick<AppConfigService, "clarificationHybridEnabled" | "clarificationRulesOnlyKillSwitch">;
    return new ClarificationFusionPolicy(config as AppConfigService);
  };

  it("does not arbitrate bypassed decisions", () => {
    const policy = createPolicy();
    expect(
      policy.shouldArbitrate({
        decision: "continue",
        decisionSource: "metadata-intent",
        bypassed: true,
        confidenceLevel: "high"
      })
    ).toBe(false);
  });

  it("forces rules-only when kill switch is enabled", () => {
    const policy = createPolicy({ rulesOnlyKillSwitch: true });
    const result = policy.fuse({
      ruleDecision: {
        decision: "continue",
        triggerPath: "rule",
        confidenceLevel: "high",
        reasonCodes: ["rule_slots_sufficient"]
      }
    });

    expect(result.metadata.mode).toBe("rules-only");
    expect(result.metadata.fallbackApplied).toBe(true);
    expect(result.metadata.fallbackReason).toBe("kill-switch");
    expect(result.decision.triggerPath).toBe("rule");
  });

  it("uses semantic decision when rule confidence is low and semantic is stronger", () => {
    const policy = createPolicy();
    const result = policy.fuse({
      ruleDecision: {
        decision: "continue",
        triggerPath: "rule",
        confidenceLevel: "low",
        reasonCodes: ["rule_confidence_low"]
      },
      semanticEvaluation: {
        status: "success",
        decision: {
          decision: "clarify",
          triggerPath: "semantic",
          confidenceLevel: "high",
          missingCriticalSlots: ["metric"],
          reasonCodes: ["semantic_needs_clarification"],
          question: "请补充指标口径",
          reason: "语义评估认为指标缺失"
        },
        reasonCodes: ["semantic_needs_clarification"],
        metadata: {
          timeoutMs: 1000,
          elapsedMs: 12,
          fallbackApplied: false
        }
      }
    });

    expect(result.metadata.mode).toBe("hybrid");
    expect(result.metadata.semanticUsed).toBe(true);
    expect(result.decision).toMatchObject({
      decision: "clarify",
      triggerPath: "hybrid",
      conflictDetected: true
    });
  });

  it("maps rule decision to evidence with bypass metadata", () => {
    const evidence = mapRuleDecisionToEvidence({
      decision: "continue",
      action: "proceed",
      source: "metadata-intent",
      decisionSource: "metadata-intent",
      triggerPath: "rule",
      bypassed: true,
      bypassReasonCode: "bypass_metadata_intent",
      confidence: "high",
      confidenceLevel: "high",
      missingSlots: [],
      shouldClarify: false,
      missingCriticalSlots: [],
      reasonCodes: ["bypass_metadata_intent"],
      reason: "元数据查询意图，无需业务槽位补全",
      question: ""
    });

    expect(evidence).toMatchObject({
      decision: "continue",
      decisionSource: "metadata-intent",
      bypassed: true,
      bypassReasonCode: "bypass_metadata_intent"
    });
  });
});
