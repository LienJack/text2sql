import { describe, expect, it } from "vitest";
import {
  mergeRunThinkingSteps,
  normalizeDeliveryContract,
  resolveVisibleDelivery,
  transitionRunVisibilityStatus
} from "@/components/chat/run-visibility-mapper";

describe("run-visibility-mapper", () => {
  it("normalizes snake_case evidence fields into compatible camelCase delivery", () => {
    const normalized = normalizeDeliveryContract({
      answer: {
        text: "已完成回答",
        status: "executionResult",
        provider: "mock-provider"
      },
      evidence: {
        run_id: "run-1",
        selected_context: {
          count: 2,
          snippets: ["schema.orders", "few-shot.payment_method"]
        },
        risk_tags: ["semantic_registry_degraded"],
        degrade_reason: "retrieval_timeout",
        semantic_version: 7,
        semantic_lock_status: "degraded",
        semantic_degrade_reason: "semantic_registry_unavailable",
        skill_context_summary: {
          skill_count: 1,
          context_count: 2,
          degrade_reason: "skill_registry_unavailable"
        }
      }
    });

    expect(normalized).toBeDefined();
    expect(normalized?.evidence?.runId).toBe("run-1");
    expect(normalized?.evidence?.selectedContext).toEqual({
      count: 2,
      snippets: ["schema.orders", "few-shot.payment_method"]
    });
    expect(normalized?.evidence?.riskTags).toEqual(["semantic_registry_degraded"]);
    expect(normalized?.evidence?.degradeReasons).toEqual(["retrieval_timeout"]);
    expect(normalized?.evidence?.semanticVersion).toBe(7);
    expect(normalized?.evidence?.semanticLockStatus).toBe("degraded");
    expect(normalized?.evidence?.semanticDegradeReason).toBe(
      "semantic_registry_unavailable"
    );
    expect(normalized?.evidence?.skillContextSummary).toEqual({
      skillCount: 1,
      contextCount: 2,
      degradeReason: "skill_registry_unavailable"
    });
  });

  it("keeps terminal state monotonic and never regresses to loading", () => {
    expect(transitionRunVisibilityStatus("success", "loading")).toBe("success");
    expect(transitionRunVisibilityStatus("error", "loading")).toBe("error");
    expect(transitionRunVisibilityStatus("empty", "loading")).toBe("empty");
    expect(transitionRunVisibilityStatus(undefined, "loading")).toBe("loading");
  });

  it("merges sync and stream thinking steps by stepId and preserves stream stage metadata", () => {
    const merged = mergeRunThinkingSteps(
      [
        {
          node: "build-semantic-query",
          status: "success",
          stepId: "step-1",
          sequence: 1,
          at: "2026-04-10T00:00:01.000Z"
        }
      ],
      [
        {
          node: "build-semantic-query",
          status: "success",
          stepId: "step-1",
          sequence: 1,
          stage: "analysis",
          title: "语义查询规划",
          lifecycle: "completed",
          detail: "ok",
          at: "2026-04-10T00:00:01.000Z"
        }
      ]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.stage).toBe("analysis");
    expect(merged[0]?.title).toBe("语义查询规划");
    expect(merged[0]?.lifecycle).toBe("completed");
  });

  it("builds fallback delivery when answer exists but run delivery is temporarily unavailable", () => {
    const fallback = resolveVisibleDelivery({
      answerText: "已为你生成 SQL，并展示结果。",
      runStatus: "executionResult",
      runProvider: "mock-provider"
    });
    expect(fallback?.answer.text).toBe("已为你生成 SQL，并展示结果。");
    expect(fallback?.answer.status).toBe("executionResult");
    expect(fallback?.answer.provider).toBe("mock-provider");
  });
});
