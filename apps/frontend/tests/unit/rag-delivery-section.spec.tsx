import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { RagDeliverySection } from "@/components/chat/rag-delivery-section";

function SectionHarness() {
  const [open, setOpen] = useState(false);
  return (
    <RagDeliverySection
      id="evidence"
      title="Evidence"
      open={open}
      severity="critical"
      summary="runId=run-1"
      onOpenChange={setOpen}
    >
      <p>证据区正文</p>
    </RagDeliverySection>
  );
}

describe("RagDeliverySection", () => {
  it("toggles section content with click", async () => {
    const user = userEvent.setup();
    render(<SectionHarness />);

    expect(screen.getByText("critical")).toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "切换 Evidence 区块" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("证据区正文")).not.toBeInTheDocument();

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("证据区正文")).toBeInTheDocument();
  });

  it("supports keyboard toggle", async () => {
    const user = userEvent.setup();
    render(<SectionHarness />);

    const trigger = screen.getByRole("button", { name: "切换 Evidence 区块" });
    trigger.focus();
    await user.keyboard("[Space]");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("证据区正文")).toBeInTheDocument();
  });
});
