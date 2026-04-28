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

const ORDERS_MODEL = {
  id: "model.orders",
  tableName: "orders",
  modelName: "orders",
  displayName: "orders",
  description: "Orders table",
  columns: [
    {
      name: "customer_id",
      dataType: "varchar",
      isNullable: false,
      isPrimaryKey: false,
      displayName: "customer_id",
      description: "fk to customers"
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

  it("prefers related table as primary relationship name and keeps explicit name secondary", async () => {
    render(
      <ModelingModelDrawer
        open
        model={ORDERS_MODEL}
        relationships={[
          {
            id: "rel-orders-customers",
            name: "orders_to_customers",
            source: "manual",
            confidence: 0.92,
            bridge: {
              left: { dataset: "analytics", table: "orders", column: "customer_id" },
              right: { dataset: "analytics", table: "customers", column: "id" },
              operator: "eq",
              confidence: 0.92
            }
          }
        ]}
        onOpenChange={vi.fn()}
        onSaveMetadata={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Expand relationship customers" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Expand relationship orders_to_customers" })
    ).not.toBeInTheDocument();
    expect(screen.getByText("orders_to_customers")).toBeInTheDocument();
  });

  it("keeps relationship naming stable for table case mismatch and self-join", () => {
    render(
      <ModelingModelDrawer
        open
        model={{ ...ORDERS_MODEL, tableName: "Orders" }}
        relationships={[
          {
            id: "rel-case-mismatch",
            name: "orders_to_customers",
            source: "manual",
            confidence: 0.9,
            bridge: {
              left: { dataset: "analytics", table: "orders", column: "customer_id" },
              right: { dataset: "analytics", table: "CUSTOMERS", column: "id" },
              operator: "eq",
              confidence: 0.9
            }
          },
          {
            id: "rel-self-join",
            name: "orders_parent",
            source: "manual",
            confidence: 0.85,
            bridge: {
              left: { dataset: "analytics", table: "ORDERS", column: "parent_id" },
              right: { dataset: "analytics", table: "orders", column: "id" },
              operator: "eq",
              confidence: 0.85
            }
          }
        ]}
        onOpenChange={vi.fn()}
        onSaveMetadata={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Expand relationship CUSTOMERS" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand relationship orders" })).toBeInTheDocument();
  });

  it("falls back safely when relationship bridge is incomplete", () => {
    render(
      <ModelingModelDrawer
        open
        model={ORDERS_MODEL}
        relationships={[
          {
            id: "rel-incomplete",
            name: "orders_to_unknown",
            source: "manual",
            confidence: 0.4,
            bridge: {
              left: { dataset: "analytics", table: "orders", column: "owner_id" },
              right: { dataset: "analytics", table: "", column: "" },
              operator: "eq",
              confidence: 0.4
            }
          }
        ]}
        onOpenChange={vi.fn()}
        onSaveMetadata={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Expand relationship -" })).toBeInTheDocument();
    expect(screen.getByText("-.-")).toBeInTheDocument();
  });

  it("keeps relationship primary/secondary naming consistent inside drawer views", () => {
    render(
      <ModelingModelDrawer
        open
        model={ORDERS_MODEL}
        relationships={[
          {
            id: "rel-orders-customers",
            name: "orders_to_customers",
            source: "manual",
            confidence: 0.9,
            bridge: {
              left: { dataset: "analytics", table: "orders", column: "customer_id" },
              right: { dataset: "analytics", table: "customers", column: "id" },
              operator: "eq",
              confidence: 0.9
            }
          }
        ]}
        onOpenChange={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Expand relationship customers" })).toBeInTheDocument();
    expect(screen.getAllByText("customers").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("orders_to_customers")).toBeInTheDocument();
  });
});
