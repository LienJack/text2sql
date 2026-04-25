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

  it("normalizes extended ChatBI artifact fields while keeping legacy row preview fields", () => {
    const normalized = normalizeDeliveryContract({
      answer: {
        text: "收入总体上升。",
        status: "executionResult",
        provider: "mock-provider"
      },
      evidence: {
        run_id: "run-chatbi-1"
      },
      artifact: {
        sql: "select month, revenue from sales",
        rowCount: 3,
        hasError: false,
        summary: {
          text: "近三个月收入持续增长。",
          highlights: ["+23%"]
        },
        table: {
          columns: ["month", "revenue"],
          rowCount: 3,
          rowsPreview: [
            { month: "2026-01", revenue: 100 },
            { month: "2026-02", revenue: 120 }
          ]
        },
        chart: {
          type: "line",
          mappings: {
            x: "month",
            y: "revenue"
          }
        },
        display: {
          type: "line"
        },
        validation: {
          status: "valid"
        },
        fallback: {
          reason: "none"
        },
        visualIntent: {
          source: "llm",
          normalizedIntent: {
            chartType: "line",
            x: "month",
            y: "revenue"
          }
        }
      }
    });

    const artifact = normalized?.artifact as Record<string, unknown> | undefined;
    expect(normalized?.evidence?.runId).toBe("run-chatbi-1");
    expect(artifact?.rowCount).toBe(3);
    expect(artifact?.hasError).toBe(false);
    expect((artifact?.summary as Record<string, unknown>)?.text).toBe(
      "近三个月收入持续增长。"
    );
    expect((artifact?.display as Record<string, unknown>)?.type).toBe("line");
    expect((artifact?.chart as Record<string, unknown>)?.type).toBe("line");
    expect((artifact?.table as Record<string, unknown>)?.rowCount).toBe(3);
    expect((artifact?.visualIntent as Record<string, unknown>)?.source).toBe("llm");
  });

  it("keeps legacy artifact behavior stable", () => {
    const normalized = normalizeDeliveryContract({
      answer: {
        text: "legacy artifact",
        status: "executionResult",
        provider: "mock-provider"
      },
      artifact: {
        sql: "select 1",
        columns: ["value"],
        rowCount: 1,
        rowsPreview: [{ value: 1 }],
        hasError: false
      }
    });

    const artifact = normalized?.artifact as Record<string, unknown> | undefined;
    expect(artifact?.sql).toBe("select 1");
    expect(artifact?.rowCount).toBe(1);
    expect(artifact?.hasError).toBe(false);
    expect(artifact?.display).toBeUndefined();
    expect(artifact?.summary).toBeUndefined();
    expect(artifact?.chart).toBeUndefined();
  });

  it("drops malformed visualIntent/summary payload without crashing", () => {
    const normalized = normalizeDeliveryContract({
      answer: {
        text: "malformed payload",
        status: "executionResult",
        provider: "mock-provider"
      },
      artifact: {
        rowCount: 0,
        hasError: false,
        summary: () => "invalid-summary",
        visualIntent: "not-an-object"
      }
    });

    const artifact = normalized?.artifact as Record<string, unknown> | undefined;
    expect(normalized).toBeDefined();
    expect(artifact?.summary).toBeUndefined();
    expect(artifact?.visualIntent).toBeUndefined();
  });

  it("downgrades to table display when chart mappings are missing", () => {
    const normalized = normalizeDeliveryContract({
      answer: {
        text: "chart fallback",
        status: "executionResult",
        provider: "mock-provider"
      },
      artifact: {
        rowCount: 2,
        hasError: false,
        table: {
          columns: ["region", "revenue"],
          rowCount: 2,
          rowsPreview: [
            { region: "JP", revenue: 100 },
            { region: "US", revenue: 80 }
          ]
        },
        chart: {
          type: "bar"
        },
        display: {
          type: "bar"
        }
      }
    });

    const artifact = normalized?.artifact as Record<string, unknown> | undefined;
    expect(artifact?.chart).toBeUndefined();
    expect((artifact?.display as Record<string, unknown>)?.type).toBe("table");
    expect((artifact?.fallback as Record<string, unknown>)?.reason).toBe(
      "missing_chart_mappings"
    );
  });

  it("keeps run-first merge semantics and only fills new artifact fields from stream", () => {
    const resolved = resolveVisibleDelivery({
      runDelivery: {
        answer: {
          text: "run-answer",
          status: "executionResult",
          provider: "run-provider"
        },
        artifact: {
          rowCount: 1,
          hasError: false
        }
      },
      streamDelivery: {
        answer: {
          text: "stream-answer",
          status: "executionResult",
          provider: "stream-provider"
        },
        artifact: {
          rowCount: 99,
          hasError: false,
          summary: {
            text: "stream-summary"
          },
          table: {
            columns: ["kpi"],
            rowCount: 99,
            rowsPreview: [{ kpi: "revenue" }]
          },
          display: {
            type: "table"
          }
        }
      }
    });

    const artifact = resolved?.artifact as Record<string, unknown> | undefined;
    expect(resolved?.answer.provider).toBe("run-provider");
    expect(artifact?.rowCount).toBe(1);
    expect((artifact?.summary as Record<string, unknown>)?.text).toBe("stream-summary");
    expect((artifact?.table as Record<string, unknown>)?.rowCount).toBe(99);
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
