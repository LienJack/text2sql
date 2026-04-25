import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { RagDeliveryPanel } from "@/components/chat/rag-delivery-panel";
import {
  normalizeDeliveryContract,
  resolveRunVisibilityStatus,
  resolveVisibleDelivery,
  transitionRunVisibilityStatus
} from "@/components/chat/run-visibility-mapper";
import { createMockRagDelivery } from "./fixtures";

describe("chat rag sync/stream consistency", () => {
  it.each([
    {
      state: "happy",
      expectedState: "happy",
      expectedText: "已选上下文 2 条"
    },
    {
      state: "nil",
      expectedState: "nil",
      expectedText: "暂无证据（字段缺失）。"
    },
    {
      state: "empty",
      expectedState: "empty",
      expectedText: "未检索到可用上下文。"
    },
    {
      state: "error",
      expectedState: "error",
      expectedText: "检索链路降级：retrieval_timeout"
    }
  ] as const)(
    "covers selected_context matrix state=$state",
    async ({ state, expectedState, expectedText }) => {
      const user = userEvent.setup();
      render(
        <RagDeliveryPanel
          delivery={createMockRagDelivery(state, { runId: `run-${state}` })}
          runId={`run-${state}`}
        />
      );

      const evidenceTrigger = screen.getByRole("button", {
        name: "切换 Evidence 区块"
      });
      if (evidenceTrigger.getAttribute("aria-expanded") !== "true") {
        await user.click(evidenceTrigger);
      }

      expect(
        screen.getByText(`selected_context 状态：${expectedState}`)
      ).toBeInTheDocument();
      expect(screen.getByText(expectedText)).toBeInTheDocument();
    }
  );

  it("keeps same runId semantics between sync and stream delivery layers", () => {
    const syncDelivery = createMockRagDelivery("happy", { runId: "run-sync" });
    const streamDelivery = normalizeDeliveryContract({
      answer: {
        text: "stream-answer",
        status: "executionResult",
        provider: "mock-stream"
      },
      evidence: {
        run_id: "run-sync",
        selected_context: {
          count: 1
        }
      }
    });

    const resolved = resolveVisibleDelivery({
      runDelivery: syncDelivery,
      streamDelivery
    });

    expect(resolved?.evidence?.runId).toBe("run-sync");
    expect(resolved?.answer.provider).toBe("mock-provider");
  });

  it("normalizes saved prior SQL evidence from snake_case stream payload", () => {
    const normalized = normalizeDeliveryContract({
      answer: {
        text: "stream-answer",
        status: "executionResult",
        provider: "mock-stream"
      },
      evidence: {
        run_id: "run-sync",
        saved_prior_sql: {
          status: "hit",
          shortcut_used: true,
          reason_codes: ["prior_sql_shortcut_hit"],
          selected_view_id: "view.chat_run.run-sync",
          selected_source_run_id: "run-sync",
          safety_result: "passed"
        }
      }
    });

    expect(normalized?.evidence?.savedPriorSql).toEqual({
      status: "hit",
      shortcutUsed: true,
      reasonCodes: ["prior_sql_shortcut_hit"],
      selectedViewId: "view.chat_run.run-sync",
      selectedSourceRunId: "run-sync",
      safetyResult: "passed"
    });
  });

  it("prevents terminal state regression to loading on duplicate and out-of-order events", () => {
    let status = transitionRunVisibilityStatus(undefined, "loading");
    status = transitionRunVisibilityStatus(status, "success");
    status = transitionRunVisibilityStatus(status, "loading");
    status = transitionRunVisibilityStatus(status, "loading");
    expect(status).toBe("success");

    let errorTerminal = transitionRunVisibilityStatus(undefined, "loading");
    errorTerminal = transitionRunVisibilityStatus(errorTerminal, "error");
    errorTerminal = transitionRunVisibilityStatus(errorTerminal, "error");
    errorTerminal = transitionRunVisibilityStatus(errorTerminal, "loading");
    expect(errorTerminal).toBe("error");

    expect(
      resolveRunVisibilityStatus({
        streamStatus: "success",
        activeStream: true
      })
    ).toBe("success");
    expect(
      resolveRunVisibilityStatus({
        streamStatus: "error",
        activeStream: true
      })
    ).toBe("error");
  });
});
