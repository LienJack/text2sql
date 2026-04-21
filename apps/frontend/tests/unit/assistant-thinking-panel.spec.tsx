import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AssistantThinkingPanel } from "@/components/chat/assistant-thinking-panel";
import { createMockRun } from "./fixtures";

describe("AssistantThinkingPanel", () => {
  it("supports keyboard toggle with synced aria-expanded state", async () => {
    const user = userEvent.setup();
    render(
      <AssistantThinkingPanel
        run={createMockRun()}
        streamSteps={[
          {
            node: "generate-sql",
            status: "success",
            detail: "ok",
            stepId: "step-1",
            sequence: 1,
            lifecycle: "completed",
            stage: "generation",
            at: "2026-04-10T00:00:00.000Z"
          }
        ]}
        inProgress={false}
      />
    );

    const trigger = screen.getByRole("button", { name: "展开思考过程" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    trigger.focus();
    await user.keyboard("{Enter}");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByText("生成 SQL").length).toBeGreaterThan(0);

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("requests run details when opened with run reference and no loaded trace", async () => {
    const onRequestRun = vi.fn();
    const user = userEvent.setup();
    render(
      <AssistantThinkingPanel
        run={null}
        streamSteps={[]}
        inProgress={false}
        hasRunReference
        onRequestRun={onRequestRun}
      />
    );

    await user.click(screen.getByRole("button", { name: "展开思考过程" }));
    await waitFor(() => {
      expect(onRequestRun).toHaveBeenCalledTimes(1);
    });
  });

  it("auto-collapses when stream returns to in-progress", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <AssistantThinkingPanel
        run={createMockRun()}
        streamSteps={[
          {
            node: "generate-sql",
            status: "success",
            detail: "ok",
            stepId: "step-1",
            sequence: 1,
            lifecycle: "completed",
            at: "2026-04-10T00:00:00.000Z"
          }
        ]}
        inProgress={false}
      />
    );

    const trigger = screen.getByRole("button", { name: "展开思考过程" });
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    rerender(
      <AssistantThinkingPanel
        run={createMockRun()}
        streamSteps={[
          {
            node: "generate-sql",
            status: "success",
            detail: "ok",
            stepId: "step-1",
            sequence: 1,
            lifecycle: "running",
            at: "2026-04-10T00:00:01.000Z"
          }
        ]}
        inProgress
      />
    );

    await waitFor(() => {
      expect(trigger).toHaveAttribute("aria-expanded", "false");
    });
  });
});
