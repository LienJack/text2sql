import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModelingSidebarTree } from "@/components/settings/modeling/modeling-sidebar-tree";

describe("ModelingSidebarTree", () => {
  it("supports collapse/expand and keyboard node selection", async () => {
    const user = userEvent.setup();
    const onSelectNode = vi.fn();

    render(
      <ModelingSidebarTree
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
        views={[
          {
            id: "view.sales_summary",
            name: "sales_summary",
            sql: "select 1",
            displayName: "Sales Summary",
            description: null
          }
        ]}
        selectedNode={null}
        onSelectNode={onSelectNode}
      />
    );

    const modelsToggle = screen.getByRole("button", { name: "切换 Models 树" });
    expect(modelsToggle).toHaveAttribute("aria-expanded", "true");

    modelsToggle.focus();
    await user.keyboard("{Enter}");
    expect(modelsToggle).toHaveAttribute("aria-expanded", "false");

    await user.keyboard("{Enter}");
    expect(modelsToggle).toHaveAttribute("aria-expanded", "true");

    const modelNode = screen.getByRole("button", { name: "选择 model Orders" });
    modelNode.focus();
    await user.keyboard(" ");

    expect(onSelectNode).toHaveBeenCalledWith({ kind: "model", id: "model.orders" });
  });
});
