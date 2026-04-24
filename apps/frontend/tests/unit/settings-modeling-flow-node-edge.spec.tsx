import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModelingFlowEdge } from "@/components/settings/modeling/modeling-flow-edge";
import { ModelingFlowNode } from "@/components/settings/modeling/modeling-flow-node";

vi.mock("@xyflow/react", () => ({
  Handle: ({ type, position }: { type: string; position: string }) => (
    <span data-testid={`handle-${type}-${position}`} />
  ),
  Position: {
    Left: "left",
    Right: "right"
  },
  BaseEdge: ({
    className,
    ...props
  }: {
    className?: string;
    "data-confidence-band"?: string;
    "data-selected"?: string;
  }) => (
    <div
      data-testid="flow-base-edge"
      data-class={className ?? ""}
      data-confidence-band={props["data-confidence-band"]}
      data-selected={props["data-selected"]}
    />
  ),
  EdgeLabelRenderer: ({ children }: { children: unknown }) => <div>{children as never}</div>,
  getBezierPath: () => ["M0,0", 10, 10]
}));

describe("ModelingFlowNode", () => {
  it("renders selected model node with kind marker", () => {
    const nodeProps = {
      id: "model.orders",
      data: {
        kind: "model",
        title: "Orders",
        subtitle: "orders",
        columnCount: 12,
        sections: {
          columns: ["id", "order_no", "customer_id"],
          calculatedFields: ["order_total"],
          relationships: ["orders_to_customers"]
        }
      },
      selected: true
    } as unknown as Parameters<typeof ModelingFlowNode>[0];

    render(
      <ModelingFlowNode {...nodeProps} />
    );

    const node = screen.getByTestId("modeling-flow-node");
    expect(node).toHaveAttribute("data-node-kind", "model");
    expect(node).toHaveAttribute("data-selected", "true");
    expect(node.className).toContain("ring-1");
    expect(screen.getByText("model")).toBeInTheDocument();
    expect(screen.getByText("列数 12")).toBeInTheDocument();
    expect(screen.getByText("Columns")).toBeInTheDocument();
    expect(screen.getByText("Calculated Fields")).toBeInTheDocument();
    expect(screen.getByText("Relationships")).toBeInTheDocument();
    expect(
      screen.getByTestId("modeling-flow-node-section-columns-items")
    ).toHaveTextContent("id, order_no +1");
    expect(
      screen.getByTestId("modeling-flow-node-section-calculatedFields-items")
    ).toHaveTextContent("order_total");
    expect(
      screen.getByTestId("modeling-flow-node-section-relationships-items")
    ).toHaveTextContent("orders_to_customers");
  });

  it("renders dragging view node status without column count", () => {
    const nodeProps = {
      id: "view.daily_orders",
      data: {
        kind: "view",
        title: "Daily Orders",
        subtitle: "daily_orders"
      },
      selected: false,
      dragging: true
    } as unknown as Parameters<typeof ModelingFlowNode>[0];

    render(
      <ModelingFlowNode {...nodeProps} />
    );

    const node = screen.getByTestId("modeling-flow-node");
    expect(node).toHaveAttribute("data-node-kind", "view");
    expect(node).toHaveAttribute("data-dragging", "true");
    expect(node).toHaveAttribute("data-selected", "false");
    expect(screen.queryByText(/列数/)).not.toBeInTheDocument();
    expect(screen.queryByText("Columns")).not.toBeInTheDocument();
  });

  it("keeps compact model node rendering when section data is absent", () => {
    const nodeProps = {
      id: "model.minimal",
      data: {
        kind: "model",
        title: "Minimal Model",
        subtitle: "minimal",
        columnCount: 1
      },
      selected: false
    } as unknown as Parameters<typeof ModelingFlowNode>[0];

    render(
      <ModelingFlowNode {...nodeProps} />
    );

    expect(screen.getByTestId("modeling-flow-node")).toHaveAttribute("data-node-kind", "model");
    expect(screen.queryByText("Calculated Fields")).not.toBeInTheDocument();
    expect(screen.queryByText("Relationships")).not.toBeInTheDocument();
  });
});

describe("ModelingFlowEdge", () => {
  it("renders dashed warning edge style for low-confidence inferred relationship", () => {
    const edgeProps = {
      id: "rel-1",
      sourceX: 0,
      sourceY: 0,
      targetX: 100,
      targetY: 50,
      sourcePosition: "right",
      targetPosition: "left",
      selected: false,
      data: {
        label: "orders.customer_id = customers.id",
        source: "inferred",
        confidence: 0.42
      }
    } as unknown as Parameters<typeof ModelingFlowEdge>[0];

    render(
      <svg>
        <ModelingFlowEdge {...edgeProps} />
      </svg>
    );

    const edge = screen.getByTestId("flow-base-edge");
    const edgeClass = edge.getAttribute("data-class") ?? "";
    expect(edgeClass).toContain("stroke-amber-600");
    expect(edgeClass).toContain("stroke-2");
    expect(edgeClass).toContain("[stroke-dasharray:6_4]");
    expect(edge).toHaveAttribute("data-confidence-band", "low");
    expect(edge).toHaveAttribute("data-selected", "false");
    expect(screen.getByTestId("modeling-flow-edge-label")).toHaveTextContent(
      "[inferred · 0.42]"
    );
    expect(screen.getByTestId("modeling-flow-edge-label")).toHaveAttribute(
      "data-confidence-band",
      "low"
    );
  });

  it("uses selected emphasis style for selected edge", () => {
    const edgeProps = {
      id: "rel-2",
      sourceX: 0,
      sourceY: 0,
      targetX: 100,
      targetY: 50,
      sourcePosition: "right",
      targetPosition: "left",
      selected: true,
      data: {
        label: "orders.id = order_items.order_id",
        source: "manual",
        confidence: 0.95
      }
    } as unknown as Parameters<typeof ModelingFlowEdge>[0];

    render(
      <svg>
        <ModelingFlowEdge {...edgeProps} />
      </svg>
    );

    const edge = screen.getByTestId("flow-base-edge");
    const edgeClass = edge.getAttribute("data-class") ?? "";
    expect(edgeClass).toContain("stroke-[var(--action-primary)]");
    expect(edgeClass).toContain("stroke-[2.5]");
    expect(edgeClass).not.toContain("[stroke-dasharray:6_4]");
    expect(edge).toHaveAttribute("data-selected", "true");
  });

  it("renders relationship type marker in edge label when cardinality exists", () => {
    const edgeProps = {
      id: "rel-type",
      sourceX: 0,
      sourceY: 0,
      targetX: 100,
      targetY: 50,
      sourcePosition: "right",
      targetPosition: "left",
      selected: false,
      data: {
        label: "orders.customer_id = customers.id",
        source: "manual",
        confidence: 0.88,
        cardinality: "many-to-one"
      }
    } as unknown as Parameters<typeof ModelingFlowEdge>[0];

    render(
      <svg>
        <ModelingFlowEdge {...edgeProps} />
      </svg>
    );

    expect(screen.getByTestId("modeling-flow-edge-label")).toHaveTextContent(
      "[many-to-one · manual · 0.88]"
    );
  });

  it("marks low-confidence manual edge as dashed warning style", () => {
    const edgeProps = {
      id: "rel-3",
      sourceX: 0,
      sourceY: 0,
      targetX: 100,
      targetY: 50,
      sourcePosition: "right",
      targetPosition: "left",
      selected: false,
      data: {
        label: "orders.id = invoices.order_id",
        source: "manual",
        confidence: 0.32
      }
    } as unknown as Parameters<typeof ModelingFlowEdge>[0];

    render(
      <svg>
        <ModelingFlowEdge {...edgeProps} />
      </svg>
    );

    const edge = screen.getByTestId("flow-base-edge");
    const edgeClass = edge.getAttribute("data-class") ?? "";
    expect(edgeClass).toContain("stroke-amber-600");
    expect(edgeClass).toContain("[stroke-dasharray:6_4]");
    expect(screen.getByTestId("modeling-flow-edge-label")).toHaveAttribute(
      "data-confidence-band",
      "low"
    );
  });

  it("uses invalid style marker for broken relationship edge", () => {
    const edgeProps = {
      id: "rel-invalid",
      sourceX: 0,
      sourceY: 0,
      targetX: 100,
      targetY: 50,
      sourcePosition: "right",
      targetPosition: "left",
      selected: false,
      data: {
        label: "orders.customer_id = missing_table.id",
        source: "manual",
        confidence: 0.5,
        invalid: true
      }
    } as unknown as Parameters<typeof ModelingFlowEdge>[0];

    render(
      <svg>
        <ModelingFlowEdge {...edgeProps} />
      </svg>
    );

    const edge = screen.getByTestId("flow-base-edge");
    const edgeClass = edge.getAttribute("data-class") ?? "";
    expect(edgeClass).toContain("stroke-red-500");
    expect(edgeClass).toContain("[stroke-dasharray:6_4]");
    expect(edge).toHaveAttribute("data-confidence-band", "invalid");
    expect(screen.getByTestId("modeling-flow-edge-label")).toHaveTextContent("[invalid · manual · 0.50]");
  });
});
