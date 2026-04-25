import {
  BuildIntentPlanNode
} from "../../src/modules/conversation/agent/nodes/build-intent-plan.node";
import type { ClarificationFusionPolicy } from "../../src/modules/conversation/agent/nodes/clarification-fusion.policy";
import type { ClarificationSemanticEvaluatorService } from "../../src/modules/conversation/agent/nodes/clarification-semantic-evaluator.service";
import type { RetrievedKnowledge } from "../../src/modules/conversation/agent/nodes/retrieve-knowledge.node";

describe("BuildIntentPlanNode", () => {
  const createNode = (overrides?: {
    shouldArbitrate?: boolean;
    fusedDecision?: {
      decision?: "continue" | "clarify";
      decisionSource?: string;
      bypassed?: boolean;
      confidenceLevel?: "high" | "medium" | "low";
      reasonCodes?: string[];
      conflictDetected?: boolean;
      missingCriticalSlots?: string[];
      reason?: string;
      question?: string;
    };
  }) => {
    const semanticEvaluator = {
      evaluate: jest.fn().mockResolvedValue({
        status: "success",
        decision: {
          decision: "clarify",
          triggerPath: "semantic",
          confidenceLevel: "medium",
          reasonCodes: ["semantic_needs_clarification"],
          missingCriticalSlots: ["metric"]
        },
        reasonCodes: ["semantic_needs_clarification"],
        metadata: {
          timeoutMs: 1000,
          elapsedMs: 10,
          fallbackApplied: false
        }
      })
    } as unknown as ClarificationSemanticEvaluatorService;

    const fusionPolicy = {
      shouldArbitrate: jest.fn().mockReturnValue(overrides?.shouldArbitrate ?? false),
      fuse: jest.fn().mockReturnValue({
        decision: {
          decision: overrides?.fusedDecision?.decision ?? "continue",
          triggerPath: "rule",
          decisionSource: overrides?.fusedDecision?.decisionSource ?? "rule",
          bypassed: overrides?.fusedDecision?.bypassed ?? false,
          confidenceLevel: overrides?.fusedDecision?.confidenceLevel ?? "high",
          reasonCodes: overrides?.fusedDecision?.reasonCodes ?? ["rule_slots_sufficient"],
          conflictDetected: overrides?.fusedDecision?.conflictDetected ?? false,
          missingCriticalSlots: overrides?.fusedDecision?.missingCriticalSlots ?? [],
          reason: overrides?.fusedDecision?.reason ?? "问题信息充足",
          question: overrides?.fusedDecision?.question ?? ""
        },
        metadata: {
          mode: "hybrid",
          semanticRequested: overrides?.shouldArbitrate ?? false,
          semanticUsed: overrides?.shouldArbitrate ?? false,
          fallbackApplied: false,
          strictModeReasons:
            overrides?.fusedDecision?.confidenceLevel === "low"
              ? ["clarification_low_confidence"]
              : [],
          stageRiskTags: {
            rule: ["rule:rule_slots_sufficient"],
            semantic: [],
            fusion: []
          }
        }
      })
    } as unknown as ClarificationFusionPolicy;

    return {
      node: new BuildIntentPlanNode(semanticEvaluator, fusionPolicy),
      semanticEvaluator,
      fusionPolicy
    };
  };

  const readyKnowledge = {
    status: "ready" as const,
    snippets: ["stub"],
    summary: "retrieval ready",
    retrievalBundle: {
      selected_context: []
    }
  } as unknown as RetrievedKnowledge;

  it("returns aggregate intent with low uncertainty for clear query", async () => {
    const { node } = createNode();

    const plan = await node.run("统计近30天订单总数", readyKnowledge);

    expect(plan).toMatchObject({
      status: "ready",
      intent: "aggregate"
    });
    expect(plan.uncertaintySignal).toMatchObject({
      level: "low",
      needsStrictSemanticPath: false
    });
    expect(plan.riskTags).toEqual(expect.arrayContaining(["intent:rule:rule_slots_sufficient"]));
  });

  it("marks bypass decisions to skip business semantic assertions", async () => {
    const { node } = createNode({
      fusedDecision: {
        decision: "continue",
        decisionSource: "metadata-intent",
        bypassed: true,
        reasonCodes: ["bypass_metadata_intent"]
      }
    });

    const plan = await node.run("show tables", readyKnowledge);

    expect(plan.constraints).toContain("skip_business_semantic_assertions");
    expect(plan.uncertaintySignal).toMatchObject({
      level: "low",
      needsStrictSemanticPath: false
    });
  });

  it("promotes uncertainty when fused decision is low confidence", async () => {
    const { node } = createNode({
      shouldArbitrate: true,
      fusedDecision: {
        decision: "continue",
        confidenceLevel: "low",
        reasonCodes: ["rule_confidence_low"]
      }
    });

    const plan = await node.run("统计订单", readyKnowledge);

    expect(plan.uncertaintySignal).toMatchObject({
      level: "medium",
      needsStrictSemanticPath: true
    });
    expect(plan.planningWarnings?.join(" ")).toContain("strict semantic path");
  });
});
