import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  ContextEnvelopePanel,
  buildContextEnvelopeFromDraft,
  createEmptyContextEnvelopeDraft
} from "@/components/chat/context-envelope-panel";

function ContextEnvelopePanelHarness() {
  const [draft, setDraft] = useState(createEmptyContextEnvelopeDraft());
  const [clearAfterSend, setClearAfterSend] = useState(true);

  return (
    <ContextEnvelopePanel
      value={draft}
      clearAfterSend={clearAfterSend}
      onValueChange={setDraft}
      onClearAfterSendChange={setClearAfterSend}
    />
  );
}

describe("chat context envelope input", () => {
  it("is collapsed by default and can be expanded by keyboard", async () => {
    const user = userEvent.setup();
    render(<ContextEnvelopePanelHarness />);

    const toggleButton = screen.getByRole("button", { name: "展开高级上下文" });
    expect(toggleButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("指标口径")).not.toBeInTheDocument();

    await user.tab();
    await user.keyboard("{Enter}");
    expect(toggleButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("指标口径")).toBeInTheDocument();
  });

  it("builds context envelope by trimming and filtering empty draft fields", () => {
    const envelope = buildContextEnvelopeFromDraft({
      metricDefinition: "  按支付成功口径统计订单  ",
      timeRangeFrom: "2026-03-01",
      timeRangeTo: "2026-03-31",
      timezone: " Asia/Shanghai ",
      entityMappings: "华北大区=region_north\n华南大区:region_south\ninvalid-line",
      mustIncludeTables: "orders, payments,  ",
      mustExcludeTables: "tmp_orders",
      businessConstraints: "仅统计已支付订单；排除退款单"
    });

    expect(envelope).toEqual({
      metricDefinition: "按支付成功口径统计订单",
      timeRange: {
        from: "2026-03-01",
        to: "2026-03-31",
        timezone: "Asia/Shanghai"
      },
      entityMappings: [
        { entity: "华北大区", mappedTo: "region_north" },
        { entity: "华南大区", mappedTo: "region_south" }
      ],
      mustIncludeTables: ["orders", "payments"],
      mustExcludeTables: ["tmp_orders"],
      businessConstraints: ["仅统计已支付订单", "排除退款单"]
    });
  });

  it("returns undefined when every draft field is empty", () => {
    expect(buildContextEnvelopeFromDraft(createEmptyContextEnvelopeDraft())).toBeUndefined();
  });
});
