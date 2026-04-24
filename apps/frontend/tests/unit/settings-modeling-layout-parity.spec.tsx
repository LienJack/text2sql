import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ModelingWorkspacePage from "@/app/settings/modeling/page";
import {
  getWorkspaceModelingGraph,
  listWorkspaceDatasourceBindings,
  listWorkspaceDatasourceTablePermissions,
  listWorkspaces
} from "@/lib/admin-api-client";

const fitViewMock = vi.fn();

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
      const onInit =
        props.onInit as ((instance: { fitView: typeof fitViewMock }) => void) | undefined;
      const nodes =
        (props.nodes as Array<{ id: string; data?: { title?: string }; selected?: boolean }> | undefined) ??
        [];
      const initOnceRef = React.useRef(false);

      React.useEffect(() => {
        if (initOnceRef.current) {
          return;
        }
        initOnceRef.current = true;
        onInit?.({ fitView: fitViewMock });
      }, [onInit]);

      return (
        <div data-testid="layout-parity-react-flow">
          <p data-testid="layout-parity-react-flow-nodes">
            {nodes.map((node) => `${node.id}:${node.data?.title ?? "-"}`).join("|")}
          </p>
          <p data-testid="layout-parity-react-flow-selected">
            {nodes
              .filter((node) => node.selected)
              .map((node) => node.id)
              .join(",")}
          </p>
        </div>
      );
    },
    Background: () => <div data-testid="layout-parity-flow-background" />,
    MiniMap: () => <div data-testid="layout-parity-flow-minimap" />,
    Controls: () => <div data-testid="layout-parity-flow-controls" />,
    Handle: () => null,
    Position: {
      Left: "left",
      Right: "right"
    },
    BaseEdge: () => <div data-testid="layout-parity-flow-edge" />,
    EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    getBezierPath: () => ["M0,0", 20, 20]
  };
});

vi.mock("@/components/settings/modeling/modeling-details-panel", () => ({
  ModelingDetailsPanel: () => <div data-testid="layout-mock-details-panel">details-panel</div>
}));

vi.mock("@/components/settings/modeling/modeling-schema-change-panel", () => ({
  ModelingSchemaChangePanel: () => <div data-testid="layout-mock-schema-panel">schema-panel</div>
}));

vi.mock("@/components/settings/modeling/modeling-deploy-panel", () => ({
  ModelingDeployPanel: () => <div data-testid="layout-mock-deploy-panel">deploy-panel</div>
}));

vi.mock("@/lib/admin-api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin-api-client")>();
  return {
    ...actual,
    listWorkspaces: vi.fn(),
    listWorkspaceDatasourceBindings: vi.fn(),
    listWorkspaceDatasourceTablePermissions: vi.fn(),
    getWorkspaceModelingGraph: vi.fn()
  };
});

const mockListWorkspaces = vi.mocked(listWorkspaces);
const mockListWorkspaceDatasourceBindings = vi.mocked(listWorkspaceDatasourceBindings);
const mockListWorkspaceDatasourceTablePermissions = vi.mocked(
  listWorkspaceDatasourceTablePermissions
);
const mockGetWorkspaceModelingGraph = vi.mocked(getWorkspaceModelingGraph);

describe("Modeling layout parity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fitViewMock.mockClear();
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 1280 });
    Element.prototype.scrollIntoView = vi.fn();
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

    mockListWorkspaces.mockResolvedValue({
      items: [{ id: "ws-1", name: "Workspace 1", isDefault: true }],
      total: 1,
      page: 1,
      pageSize: 200
    });

    mockListWorkspaceDatasourceBindings.mockResolvedValue([
      {
        id: "binding-1",
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        datasourceName: "Datasource 1",
        createdAt: "2026-04-23T00:00:00.000Z",
        updatedAt: "2026-04-23T00:00:00.000Z"
      }
    ]);

    mockListWorkspaceDatasourceTablePermissions.mockResolvedValue({
      workspaceId: "ws-1",
      datasourceId: "ds-1",
      tableNames: ["orders", "customers"],
      policyVersion: 3
    });

    mockGetWorkspaceModelingGraph.mockResolvedValue({
      workspaceId: "ws-1",
      datasourceId: "ds-1",
      activeRevision: 1,
      draft: {
        policyVersion: 3,
        revision: 2,
        graphHash: "hash-r2",
        updatedAt: "2026-04-23T00:00:00.000Z",
        graphPayload: {
          models: [
            {
              id: "model.orders",
              tableName: "orders",
              modelName: "orders",
              displayName: "Orders Model",
              description: null,
              columns: [{ name: "id", dataType: "int", isNullable: false, isPrimaryKey: true }]
            },
            {
              id: "model.customers",
              tableName: "customers",
              modelName: "customers",
              displayName: "Customers Model",
              description: null,
              columns: [{ name: "id", dataType: "int", isNullable: false, isPrimaryKey: true }]
            }
          ],
          relationships: [],
          calculatedFields: [],
          views: [],
          schemaChanges: []
        }
      }
    });
  });

  it("renders flowchart-first workbench layout as left tree, center canvas, and right context", async () => {
    render(<ModelingWorkspacePage />);

    await waitFor(() => {
      expect(screen.getByTestId("modeling-layout-parity-shell")).toBeInTheDocument();
    });

    expect(screen.getByRole("heading", { name: "Modeling Workbench" })).toBeInTheDocument();
    expect(screen.getByText(/Flowchart-first 工作台/)).toBeInTheDocument();
    expect(screen.getByTestId("modeling-top-status-bar")).toBeInTheDocument();

    const layoutShell = screen.getByTestId("modeling-layout-parity-shell");
    const leftPane = within(layoutShell).getByTestId("modeling-layout-left-pane");
    const canvasPane = within(layoutShell).getByTestId("modeling-layout-canvas-pane");
    const contextPane = within(layoutShell).getByTestId("modeling-layout-context-pane");
    const paneOrder = Array.from(layoutShell.children).map((element) =>
      element.getAttribute("data-testid")
    );

    expect(paneOrder).toEqual([
      "modeling-layout-left-pane",
      "modeling-layout-canvas-pane",
      "modeling-layout-context-pane"
    ]);
    expect(within(leftPane).getByTestId("modeling-sidebar-tree")).toBeInTheDocument();
    expect(within(canvasPane).getByTestId("modeling-flow-canvas")).toBeInTheDocument();
    expect(within(contextPane).getByTestId("layout-mock-details-panel")).toBeInTheDocument();
    expect(within(contextPane).getByTestId("layout-mock-schema-panel")).toBeInTheDocument();
    expect(within(contextPane).getByTestId("layout-mock-deploy-panel")).toBeInTheDocument();
  });

  it("keeps graph visible and shows guidance when there are no relationships", async () => {
    render(<ModelingWorkspacePage />);

    await screen.findByTestId("layout-parity-react-flow");

    expect(screen.getByText("当前无 relationships 连线，可继续在 Relationship Editor 中补充。")).toBeInTheDocument();
  });

  it("keeps sidebar selection and canvas focus semantics in sync", async () => {
    const user = userEvent.setup();
    render(<ModelingWorkspacePage />);

    await screen.findByRole("button", { name: "选择 model Customers Model" });
    await user.click(screen.getByRole("button", { name: "选择 model Customers Model" }));

    expect(screen.getByText("Current Context: model · model.customers")).toBeInTheDocument();

    await waitFor(() => {
      const hasFocusedCustomersNode = fitViewMock.mock.calls.some((call) => {
        const arg = call[0] as { nodes?: Array<{ id?: string }> } | undefined;
        return arg?.nodes?.some((node) => node.id === "model:model.customers");
      });
      expect(hasFocusedCustomersNode).toBe(true);
    });
  });

  it("keeps 375px quick-access and keyboard interactions reachable", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 375 });
    window.dispatchEvent(new Event("resize"));

    render(<ModelingWorkspacePage />);

    await waitFor(() => {
      expect(screen.getByTestId("modeling-layout-parity-shell")).toBeInTheDocument();
    });

    const toCanvasButton = screen.getByRole("button", { name: "定位到画布" });
    const toAssetsButton = screen.getByRole("button", { name: "资产树" });
    expect(screen.getByTestId("modeling-mobile-quick-access")).toBeInTheDocument();
    expect(toCanvasButton).toHaveAttribute("aria-controls", "modeling-canvas-pane");
    expect(toAssetsButton).toHaveAttribute("aria-controls", "modeling-assets-pane");

    toCanvasButton.focus();
    await user.keyboard("{Enter}");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();

    const modelsTreeToggle = screen.getByRole("button", { name: "切换 Models 树" });
    expect(modelsTreeToggle).toHaveAttribute("aria-expanded", "true");
    modelsTreeToggle.focus();
    await user.keyboard(" ");
    expect(modelsTreeToggle).toHaveAttribute("aria-expanded", "false");
    await user.keyboard("{Enter}");
    expect(modelsTreeToggle).toHaveAttribute("aria-expanded", "true");
  });
});
