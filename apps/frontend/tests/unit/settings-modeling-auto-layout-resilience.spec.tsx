import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelingGraphPayload } from "@text2sql/shared-types";
import { ModelingFlowCanvas } from "@/components/settings/modeling/modeling-flow-canvas";

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
      return node;
    });
  };

  const applyEdgeChanges = (
    _changes: Array<Record<string, unknown>>,
    edges: Array<Record<string, unknown>>
  ) => edges;

  return {
    applyNodeChanges,
    applyEdgeChanges,
    ReactFlow: (props: Record<string, unknown>) => {
      const onInit = props.onInit as ((instance: { fitView: () => void }) => void) | undefined;
      const nodes =
        (props.nodes as Array<{ position?: { x: number; y: number } }> | undefined) ?? [];
      const initOnceRef = React.useRef(false);

      React.useEffect(() => {
        if (initOnceRef.current) {
          return;
        }
        initOnceRef.current = true;
        onInit?.({ fitView: () => undefined });
      }, [onInit]);

      return (
        <div data-testid="resilience-react-flow">
          <p data-testid="resilience-first-position">
            {nodes[0]?.position ? `${nodes[0].position.x},${nodes[0].position.y}` : "none"}
          </p>
        </div>
      );
    },
    Background: () => <div />,
    MiniMap: () => <div />,
    Controls: () => <div />,
    Handle: () => null,
    Position: {
      Left: "left",
      Right: "right"
    },
    BaseEdge: () => <div />,
    EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    getBezierPath: () => ["M0,0", 20, 20]
  };
});

const graphPayload: ModelingGraphPayload = {
  models: [
    {
      id: "model.a",
      tableName: "a",
      modelName: "a",
      displayName: "A",
      description: null,
      columns: [{ name: "id", dataType: "int", isNullable: false, isPrimaryKey: true }]
    },
    {
      id: "model.b",
      tableName: "b",
      modelName: "b",
      displayName: "B",
      description: null,
      columns: [{ name: "id", dataType: "int", isNullable: false, isPrimaryKey: true }]
    }
  ],
  relationships: [
    {
      id: "rel-a-b",
      source: "manual",
      confidence: 0.9,
      bridge: {
        left: { dataset: "analytics", table: "a", column: "id" },
        right: { dataset: "analytics", table: "b", column: "id" },
        operator: "eq",
        confidence: 0.9
      }
    }
  ],
  calculatedFields: [],
  views: [],
  schemaChanges: []
};

describe("ModelingFlowCanvas auto layout resilience", () => {
  beforeEach(() => {
    computeElkLayoutMock.mockReset();
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

  it("ignores stale async layout result after key changes", async () => {
    const user = userEvent.setup();
    let resolvePendingLayout: ((value: unknown) => void) | undefined;
    computeElkLayoutMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePendingLayout = resolve;
        })
    );
    const { rerender } = render(
      <ModelingFlowCanvas
        graphPayload={graphPayload}
        selectedNode={null}
        autoLayoutKey="workspace-1"
        onSelectNode={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "自动布局画布" }));

    rerender(
      <ModelingFlowCanvas
        graphPayload={graphPayload}
        selectedNode={null}
        autoLayoutKey="workspace-2"
        onSelectNode={vi.fn()}
      />
    );

    resolvePendingLayout?.({
      ok: true,
      elapsedMs: 200,
      positions: {
        "model:model.a": { x: 420, y: 300 }
      }
    });

    await waitFor(() => {
      expect(screen.getByTestId("resilience-first-position")).toHaveTextContent("0,0");
    });
  });

  it("recovers button state and interaction after timeout failure", async () => {
    const user = userEvent.setup();
    computeElkLayoutMock.mockResolvedValue({
      ok: false,
      reason: "timeout",
      message: "timeout",
      elapsedMs: 2001
    });

    render(
      <ModelingFlowCanvas
        graphPayload={graphPayload}
        selectedNode={null}
        autoLayoutKey="workspace-timeout"
        onSelectNode={vi.fn()}
      />
    );

    const autoLayoutButton = screen.getByRole("button", { name: "自动布局画布" });
    await user.click(autoLayoutButton);

    await waitFor(() => {
      expect(screen.getByText("Auto Layout 超时，已保留当前画布位置。")).toBeInTheDocument();
      expect(autoLayoutButton).toBeEnabled();
    });
  });
});
