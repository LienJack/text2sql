import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelingGraphPayload } from "@text2sql/shared-types";
import { ModelingFlowCanvas } from "@/components/settings/modeling/modeling-flow-canvas";
import {
  createModelingFlowFieldHandleId,
  createModelingFlowRelationshipHandleId,
  MODELING_FLOW_NODE_FALLBACK_SOURCE_LEFT_HANDLE_ID
} from "@/components/settings/modeling/modeling-flow-node";

const fitViewMock = vi.fn();
const computeElkLayoutMock = vi.fn();

vi.mock("@/components/settings/modeling/layout/elk-layout", () => ({
  computeElkLayout: (...args: unknown[]) => computeElkLayoutMock(...args)
}));

vi.mock("@xyflow/react", () => {
  const applyNodeChanges = (
    changes: Array<Record<string, unknown>>,
    nodes: Array<Record<string, unknown>>
  ) => {
    return nodes.map((node) => {
      const matchedChange = changes.find((change) => change.id === node.id);
      if (!matchedChange) {
        return node;
      }
      if (matchedChange.type === "position" && matchedChange.position) {
        return {
          ...node,
          position: matchedChange.position
        };
      }
      if (matchedChange.type === "select") {
        return {
          ...node,
          selected: matchedChange.selected
        };
      }
      return node;
    });
  };

  const applyEdgeChanges = (
    changes: Array<Record<string, unknown>>,
    edges: Array<Record<string, unknown>>
  ) => {
    return edges.map((edge) => {
      const matchedChange = changes.find((change) => change.id === edge.id);
      if (!matchedChange) {
        return edge;
      }
      if (matchedChange.type === "select") {
        return {
          ...edge,
          selected: matchedChange.selected
        };
      }
      return edge;
    });
  };

  return {
    applyNodeChanges,
    applyEdgeChanges,
    ReactFlow: (props: Record<string, unknown>) => {
      const onInit = props.onInit as ((instance: { fitView: typeof fitViewMock }) => void) | undefined;
      type MockFlowNode = {
        id: string;
        selected?: boolean;
        position?: { x: number; y: number };
        data?: {
          sections?: {
            columns?: string[];
            calculatedFields?: string[];
            relationships?: string[];
          };
          onNodeAction?: (action: {
            type: "addCalculatedField" | "addRelationship" | "editRelationship";
            relationshipId?: string;
          }) => void;
        };
      };
      const nodes =
        (props.nodes as Array<MockFlowNode> | undefined) ?? [];
      const edges =
        (props.edges as Array<{
          id: string;
          selected?: boolean;
          sourceHandle?: string;
          targetHandle?: string;
        }> | undefined) ?? [];
      const onNodeClick = props.onNodeClick as
        | ((event: unknown, node: { id: string }) => void)
        | undefined;
      const onEdgeClick = props.onEdgeClick as
        | ((event: unknown, edge: { id: string }) => void)
        | undefined;
      const onPaneClick = props.onPaneClick as (() => void) | undefined;
      const onNodesChange = props.onNodesChange as
        | ((changes: Array<Record<string, unknown>>) => void)
        | undefined;
      const initOnceRef = React.useRef(false);
      const ordersNode = nodes.find((node) => node.id === "model:model.orders");
      const ordersSections = ordersNode?.data?.sections;
      const firstModelNode = nodes.find((node) => node.id.startsWith("model:"));
      const firstRelationshipId = firstModelNode?.data?.sections?.relationships?.[0];

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
          <button
            type="button"
            onClick={() => {
              if (nodes[0]) {
                onNodesChange?.([
                  {
                    id: nodes[0].id,
                    type: "position",
                    position: { x: 999, y: 888 }
                  }
                ]);
              }
            }}
          >
            trigger-node-drag
          </button>
          <button
            type="button"
            onClick={() => {
              if (nodes[0]) {
                onNodesChange?.([
                  {
                    id: nodes[0].id,
                    type: "position",
                    position: { x: 777, y: 666 },
                    dragging: true
                  }
                ]);
              }
            }}
          >
            trigger-node-dragging
          </button>
          <button
            type="button"
            onClick={() => {
              onPaneClick?.();
            }}
          >
            trigger-pane-click
          </button>
          <button
            type="button"
            onClick={() => {
              firstModelNode?.data?.onNodeAction?.({
                type: "addCalculatedField"
              });
            }}
          >
            trigger-node-add-calculated-field
          </button>
          <button
            type="button"
            onClick={() => {
              firstModelNode?.data?.onNodeAction?.({
                type: "addRelationship"
              });
            }}
          >
            trigger-node-add-relationship
          </button>
          <button
            type="button"
            onClick={() => {
              if (firstRelationshipId) {
                firstModelNode?.data?.onNodeAction?.({
                  type: "editRelationship",
                  relationshipId: firstRelationshipId
                });
              }
            }}
          >
            trigger-node-edit-relationship
          </button>
          <p data-testid="first-node-position">
            {nodes[0]?.position ? `${nodes[0].position.x},${nodes[0].position.y}` : "none"}
          </p>
          <p data-testid="orders-node-columns">{ordersSections?.columns?.join(",") ?? ""}</p>
          <p data-testid="orders-node-calculated-fields">
            {ordersSections?.calculatedFields?.join(",") ?? ""}
          </p>
          <p data-testid="orders-node-relationships">
            {ordersSections?.relationships?.join(",") ?? ""}
          </p>
          <p data-testid="selected-node-ids">
            {nodes
              .filter((node) => node.selected)
              .map((node) => node.id)
              .join(",")}
          </p>
          <p data-testid="selected-edge-ids">
            {edges
              .filter((edge) => edge.selected)
              .map((edge) => edge.id)
              .join(",")}
          </p>
          <p data-testid="first-edge-handles">
            {edges[0] ? `${edges[0].sourceHandle ?? ""}->${edges[0].targetHandle ?? ""}` : "none"}
          </p>
          <p data-testid="edge-handle-map">
            {edges
              .map(
                (edge) =>
                  `${edge.id}:${edge.sourceHandle ?? ""}->${edge.targetHandle ?? ""}`
              )
              .join("|")}
          </p>
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

const positionedGraphPayload: ModelingGraphPayload = {
  ...baseGraphPayload,
  models: baseGraphPayload.models.map((model) =>
    model.id === "model.customers"
      ? { ...model, position: { x: 132, y: 264 } }
      : { ...model, position: { x: 420, y: 280 } }
  ),
  views: baseGraphPayload.views.map((view) => ({
    ...view,
    position: { x: 720, y: 360 }
  }))
};

describe("ModelingFlowCanvas", () => {
  beforeEach(() => {
    fitViewMock.mockClear();
    computeElkLayoutMock.mockReset();
    computeElkLayoutMock.mockResolvedValue({
      ok: true,
      elapsedMs: 120,
      positions: {
        "model:model.customers": { x: 360, y: 220 },
        "model:model.orders": { x: 40, y: 20 },
        "view:view.daily_orders": { x: 720, y: 340 }
      }
    });
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

    await waitFor(() => {
      expect(fitViewMock).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByRole("button", { name: "trigger-node-click" }));
    expect(onSelectNode).toHaveBeenCalledWith({ kind: "model", id: "model.customers" });

    await user.click(screen.getByRole("button", { name: "trigger-edge-click" }));
    expect(onSelectNode).toHaveBeenCalledWith({ kind: "relationship", id: "rel-orders-customers" });

    await user.click(screen.getByRole("button", { name: "trigger-pane-click" }));
    expect(onSelectNode).toHaveBeenCalledWith(null);

    await user.click(screen.getByRole("button", { name: "画布适配视图" }));
    expect(fitViewMock).toHaveBeenCalledTimes(2);
  });

  it("applies one-click auto layout and keeps selection/edit flow available", async () => {
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

    await waitFor(() => {
      expect(screen.getByTestId("first-node-position")).toHaveTextContent("0,0");
    });

    await user.click(screen.getByRole("button", { name: "自动布局画布" }));

    await waitFor(() => {
      expect(screen.getByTestId("first-node-position")).toHaveTextContent("360,220");
      expect(screen.getByText("Auto Layout 完成（120ms）。")).toBeInTheDocument();
    });
    expect(computeElkLayoutMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "trigger-node-click" }));
    expect(onSelectNode).toHaveBeenCalledWith({ kind: "model", id: "model.customers" });
  });

  it("prefers persisted payload positions over default grid fallback", async () => {
    render(
      <ModelingFlowCanvas
        graphPayload={positionedGraphPayload}
        selectedNode={null}
        autoLayoutKey="ws:ds:positioned"
        onSelectNode={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("first-node-position")).toHaveTextContent("132,264");
    });
  });

  it("maps missing nodeSections to fallback columns/calculated fields/relationships", async () => {
    const payloadWithoutNodeSections: ModelingGraphPayload = {
      ...baseGraphPayload,
      calculatedFields: [
        {
          id: "cf-1",
          modelId: "model.orders",
          name: "order_total",
          expression: "price * qty",
          dataType: "number"
        },
        {
          id: "cf-2",
          modelId: "model.orders",
          name: "discount_total",
          expression: "discount",
          dataType: "number"
        },
        {
          id: "cf-3",
          modelId: "model.orders",
          name: "tax_total",
          expression: "tax",
          dataType: "number"
        },
        {
          id: "cf-4",
          modelId: "model.orders",
          name: "net_total",
          expression: "price-tax",
          dataType: "number"
        }
      ],
      relationships: [
        {
          id: "rel-orders-customers-1",
          source: "manual",
          confidence: 0.9,
          bridge: {
            left: { dataset: "analytics", table: "orders", column: "customer_id" },
            right: { dataset: "analytics", table: "customers", column: "id" },
            operator: "eq",
            confidence: 0.9
          }
        },
        {
          id: "rel-orders-customers-2",
          source: "manual",
          confidence: 0.88,
          bridge: {
            left: { dataset: "analytics", table: "orders", column: "sales_rep_id" },
            right: { dataset: "analytics", table: "customers", column: "owner_id" },
            operator: "eq",
            confidence: 0.88
          }
        },
        {
          id: "rel-orders-customers-3",
          source: "manual",
          confidence: 0.8,
          bridge: {
            left: { dataset: "analytics", table: "orders", column: "invoice_owner_id" },
            right: { dataset: "analytics", table: "customers", column: "billing_owner_id" },
            operator: "eq",
            confidence: 0.8
          }
        }
      ]
    };

    render(
      <ModelingFlowCanvas
        graphPayload={payloadWithoutNodeSections}
        selectedNode={null}
        autoLayoutKey="ws:ds:fallback"
        onSelectNode={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("orders-node-columns")).toHaveTextContent("id");
      expect(screen.getByTestId("orders-node-calculated-fields")).toHaveTextContent(
        "order_total,discount_total,tax_total,net_total"
      );
      expect(screen.getByTestId("orders-node-relationships")).toHaveTextContent(
        "rel-orders-customers-1,rel-orders-customers-2,rel-orders-customers-3"
      );
    });
  });

  it("limits column preview to five items and prioritizes primary keys", async () => {
    const payloadWithManyColumns: ModelingGraphPayload = {
      ...baseGraphPayload,
      models: [
        {
          ...baseGraphPayload.models[0],
          columns: [
            { name: "created_at", dataType: "timestamp", isNullable: false, isPrimaryKey: false },
            { name: "order_no", dataType: "varchar", isNullable: false, isPrimaryKey: false },
            { name: "id", dataType: "int", isNullable: false, isPrimaryKey: true },
            { name: "merchant_id", dataType: "int", isNullable: false, isPrimaryKey: false },
            { name: "status", dataType: "varchar", isNullable: false, isPrimaryKey: false },
            { name: "total_amount", dataType: "decimal", isNullable: false, isPrimaryKey: false },
            { name: "paid_at", dataType: "timestamp", isNullable: true, isPrimaryKey: false }
          ],
          nodeSections: {
            columns: [
              "created_at",
              "order_no",
              "id",
              "merchant_id",
              "status",
              "total_amount",
              "paid_at"
            ],
            calculatedFields: [],
            relationships: []
          }
        },
        baseGraphPayload.models[1]
      ]
    };

    render(
      <ModelingFlowCanvas
        graphPayload={payloadWithManyColumns}
        selectedNode={null}
        autoLayoutKey="ws:ds:column-preview-limit"
        onSelectNode={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("orders-node-columns")).toHaveTextContent(
        "id,created_at,order_no,merchant_id,status"
      );
    });
  });

  it("binds relationship edges to matching relationship-row handles", async () => {
    const payloadWithJoinColumns: ModelingGraphPayload = {
      ...baseGraphPayload,
      models: [
        {
          ...baseGraphPayload.models[0],
          columns: [
            { name: "id", dataType: "int", isNullable: false, isPrimaryKey: true },
            { name: "customer_id", dataType: "int", isNullable: false, isPrimaryKey: false }
          ]
        },
        baseGraphPayload.models[1]
      ]
    };

    render(
      <ModelingFlowCanvas
        graphPayload={payloadWithJoinColumns}
        selectedNode={null}
        autoLayoutKey="ws:ds:field-handle"
        onSelectNode={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("first-edge-handles")).toHaveTextContent(
        `${createModelingFlowRelationshipHandleId("rel-orders-customers", "left")}->${createModelingFlowRelationshipHandleId("rel-orders-customers", "right")}`
      );
    });
  });

  it("maps relationship-row labels to relationship ids for edge binding", async () => {
    const payloadWithRelationshipLabelRows: ModelingGraphPayload = {
      ...baseGraphPayload,
      models: baseGraphPayload.models.map((model) => {
        if (model.id === "model.orders") {
          return {
            ...model,
            nodeSections: {
              columns: ["id"],
              calculatedFields: [],
              relationships: ["customers"]
            }
          };
        }
        if (model.id === "model.customers") {
          return {
            ...model,
            nodeSections: {
              columns: ["id"],
              calculatedFields: [],
              relationships: ["orders"]
            }
          };
        }
        return model;
      }),
      relationships: baseGraphPayload.relationships.map((relationship) => ({
        ...relationship,
        name: "orders_customers_relation"
      }))
    };

    render(
      <ModelingFlowCanvas
        graphPayload={payloadWithRelationshipLabelRows}
        selectedNode={null}
        autoLayoutKey="ws:ds:relationship-label-row-binding"
        onSelectNode={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("first-edge-handles")).toHaveTextContent(
        `${createModelingFlowRelationshipHandleId("rel-orders-customers", "left")}->${createModelingFlowRelationshipHandleId("rel-orders-customers", "right")}`
      );
    });
  });

  it("falls back per endpoint when field/relationship row handle is unavailable", async () => {
    const payloadWithoutRelationshipRows: ModelingGraphPayload = {
      ...baseGraphPayload,
      models: baseGraphPayload.models.map((model) => ({
        ...model,
        nodeSections: {
          columns: model.columns.map((column) => column.name),
          calculatedFields: [],
          relationships: []
        }
      }))
    };

    render(
      <ModelingFlowCanvas
        graphPayload={payloadWithoutRelationshipRows}
        selectedNode={null}
        autoLayoutKey="ws:ds:fallback-handle"
        onSelectNode={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("first-edge-handles")).toHaveTextContent(
        `${MODELING_FLOW_NODE_FALLBACK_SOURCE_LEFT_HANDLE_ID}->${createModelingFlowFieldHandleId("id", "right")}`
      );
    });
  });

  it("emits latest model/view positions after auto layout and drag", async () => {
    const user = userEvent.setup();
    const onNodePositionsChange = vi.fn();

    render(
      <ModelingFlowCanvas
        graphPayload={baseGraphPayload}
        selectedNode={null}
        autoLayoutKey="ws:ds:emit"
        onSelectNode={vi.fn()}
        onNodePositionsChange={onNodePositionsChange}
      />
    );

    await user.click(screen.getByRole("button", { name: "自动布局画布" }));

    await waitFor(() => {
      expect(onNodePositionsChange).toHaveBeenCalledWith(
        expect.objectContaining({
          models: expect.objectContaining({
            "model.customers": { x: 360, y: 220 },
            "model.orders": { x: 40, y: 20 }
          }),
          views: expect.objectContaining({
            "view.daily_orders": { x: 720, y: 340 }
          })
        })
      );
    });

    await user.click(screen.getByRole("button", { name: "trigger-node-drag" }));

    await waitFor(() => {
      expect(onNodePositionsChange).toHaveBeenCalledWith(
        expect.objectContaining({
          models: expect.objectContaining({
            "model.customers": { x: 999, y: 888 }
          })
        })
      );
    });
  });

  it("does not emit position patch for dragging-in-progress node updates", async () => {
    const user = userEvent.setup();
    const onNodePositionsChange = vi.fn();

    render(
      <ModelingFlowCanvas
        graphPayload={baseGraphPayload}
        selectedNode={null}
        autoLayoutKey="ws:ds:dragging-frame"
        onSelectNode={vi.fn()}
        onNodePositionsChange={onNodePositionsChange}
      />
    );

    await user.click(screen.getByRole("button", { name: "trigger-node-dragging" }));

    expect(onNodePositionsChange).not.toHaveBeenCalled();
  });

  it("dispatches node action events to page-layer handler", async () => {
    const user = userEvent.setup();
    const onNodeAction = vi.fn();
    const canvasProps = {
      graphPayload: baseGraphPayload,
      selectedNode: null,
      autoLayoutKey: "ws:ds:node-action",
      onSelectNode: vi.fn(),
      onNodeAction
    } as unknown as Parameters<typeof ModelingFlowCanvas>[0];

    render(<ModelingFlowCanvas {...canvasProps} />);

    await user.click(screen.getByRole("button", { name: "trigger-node-add-calculated-field" }));
    await user.click(screen.getByRole("button", { name: "trigger-node-add-relationship" }));
    await user.click(screen.getByRole("button", { name: "trigger-node-edit-relationship" }));

    expect(onNodeAction).toHaveBeenNthCalledWith(1, {
      modelId: "model.customers",
      action: {
        type: "addCalculatedField"
      }
    });
    expect(onNodeAction).toHaveBeenNthCalledWith(2, {
      modelId: "model.customers",
      action: {
        type: "addRelationship"
      }
    });
    expect(onNodeAction).toHaveBeenNthCalledWith(3, {
      modelId: "model.customers",
      action: {
        type: "editRelationship",
        relationshipId: "rel-orders-customers"
      }
    });
  });

  it("keeps previous positions and shows non-blocking warning when auto layout fails", async () => {
    const user = userEvent.setup();
    computeElkLayoutMock.mockResolvedValueOnce({
      ok: false,
      reason: "timeout",
      message: "timeout",
      elapsedMs: 2000
    });

    render(
      <ModelingFlowCanvas
        graphPayload={baseGraphPayload}
        selectedNode={null}
        autoLayoutKey="ws:ds:1"
        onSelectNode={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("first-node-position")).toHaveTextContent("0,0");
    });

    await user.click(screen.getByRole("button", { name: "自动布局画布" }));

    await waitFor(() => {
      expect(screen.getByText("Auto Layout 超时，已保留当前画布位置。")).toBeInTheDocument();
      expect(screen.getByTestId("first-node-position")).toHaveTextContent("0,0");
    });
  });

  it("discards stale layout result when autoLayoutKey changes during async execution", async () => {
    const user = userEvent.setup();
    let resolveLayout: ((value: unknown) => void) | undefined;
    computeElkLayoutMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLayout = resolve;
        })
    );

    const { rerender } = render(
      <ModelingFlowCanvas
        graphPayload={baseGraphPayload}
        selectedNode={null}
        autoLayoutKey="ws:ds:1"
        onSelectNode={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("first-node-position")).toHaveTextContent("0,0");
    });

    await user.click(screen.getByRole("button", { name: "自动布局画布" }));

    rerender(
      <ModelingFlowCanvas
        graphPayload={baseGraphPayload}
        selectedNode={null}
        autoLayoutKey="ws:ds:2"
        onSelectNode={vi.fn()}
      />
    );

    resolveLayout?.({
      ok: true,
      elapsedMs: 300,
      positions: {
        "model:model.customers": { x: 500, y: 500 }
      }
    });

    await waitFor(() => {
      expect(screen.getByTestId("first-node-position")).toHaveTextContent("0,0");
    });
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
      screen.getByText(/检测到 1 条 relationship 无法完整映射到 model 节点/)
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

  it("disables auto layout action when graph has only one node", async () => {
    const singleNodePayload: ModelingGraphPayload = {
      ...baseGraphPayload,
      models: [baseGraphPayload.models[0]],
      views: [],
      relationships: []
    };
    render(
      <ModelingFlowCanvas
        graphPayload={singleNodePayload}
        selectedNode={null}
        autoLayoutKey="ws:ds:single"
        onSelectNode={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "自动布局画布" })).toBeDisabled();
    });
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

  it("keeps dragged node position and selected edge highlight after re-render", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ModelingFlowCanvas
        graphPayload={baseGraphPayload}
        selectedNode={null}
        autoLayoutKey="ws:ds:1"
        onSelectNode={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("first-node-position")).toHaveTextContent("0,0");
    });
    await user.click(screen.getByRole("button", { name: "trigger-node-drag" }));

    await waitFor(() => {
      expect(screen.getByTestId("first-node-position")).toHaveTextContent("999,888");
    });
    await waitFor(() => {
      expect(fitViewMock).toHaveBeenCalledTimes(1);
    });

    rerender(
      <ModelingFlowCanvas
        graphPayload={baseGraphPayload}
        selectedNode={{ kind: "relationship", id: "rel-orders-customers" }}
        autoLayoutKey="ws:ds:1"
        onSelectNode={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("first-node-position")).toHaveTextContent("999,888");
      expect(screen.getByTestId("selected-edge-ids")).toHaveTextContent("rel-orders-customers");
    });
    await waitFor(() => {
      expect(fitViewMock).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps selected model node when graph payload updates", async () => {
    const selectedModel = { kind: "model", id: "model.orders" } as const;
    const { rerender } = render(
      <ModelingFlowCanvas
        graphPayload={baseGraphPayload}
        selectedNode={selectedModel}
        autoLayoutKey="ws:ds:selection"
        onSelectNode={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("selected-node-ids")).toHaveTextContent("model:model.orders");
    });

    const payloadUpdate: ModelingGraphPayload = {
      ...baseGraphPayload,
      calculatedFields: [
        {
          id: "cf-new",
          modelId: "model.orders",
          name: "order_total",
          expression: "price * qty",
          dataType: "number"
        }
      ]
    };

    rerender(
      <ModelingFlowCanvas
        graphPayload={payloadUpdate}
        selectedNode={selectedModel}
        autoLayoutKey="ws:ds:selection"
        onSelectNode={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("orders-node-calculated-fields")).toHaveTextContent("order_total");
      expect(screen.getByTestId("selected-node-ids")).toHaveTextContent("model:model.orders");
    });
  });
});
