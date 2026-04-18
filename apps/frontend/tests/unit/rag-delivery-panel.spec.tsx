import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DeliveryContract } from "@text2sql/shared-types";
import { describe, expect, it } from "vitest";
import { RagDeliveryPanel } from "@/components/chat/rag-delivery-panel";

function createDelivery(
  partial?: Partial<DeliveryContract["evidence"]>,
  artifact?: DeliveryContract["artifact"]
): DeliveryContract {
  return {
    answer: {
      text: "已为你生成 SQL，并展示结果。",
      status: "executionResult",
      provider: "mock-provider"
    },
    evidence: {
      runId: "run-1",
      ...partial
    },
    ...(artifact ? { artifact } : {})
  };
}

describe("RagDeliveryPanel", () => {
  it("auto-expands answer by default and supports progressive disclosure", async () => {
    const user = userEvent.setup();
    render(
      <RagDeliveryPanel
        delivery={createDelivery({
          selectedContext: {
            count: 2,
            snippets: ["schema.orders", "few-shot.payment_method"]
          }
        })}
        runId="run-1"
      />
    );

    expect(screen.getByText("已为你生成 SQL，并展示结果。")).toBeInTheDocument();
    const evidenceTrigger = screen.getByRole("button", {
      name: "切换 Evidence 区块"
    });
    expect(evidenceTrigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("已选上下文 2 条")).not.toBeInTheDocument();

    await user.click(evidenceTrigger);
    expect(evidenceTrigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("已选上下文 2 条")).toBeInTheDocument();
    expect(screen.getByText("schema.orders")).toBeInTheDocument();
    expect(screen.getByText("few-shot.payment_method")).toBeInTheDocument();
  });

  it("keeps manual collapse state across rerender in same run lifecycle", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <RagDeliveryPanel
        delivery={createDelivery({
          degradeReasons: ["retrieval_timeout"],
          riskTags: ["retrieval_degraded"]
        })}
        runId="run-manual"
      />
    );

    const evidenceTrigger = screen.getByRole("button", {
      name: "切换 Evidence 区块"
    });
    expect(evidenceTrigger).toHaveAttribute("aria-expanded", "true");
    await user.click(evidenceTrigger);
    expect(evidenceTrigger).toHaveAttribute("aria-expanded", "false");

    rerender(
      <RagDeliveryPanel
        delivery={createDelivery({
          degradeReasons: ["retrieval_timeout"],
          riskTags: ["retrieval_degraded"],
          semanticVersion: 6
        })}
        runId="run-manual"
      />
    );

    expect(
      screen.getByRole("button", {
        name: "切换 Evidence 区块"
      })
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("检索链路降级：retrieval_timeout")).not.toBeInTheDocument();
  });

  it("renders fail-closed banner without blocking answer content", async () => {
    const user = userEvent.setup();
    render(
      <RagDeliveryPanel
        delivery={createDelivery({
          degradeReasons: ["sandbox_fail_closed"],
          riskTags: ["policy_denied"]
        })}
        runId="run-fail-closed"
      />
    );

    expect(screen.getByText(/fail-closed 安全提示：/)).toBeInTheDocument();
    const answerTrigger = screen.getByRole("button", {
      name: "切换 Answer 区块"
    });
    expect(answerTrigger).toBeInTheDocument();
    if (answerTrigger.getAttribute("aria-expanded") !== "true") {
      await user.click(answerTrigger);
    }
    expect(screen.getByText("已为你生成 SQL，并展示结果。")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "切换 Evidence 区块"
      })
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("distinguishes artifact missing and explicit no-output state", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <RagDeliveryPanel delivery={createDelivery()} runId="run-artifact-1" />
    );

    const artifactTrigger = screen.getByRole("button", {
      name: "切换 Artifact 区块"
    });
    await user.click(artifactTrigger);
    expect(screen.getByText("Artifact 字段缺失（兼容空态）。")).toBeInTheDocument();

    rerender(
      <RagDeliveryPanel
        delivery={createDelivery(
          {},
          {
            rowCount: 0,
            hasError: false
          }
        )}
        runId="run-artifact-2"
      />
    );
    await user.click(
      screen.getByRole("button", {
        name: "切换 Artifact 区块"
      })
    );
    expect(screen.getByText("本次无产物（执行结果为空）。")).toBeInTheDocument();
  });

  it("renders semantic compatibility fields in evidence section", async () => {
    const user = userEvent.setup();
    render(
      <RagDeliveryPanel
        delivery={createDelivery({
          semanticVersion: 7,
          semanticLockStatus: "degraded",
          semanticDegradeReason: "semantic_registry_degraded",
          skillContextSummary: {
            skillCount: 3,
            contextCount: 9,
            degradeReason: "context_budget_exceeded"
          }
        })}
        runId="run-semantic"
      />
    );

    const evidenceTrigger = screen.getByRole("button", {
      name: "切换 Evidence 区块"
    });
    if (evidenceTrigger.getAttribute("aria-expanded") !== "true") {
      await user.click(evidenceTrigger);
    }

    expect(screen.getByText("语义版本：7")).toBeInTheDocument();
    expect(screen.getByText("语义锁状态：degraded")).toBeInTheDocument();
    expect(
      screen.getByText("语义降级原因：semantic_registry_degraded")
    ).toBeInTheDocument();
    expect(screen.getByText("语义降级标识：已触发（不阻断主回答）")).toBeInTheDocument();
    expect(
      screen.getByText(
        "技能上下文（只读）：skills=3, context=9, degradeReason=context_budget_exceeded"
      )
    ).toBeInTheDocument();
  });
});
