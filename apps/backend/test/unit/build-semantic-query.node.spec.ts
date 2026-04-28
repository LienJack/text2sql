import {
  BuildSemanticQueryNode
} from "../../src/modules/conversation/agent/nodes/build-semantic-query.node";
import type { PlannerVersionLockService } from "../../src/modules/conversation/agent/planner/planner-version-lock.service";

describe("BuildSemanticQueryNode", () => {
  const createNode = (lockStatus: "locked" | "fallback" | "degraded" = "locked") => {
    const plannerVersionLock = {
      resolve: jest.fn().mockResolvedValue({
        lockStatus,
        semanticVersion: 3,
        fallbackApplied: lockStatus === "fallback",
        degradeReason: lockStatus === "degraded" ? "semantic_unavailable" : undefined,
        riskTags: lockStatus === "degraded" ? ["semantic_registry_degraded"] : [],
        domain: "semantic_term",
        term: "orders"
      })
    } as unknown as PlannerVersionLockService;

    return {
      node: new BuildSemanticQueryNode(plannerVersionLock),
      plannerVersionLock
    };
  };

  const baseIntentPlan = {
    status: "ready" as const,
    intent: "aggregate" as const,
    constraints: ["must_use_selected_context"],
    summary: "intent ready",
    uncertaintySignal: {
      level: "high" as const,
      needsStrictSemanticPath: true,
      reasonCodes: ["clarification_low_confidence"]
    },
    clarificationDecision: {
      decision: "continue" as const,
      triggerPath: "hybrid" as const,
      confidenceLevel: "low" as const,
      reasonCodes: ["rule_confidence_low"]
    },
    riskTags: ["intent:rule:rule_confidence_low"],
    planningWarnings: ["strict semantic path required"]
  };

  it("enables strict semantic hints when intent uncertainty requires it", async () => {
    const { node } = createNode("locked");

    const plan = await node.run({
      intentPlan: baseIntentPlan,
      question: "统计订单",
      retrievalBundle: {
        context_pack: {
          status: "ready",
          instruction_sets: {
            model_bindings: [],
            relationship_bindings: [],
            metric_bindings: [],
            calculated_field_bindings: []
          }
        }
      } as never
    });

    expect(plan.status).toBe("ready");
    expect(plan.strictMode).toBe(true);
    expect(plan.semanticHints).toEqual(
      expect.arrayContaining(["enforce_strict_clarification_guards", "must_consume_selected_context"])
    );
    expect(plan.riskTags).toEqual(
      expect.arrayContaining(["intent:rule:rule_confidence_low", "semantic:strict_mode_enabled"])
    );
  });

  it("keeps strict mode disabled for bypass constraints", async () => {
    const { node } = createNode("locked");

    const plan = await node.run({
      intentPlan: {
        ...baseIntentPlan,
        constraints: ["skip_business_semantic_assertions"],
        uncertaintySignal: {
          level: "low",
          needsStrictSemanticPath: false,
          reasonCodes: ["intent_bypass_business_semantics"]
        }
      },
      question: "show tables"
    });

    expect(plan.strictMode).toBe(false);
    expect(plan.semanticHints).toContain("preserve_clarification_bypass_reason");
  });

  it("returns degraded status when version lock is degraded", async () => {
    const { node } = createNode("degraded");

    const plan = await node.run({
      intentPlan: baseIntentPlan,
      question: "统计订单"
    });

    expect(plan.status).toBe("degraded");
    expect(plan.lockStatus).toBe("degraded");
    expect(plan.degradeReason).toBe("semantic_unavailable");
    expect(plan.planningWarnings?.semantic.join(" ")).toContain("语义版本锁降级");
  });
});
