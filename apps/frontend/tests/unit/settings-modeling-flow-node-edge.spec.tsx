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
  BaseEdge: ({ style }: { style?: Record<string, unknown> }) => (
    <div data-testid="flow-base-edge" data-style={JSON.stringify(style ?? {})} />
  ),
  EdgeLabelRenderer: ({ children }: { children: unknown }) => <div>{children as never}</div>,
  getBezierPath: () => ["M0,0", 10, 10]
}));

describe("ModelingFlowNode", () => {
  it("renders selected model node with kind marker", () => {
    render(
      <ModelingFlowNode
        {...({
          id: "model.orders",
          data: {
            kind: "model",
            title: "Orders",
            subtitle: "orders",
            columnCount: 12
          },
          selected: true
        } as never)}
      />
    );

    const node = screen.getByTestId("modeling-flow-node");
    expect(node).toHaveAttribute("data-node-kind", "model");
    expect(node.className).toContain("ring-1");
    expect(screen.getByText("model")).toBeInTheDocument();
    expect(screen.getByText("列数 12")).toBeInTheDocument();
  });
});

describe("ModelingFlowEdge", () => {
  it("renders dashed warning edge style for low-confidence inferred relationship", () => {
    render(
      <svg>
        <ModelingFlowEdge
          {...({
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
          } as never)}
        />
      </svg>
    );

    const edge = screen.getByTestId("flow-base-edge");
    const style = JSON.parse(edge.getAttribute("data-style") ?? "{}");
    expect(style.strokeDasharray).toBe("6 4");
    expect(style.stroke).toBe("#d97706");
    expect(screen.getByTestId("modeling-flow-edge-label")).toHaveTextContent(
      "[inferred · 0.42]"
    );
  });

  it("uses selected emphasis style for selected edge", () => {
    render(
      <svg>
        <ModelingFlowEdge
          {...({
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
          } as never)}
        />
      </svg>
    );

    const edge = screen.getByTestId("flow-base-edge");
    const style = JSON.parse(edge.getAttribute("data-style") ?? "{}");
    expect(style.stroke).toBe("var(--action-primary)");
    expect(style.strokeWidth).toBe(2.5);
    expect(style.strokeDasharray).toBeUndefined();
  });
});
