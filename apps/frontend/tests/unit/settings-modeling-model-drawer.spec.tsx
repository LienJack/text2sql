import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModelingModelDrawer } from "@/components/settings/modeling/modeling-model-drawer";

const MODEL = {
  id: "model.customers",
  tableName: "olist_customers_dataset",
  modelName: "customers",
  displayName: "customers",
  description: "Customer base table",
  columns: [
    {
      name: "customer_unique_id",
      dataType: "varchar",
      isNullable: false,
      isPrimaryKey: false,
      displayName: "customer_unique_id",
      description: "Unique id of the customer"
    }
  ]
};

describe("ModelingModelDrawer", () => {
  it("expands column details on demand", async () => {
    const user = userEvent.setup();
    render(
      <ModelingModelDrawer
        open
        model={MODEL}
        relationships={[]}
        onOpenChange={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "Expand column customer_unique_id" }));

    expect(screen.getByText("Description: Unique id of the customer")).toBeInTheDocument();
  });

  it("loads preview rows with limit 20", async () => {
    const user = userEvent.setup();
    const onLoadPreview = vi.fn().mockResolvedValue({
      columns: ["customer_id"],
      rows: [{ customer_id: "abc-1" }],
      rowCount: 1,
      truncated: false
    });
    render(
      <ModelingModelDrawer
        open
        model={MODEL}
        relationships={[]}
        onOpenChange={vi.fn()}
        onLoadPreview={onLoadPreview}
      />
    );

    await user.click(screen.getByRole("button", { name: "View 20 rows" }));

    await waitFor(() => {
      expect(onLoadPreview).toHaveBeenCalledWith({
        targetKind: "model",
        targetId: "model.customers",
        limit: 20
      });
    });
    expect(await screen.findByText("abc-1")).toBeInTheDocument();
  });

  it("opens metadata dialog and submits edited model metadata", async () => {
    const user = userEvent.setup();
    const onSaveMetadata = vi.fn().mockResolvedValue(undefined);
    render(
      <ModelingModelDrawer
        open
        model={MODEL}
        relationships={[]}
        onOpenChange={vi.fn()}
        onSaveMetadata={onSaveMetadata}
      />
    );

    await user.click(screen.getByRole("button", { name: "编辑 metadata" }));

    await user.clear(screen.getByLabelText("Model alias"));
    await user.type(screen.getByLabelText("Model alias"), "Customers");
    await user.clear(screen.getByLabelText("customer_unique_id alias"));
    await user.type(screen.getByLabelText("customer_unique_id alias"), "Customer ID");
    await user.clear(screen.getByLabelText("customer_unique_id description"));
    await user.type(
      screen.getByLabelText("customer_unique_id description"),
      "Primary business customer id"
    );

    await user.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(onSaveMetadata).toHaveBeenCalledWith({
        modelId: "model.customers",
        displayName: "Customers",
        description: "Customer base table",
        columns: [
          {
            index: 0,
            displayName: "Customer ID",
            description: "Primary business customer id"
          }
        ]
      });
    });
  });
});
