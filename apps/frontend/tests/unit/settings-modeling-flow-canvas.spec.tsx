import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelingGraphPayload } from "@text2sql/shared-types";
import { ModelingFlowCanvas } from "@/components/settings/modeling/modeling-flow-canvas";

const fitViewMock = vi.fn();

vi.mock("@xyflow/react", () => {
  return {
    ReactFlow: (props: Record<string, unknown>) => {
      const onInit = props.onInit as ((instance: { fitView: typeof fitViewMock }) => void) | undefined;
      const nodes = (props.nodes as Array<{ id: string }> | undefined) ?? [];
      const edges = (props.edges as Array<{ id: string }> | undefined) ?? [];
      const onNodeClick = props.onNodeClick as
        | ((event: unknown, node: { id: string }) => void)
        | undefined;
      const onEdgeClick = props.onEdgeClick as
        | ((event: unknown, edge: { id: string }) => void)
        | undefined;
      const initOnceRef = React.useRef(false);

      React.useEffect(() => {
        if (initOnceRef.current) {
          return;
        }
        initOnceRef.current = true;
        onInit?.({ fitView: fitViewMock });
      }, [onInit]);

      return (
        <div data-testid="mock-react-flow">
          <button
            type="button"
            onClick={() => {
              if (nodes[0]) {
                onNodeClick?.({}, nodes[0]);
              }
            }}
          >
            trigger-node-click
          </button>
          <button
            type="button"
            onClick={() => {
              if (edges[0]) {
                onEdgeClick?.({}, edges[0]);
              }
            }}
          >
            trigger-edge-click
          </button>
        </div>
      );
    },
    Background: () => <div data-testid="flow-background" />,
    MiniMap: () => <div data-testid="flow-minimap" />,
    Controls: () => <div data-testid="flow-controls" />,
    Handle: () => null,
    Position: {
      Left: "left",
      Right: "right"
    },
    BaseEdge: ({ style }: { style?: Record<string, unknown> }) => (
      <div data-testid="flow-base-edge" data-style={JSON.stringify(style ?? {})} />
    ),
    EdgeLabelRenderer: ({ children }: { children: unknown }) => <div>{children as never}</div>,
    getBezierPath: () => ["M0,0", 20, 20]
  };
});

const baseGraphPayload: ModelingGraphPayload = {
  models: [
    {
      id: "model.orders",
      tableName: "orders",
      modelName: "orders",
      displayName: "Orders",
      description: null,
      columns: [{ name: "id", dataType: "int", isNullable: false, isPrimaryKey: true }]
    },
    {
      id: "model.customers",
      tableName: "customers",
      modelName: "customers",
      displayName: "Customers",
      description: null,
      columns: [{ name: "id", dataType: "int", isNullable: false, isPrimaryKey: true }]
    }
  ],
  relationships: [
    {
      id: "rel-orders-customers",
      source: "manual",
      confidence: 0.9,
      bridge: {
        left: { dataset: "analytics", table: "orders", column: "customer_id" },
        right: { dataset: "analytics", table: "customers", column: "id" },
        operator: "eq",
        confidence: 0.9
      }
    }
  ],
  calculatedFields: [],
  views: [
    {
      id: "view.daily_orders",
      name: "daily_orders",
      sql: "select * from orders",
      displayName: "Daily Orders",
      description: null
    }
  ],
  schemaChanges: []
};

describe("ModelingFlowCanvas", () => {
  beforeEach(() => {
    fitViewMock.mockClear();
    Object.defineProperty(window, "ResizeObserver", {
      writable: true,
      configurable: true,
      value: class ResizeObserver {
        observe() {
          return undefined;
        }
        unobserve() {
          return undefined;
        }
        disconnect() {
          return undefined;
        }
      }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders graph nodes and edges, and supports node/edge selection", async () => {
    const user = userEvent.setup();
    const onSelectNode = vi.fn();

    render(
      <ModelingFlowCanvas
        graphPayload={baseGraphPayload}
        selectedNode={null}
        autoLayoutKey="ws:ds:1"
        onSelectNode={onSelectNode}
      />
    );

    expect(screen.getByText("Nodes 3 · Edges 1")).toBeInTheDocument();
    await waitFor(() => {
      expect(fitViewMock).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByRole("button", { name: "trigger-node-click" }));
    expect(onSelectNode).toHaveBeenCalledWith({ kind: "model", id: "model.customers" });

    await user.click(screen.getByRole("button", { name: "trigger-edge-click" }));
    expect(onSelectNode).toHaveBeenCalledWith({ kind: "relationship", id: "rel-orders-customers" });

    await user.click(screen.getByRole("button", { name: "画布适配视图" }));
    expect(fitViewMock).toHaveBeenCalledTimes(2);
  });

  it("shows recoverable invalid-relationship warning instead of crashing", () => {
    const graphWithInvalidRelationship: ModelingGraphPayload = {
      ...baseGraphPayload,
      relationships: [
        {
          id: "rel-invalid",
          source: "manual",
          confidence: 0.5,
          bridge: {
            left: { dataset: "analytics", table: "orders", column: "customer_id" },
            right: { dataset: "analytics", table: "missing_table", column: "id" },
            operator: "eq",
            confidence: 0.5
          }
        }
      ]
    };

    render(
      <ModelingFlowCanvas
        graphPayload={graphWithInvalidRelationship}
        selectedNode={null}
        autoLayoutKey="ws:ds:1"
        onSelectNode={vi.fn()}
      />
    );

    expect(
      screen.getByText(/检测到 1 条 relationship 无法映射到 model 节点/)
    ).toBeInTheDocument();
  });

  it("renders empty guidance when graph has no nodes", () => {
    render(
      <ModelingFlowCanvas
        graphPayload={{
          models: [],
          relationships: [],
          calculatedFields: [],
          views: [],
          schemaChanges: []
        }}
        selectedNode={null}
        autoLayoutKey="ws:ds:none"
        onSelectNode={vi.fn()}
      />
    );

    expect(
      screen.getByText("暂无可渲染节点。请先在数据源 setup 中导入表，或在建模页创建 model/view 资产。")
    ).toBeInTheDocument();
  });

  it("re-runs auto-fit when autoLayoutKey changes", async () => {
    const { rerender } = render(
      <ModelingFlowCanvas
        graphPayload={baseGraphPayload}
        selectedNode={null}
        autoLayoutKey="ws:ds:1"
        onSelectNode={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(fitViewMock).toHaveBeenCalledTimes(1);
    });

    rerender(
      <ModelingFlowCanvas
        graphPayload={baseGraphPayload}
        selectedNode={null}
        autoLayoutKey="ws:ds:2"
        onSelectNode={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(fitViewMock).toHaveBeenCalledTimes(2);
    });
  });
});
