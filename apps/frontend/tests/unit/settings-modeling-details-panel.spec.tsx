import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelingDetailsPanel } from "@/components/settings/modeling/modeling-details-panel";

describe("ModelingDetailsPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps current tab when dirty guard rejects tab switch", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(
      <ModelingDetailsPanel
        selectedNode={{ kind: "model", id: "model.orders" }}
        models={[
          {
            id: "model.orders",
            tableName: "orders",
            modelName: "orders",
            displayName: "Orders",
            description: null,
            columns: []
          }
        ]}
        views={[]}
        calculatedFields={[]}
        relationships={[]}
        onMetadataSave={vi.fn()}
        onCalculatedFieldsSave={vi.fn()}
        onRelationshipsSave={vi.fn()}
      />
    );

    await user.type(screen.getByRole("textbox", { name: "显示名称" }), " v2");
    await user.click(screen.getByRole("button", { name: "Relationship" }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "保存 Metadata" })).toBeInTheDocument();
  });
});
