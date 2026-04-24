import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { RelationshipModelingCanvas } from "@/components/settings/relationship-modeling-canvas";

vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ children }: { children?: ReactNode }) => (
    <div data-testid="mock-react-flow">{children}</div>
  ),
  Background: () => null,
  MiniMap: () => null,
  Controls: () => null
}));

describe("RelationshipModelingCanvas", () => {
  it("renders edge list and triggers create/remove callbacks", async () => {
    const user = userEvent.setup();
    const onCreateEdge = vi.fn();
    const onEditEdge = vi.fn();
    const onRemoveEdge = vi.fn();

    render(
      <RelationshipModelingCanvas
        edges={[
          {
            id: "edge-orders-customers",
            name: "orders_to_customers",
            bridge: {
              left: {
                dataset: "sales",
                table: "orders",
                column: "customer_id"
              },
              right: {
                dataset: "crm",
                table: "customers",
                column: "id"
              },
              operator: "eq",
              confidence: 0.9
            }
          }
        ]}
        onCreateEdge={onCreateEdge}
        onEditEdge={onEditEdge}
        onRemoveEdge={onRemoveEdge}
      />
    );

    expect(screen.getByTestId("mock-react-flow")).toBeInTheDocument();
    expect(screen.getByText("orders_to_customers")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "新增关系边" }));
    expect(onCreateEdge).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "编辑关系边 edge-orders-customers" }));
    expect(onEditEdge).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "删除关系边 edge-orders-customers" }));
    expect(onRemoveEdge).toHaveBeenCalledWith("edge-orders-customers");
  });
});
