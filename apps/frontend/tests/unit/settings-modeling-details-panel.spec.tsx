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

  it("applies external relationship intent and preselects relationship", async () => {
    const onSelectRelationship = vi.fn();
    const panelProps = {
      selectedNode: { kind: "model", id: "model.orders" as const },
      models: [
        {
          id: "model.orders",
          tableName: "orders",
          modelName: "orders",
          displayName: "Orders",
          description: null,
          columns: []
        }
      ],
      views: [],
      calculatedFields: [],
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
      onMetadataSave: vi.fn(),
      onCalculatedFieldsSave: vi.fn(),
      onRelationshipsSave: vi.fn(),
      onSelectRelationship,
      requestedEditorIntent: {
        tab: "relationship",
        relationshipId: "rel-orders-customers",
        requestId: 1
      }
    } as unknown as Parameters<typeof ModelingDetailsPanel>[0];

    render(<ModelingDetailsPanel {...panelProps} />);

    expect(await screen.findByText("Relationship Editor")).toBeInTheDocument();
    expect(onSelectRelationship).toHaveBeenCalledWith("rel-orders-customers");
  });

  it("keeps current tab when external intent is blocked by dirty guard", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onSelectRelationship = vi.fn();

    const panelProps = {
      selectedNode: { kind: "model", id: "model.orders" as const },
      models: [
        {
          id: "model.orders",
          tableName: "orders",
          modelName: "orders",
          displayName: "Orders",
          description: null,
          columns: []
        }
      ],
      views: [],
      calculatedFields: [],
      relationships: [],
      onMetadataSave: vi.fn(),
      onCalculatedFieldsSave: vi.fn(),
      onRelationshipsSave: vi.fn(),
      onSelectRelationship
    } as unknown as Parameters<typeof ModelingDetailsPanel>[0];

    const { rerender } = render(<ModelingDetailsPanel {...panelProps} />);

    await user.type(screen.getByRole("textbox", { name: "显示名称" }), " dirty");

    rerender(
      <ModelingDetailsPanel
        {...panelProps}
        {...({
          requestedEditorIntent: {
            tab: "relationship",
            relationshipId: "rel-orders-customers",
            requestId: 2
          }
        } as Record<string, unknown>)}
      />
    );

    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.queryByText("Relationship Editor")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存 Metadata" })).toBeInTheDocument();
    expect(onSelectRelationship).not.toHaveBeenCalled();
  });
});
