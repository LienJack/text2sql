import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    markerStart,
    markerEnd,
    style,
    onMouseEnter,
    onMouseLeave,
    ...props
  }: {
    className?: string;
    markerStart?: string;
    markerEnd?: string;
    style?: Record<string, unknown>;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
    "data-confidence-band"?: string;
    "data-selected"?: string;
    "data-visual-state"?: string;
  }) => (
    <div
      data-testid="flow-base-edge"
      data-class={className ?? ""}
      data-style={JSON.stringify(style ?? {})}
      data-marker-start={markerStart ?? ""}
      data-marker-end={markerEnd ?? ""}
      data-confidence-band={props["data-confidence-band"]}
      data-selected={props["data-selected"]}
      data-visual-state={props["data-visual-state"]}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    />
  ),
  EdgeLabelRenderer: ({ children }: { children: unknown }) => <div>{children as never}</div>,
  getBezierPath: () => ["M0,0", 10, 10],
  getSmoothStepPath: () => ["M0,0", 10, 10]
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
          calculatedFields: ["order_total", "order_bucket", "net_revenue", "margin_rate"],
          relationships: [
            "rel-orders-customers",
            "rel-orders-items",
            "rel-orders-payments",
            "rel-orders-shipments"
          ]
        },
        relationshipDisplayMeta: [
          {
            primaryText: "customers",
            secondaryText: "orders_to_customers"
          },
          {
            primaryText: "order_items",
            secondaryText: "orders_to_items"
          },
          {
            primaryText: "payments",
            secondaryText: "orders_to_payments"
          },
          {
            primaryText: "shipments",
            secondaryText: "orders_to_shipments"
          }
        ]
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
    expect(screen.getByLabelText("Orders 节点菜单")).toBeInTheDocument();
    expect(screen.getByText("Columns")).toBeInTheDocument();
    expect(screen.getByText("Calculated Fields")).toBeInTheDocument();
    expect(screen.getByText("Relationships")).toBeInTheDocument();
    const columnsSection = screen.getByTestId("modeling-flow-node-section-columns-items");
    expect(within(columnsSection).getByText("id")).toBeInTheDocument();
    expect(within(columnsSection).getByText("order_no")).toBeInTheDocument();
    expect(within(columnsSection).getByText("customer_id")).toBeInTheDocument();
    const calculatedFieldsSection = screen.getByTestId(
      "modeling-flow-node-section-calculatedFields-items"
    );
    expect(within(calculatedFieldsSection).getByText("order_total")).toBeInTheDocument();
    expect(within(calculatedFieldsSection).getByText("order_bucket")).toBeInTheDocument();
    expect(within(calculatedFieldsSection).getByText("net_revenue")).toBeInTheDocument();
    expect(within(calculatedFieldsSection).getByText("margin_rate")).toBeInTheDocument();
    expect(within(calculatedFieldsSection).getAllByRole("listitem")).toHaveLength(4);

    const relationshipsSection = screen.getByTestId(
      "modeling-flow-node-section-relationships-items"
    );
    expect(within(relationshipsSection).getByText("customers")).toBeInTheDocument();
    expect(within(relationshipsSection).getByText("order_items")).toBeInTheDocument();
    expect(within(relationshipsSection).getByText("payments")).toBeInTheDocument();
    expect(within(relationshipsSection).getByText("shipments")).toBeInTheDocument();
    const firstRelationshipItem = within(relationshipsSection).getByText("customers").closest("li");
    expect(firstRelationshipItem).toHaveAttribute("title", "customers · orders_to_customers");
    expect(within(relationshipsSection).getAllByRole("listitem")).toHaveLength(4);
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

  it("renders placeholder for empty calculated fields and relationships", () => {
    const nodeProps = {
      id: "model.empty-sections",
      data: {
        kind: "model",
        title: "Empty Sections Model",
        subtitle: "empty_sections",
        columnCount: 1,
        sections: {
          columns: ["id"],
          calculatedFields: [],
          relationships: []
        }
      },
      selected: false
    } as unknown as Parameters<typeof ModelingFlowNode>[0];

    render(
      <ModelingFlowNode {...nodeProps} />
    );

    expect(
      screen.getByTestId("modeling-flow-node-section-calculatedFields-items")
    ).toHaveTextContent("—");
    expect(
      screen.getByTestId("modeling-flow-node-section-relationships-items")
    ).toHaveTextContent("—");
  });

  it("supports Enter/Space keyboard triggers for add and relationship entry actions", async () => {
    const user = userEvent.setup();
    const onNodeAction = vi.fn();
    const nodeProps = {
      id: "model.orders",
      data: {
        kind: "model",
        title: "Orders",
        subtitle: "orders",
        sections: {
          columns: ["id", "order_no"],
          calculatedFields: ["order_total"],
          relationships: ["rel-orders-customers"]
        },
        relationshipDisplayMeta: [
          {
            primaryText: "customers",
            secondaryText: "orders_to_customers"
          }
        ],
        relationshipActionIds: ["rel-orders-customers"],
        onNodeAction
      },
      selected: false
    } as unknown as Parameters<typeof ModelingFlowNode>[0];

    render(
      <ModelingFlowNode {...nodeProps} />
    );

    const addCalculatedFieldButton = screen.getByTestId(
      "modeling-flow-node-action-add-calculated-field"
    );
    const addRelationshipButton = screen.getByTestId("modeling-flow-node-action-add-relationship");
    const editRelationshipButton = screen.getByTestId(
      "modeling-flow-node-action-edit-relationship-rel-orders-customers"
    );

    expect(addCalculatedFieldButton).toHaveAttribute(
      "aria-label",
      "为 Orders 新增 Calculated Field"
    );
    expect(addRelationshipButton).toHaveAttribute("aria-label", "为 Orders 新增 Relationship");
    expect(editRelationshipButton).toHaveAttribute(
      "aria-label",
      "编辑 Orders 的 Relationship customers"
    );

    addCalculatedFieldButton.focus();
    await user.keyboard("{Enter}");

    addRelationshipButton.focus();
    await user.keyboard(" ");

    editRelationshipButton.focus();
    await user.keyboard("{Enter}");

    expect(onNodeAction).toHaveBeenCalledTimes(3);
    expect(onNodeAction).toHaveBeenNthCalledWith(1, { type: "addCalculatedField" });
    expect(onNodeAction).toHaveBeenNthCalledWith(2, { type: "addRelationship" });
    expect(onNodeAction).toHaveBeenNthCalledWith(3, {
      type: "editRelationship",
      relationshipId: "rel-orders-customers"
    });
  });

  it("highlights relationship rows when selected relationship ids are provided", () => {
    const nodeProps = {
      id: "model.orders",
      data: {
        kind: "model",
        title: "Orders",
        subtitle: "orders",
        sections: {
          columns: ["id"],
          calculatedFields: [],
          relationships: ["rel-orders-customers", "rel-orders-invoices"]
        },
        relationshipDisplayMeta: [
          {
            primaryText: "customers"
          },
          {
            primaryText: "invoices"
          }
        ],
        relationshipActionIds: ["rel-orders-customers", "rel-orders-invoices"],
        highlightedRelationshipIds: ["rel-orders-customers"]
      },
      selected: false
    } as unknown as Parameters<typeof ModelingFlowNode>[0];

    render(<ModelingFlowNode {...nodeProps} />);

    const customersRow = screen.getByText("customers").closest("li");
    const invoicesRow = screen.getByText("invoices").closest("li");
    expect(customersRow).toHaveAttribute("data-relationship-highlighted", "true");
    expect(invoicesRow).toHaveAttribute("data-relationship-highlighted", "false");
  });

  it("keeps action buttons disabled-safe and ignores keyboard triggers when actions are disabled", async () => {
    const user = userEvent.setup();
    const onNodeAction = vi.fn();
    const nodeProps = {
      id: "model.orders",
      data: {
        kind: "model",
        title: "Orders",
        subtitle: "orders",
        actionsDisabled: true,
        sections: {
          columns: ["id", "order_no"],
          calculatedFields: ["order_total"],
          relationships: ["rel-orders-customers"]
        },
        relationshipDisplayMeta: [
          {
            primaryText: "customers",
            secondaryText: "orders_to_customers"
          }
        ],
        relationshipActionIds: ["rel-orders-customers"],
        onNodeAction
      },
      selected: false
    } as unknown as Parameters<typeof ModelingFlowNode>[0];

    render(
      <ModelingFlowNode {...nodeProps} />
    );

    const addCalculatedFieldButton = screen.getByTestId(
      "modeling-flow-node-action-add-calculated-field"
    );
    const addRelationshipButton = screen.getByTestId("modeling-flow-node-action-add-relationship");
    const editRelationshipButton = screen.getByTestId(
      "modeling-flow-node-action-edit-relationship-rel-orders-customers"
    );

    expect(addCalculatedFieldButton).toBeDisabled();
    expect(addRelationshipButton).toBeDisabled();
    expect(editRelationshipButton).toBeDisabled();

    addCalculatedFieldButton.focus();
    await user.keyboard("{Enter}");
    addRelationshipButton.focus();
    await user.keyboard(" ");
    editRelationshipButton.focus();
    await user.keyboard("{Enter}");

    expect(onNodeAction).not.toHaveBeenCalled();
  });
});

describe("ModelingFlowEdge", () => {
  it("renders dashed warning edge style for low-confidence inferred relationship", async () => {
    const user = userEvent.setup();
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
        confidence: 0.42,
        from: {
          dataset: "olist_orders_dataset",
          table: "orders",
          column: "customer_id"
        },
        to: {
          dataset: "olist_customers_dataset",
          table: "customers",
          column: "id"
        }
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
    expect(edge).toHaveAttribute("data-visual-state", "inferred-or-low-confidence");
    expect(edge).toHaveAttribute("data-marker-start", "");
    expect(edge).toHaveAttribute("data-marker-end", "");
    expect(screen.queryByTestId("modeling-flow-edge-hover-card")).not.toBeInTheDocument();

    await user.hover(edge);
    expect(screen.getByTestId("modeling-flow-edge-hover-card")).toBeInTheDocument();
    expect(screen.getByText("Relationship")).toBeInTheDocument();
    expect(screen.getByText("olist_orders_dataset.orders.customer_id")).toBeInTheDocument();
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
    expect(edgeClass).toContain("stroke-[2.7]");
    expect(screen.getByTestId("modeling-flow-edge-hover-card")).toBeInTheDocument();
    expect(screen.getByText("Description")).toBeInTheDocument();
    expect(screen.getAllByText("-").length).toBeGreaterThan(0);
    expect(edgeClass).not.toContain("[stroke-dasharray:6_4]");
    expect(edge).toHaveAttribute("data-selected", "true");
    expect(edge).toHaveAttribute("data-visual-state", "selected-relationship");
  });

  it("renders one/many markers based on relationship cardinality", async () => {
    const user = userEvent.setup();
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

    const edge = screen.getByTestId("flow-base-edge");
    expect(screen.getByTestId("modeling-flow-edge-source-cardinality")).toHaveTextContent("N");
    expect(screen.getByTestId("modeling-flow-edge-target-cardinality")).toHaveTextContent("1");

    await user.hover(edge);
    expect(screen.getByTestId("modeling-flow-edge-hover-card")).toBeInTheDocument();
    expect(screen.getByText(/1对多 \(Many-to-one\)/)).toBeInTheDocument();
  });

  it("renders many-to-many relationship label when cardinality is many-to-many", async () => {
    const user = userEvent.setup();
    const edgeProps = {
      id: "rel-many-to-many",
      sourceX: 0,
      sourceY: 0,
      targetX: 100,
      targetY: 50,
      sourcePosition: "right",
      targetPosition: "left",
      selected: false,
      data: {
        label: "orders_items.product_id = products.id",
        source: "manual",
        confidence: 0.9,
        cardinality: "many-to-many"
      }
    } as unknown as Parameters<typeof ModelingFlowEdge>[0];

    render(
      <svg>
        <ModelingFlowEdge {...edgeProps} />
      </svg>
    );

    expect(screen.getByTestId("modeling-flow-edge-source-cardinality")).toHaveTextContent("N");
    expect(screen.getByTestId("modeling-flow-edge-target-cardinality")).toHaveTextContent("N");

    const edge = screen.getByTestId("flow-base-edge");
    await user.hover(edge);
    expect(screen.getByText("多对多 (Many-to-many)")).toBeInTheDocument();
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
  });

  it("uses invalid style marker for broken relationship edge", async () => {
    const user = userEvent.setup();
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
    expect(edgeClass).toContain("stroke-red-600");
    expect(edgeClass).toContain("stroke-[2.8]");
    expect(edgeClass).toContain("[stroke-dasharray:6_4]");
    expect(edge).toHaveAttribute("data-confidence-band", "invalid");
    expect(edge).toHaveAttribute("data-visual-state", "invalid");

    await user.hover(edge);
    expect(screen.getByTestId("modeling-flow-edge-hover-card")).toBeInTheDocument();
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  it("uses soft incident style when selected model highlights an edge", () => {
    const edgeProps = {
      id: "rel-selected-model-incident",
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
        confidence: 0.92,
        highlightedBySelectedModel: true
      }
    } as unknown as Parameters<typeof ModelingFlowEdge>[0];

    render(
      <svg>
        <ModelingFlowEdge {...edgeProps} />
      </svg>
    );

    const edge = screen.getByTestId("flow-base-edge");
    const edgeClass = edge.getAttribute("data-class") ?? "";
    expect(edgeClass).toContain("stroke-slate-400");
    expect(edgeClass).toContain("stroke-[2.1]");
    expect(edgeClass).toContain("[stroke-dasharray:6_4]");
    expect(edge).toHaveAttribute("data-visual-state", "selected-model-incident");
  });

  it("keeps invalid edge priority above selected-relationship style", () => {
    const edgeProps = {
      id: "rel-invalid-selected",
      sourceX: 0,
      sourceY: 0,
      targetX: 100,
      targetY: 50,
      sourcePosition: "right",
      targetPosition: "left",
      selected: true,
      data: {
        label: "orders.customer_id = missing.id",
        source: "inferred",
        confidence: 0.12,
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
    expect(edgeClass).toContain("stroke-red-600");
    expect(edgeClass).toContain("stroke-[2.8]");
    expect(edge).toHaveAttribute("data-visual-state", "invalid");
    expect(edge).toHaveAttribute("data-selected", "true");
  });
});
