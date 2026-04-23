import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ModelingWorkspacePage from "@/app/settings/modeling/page";
import {
  getWorkspaceModelingGraph,
  listWorkspaceDatasourceBindings,
  listWorkspaceDatasourceTablePermissions,
  listWorkspaces
} from "@/lib/admin-api-client";

vi.mock("@/components/settings/modeling/modeling-sidebar-tree", () => ({
  ModelingSidebarTree: () => <div data-testid="layout-mock-sidebar-tree">sidebar-tree</div>
}));

vi.mock("@/components/settings/modeling/modeling-flow-canvas", () => ({
  ModelingFlowCanvas: () => <div data-testid="layout-mock-flow-canvas">flow-canvas</div>
}));

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
      tableNames: ["orders"],
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
          models: [],
          relationships: [],
          calculatedFields: [],
          views: [],
          schemaChanges: []
        }
      }
    });
  });

  it("renders top status, left tree, center canvas, and right context panes", async () => {
    render(<ModelingWorkspacePage />);

    await waitFor(() => {
      expect(screen.getByTestId("modeling-layout-parity-shell")).toBeInTheDocument();
    });

    expect(screen.getByTestId("modeling-top-status-bar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存 Modeling Draft" })).toBeInTheDocument();

    const layoutShell = screen.getByTestId("modeling-layout-parity-shell");
    const leftPane = within(layoutShell).getByTestId("modeling-layout-left-pane");
    const canvasPane = within(layoutShell).getByTestId("modeling-layout-canvas-pane");
    const contextPane = within(layoutShell).getByTestId("modeling-layout-context-pane");

    expect(within(leftPane).getByTestId("layout-mock-sidebar-tree")).toBeInTheDocument();
    expect(within(canvasPane).getByTestId("layout-mock-flow-canvas")).toBeInTheDocument();
    expect(within(contextPane).getByTestId("layout-mock-details-panel")).toBeInTheDocument();
    expect(within(contextPane).getByTestId("layout-mock-schema-panel")).toBeInTheDocument();
    expect(within(contextPane).getByTestId("layout-mock-deploy-panel")).toBeInTheDocument();
  });

  it("keeps key entry areas reachable at narrow-width rendering", async () => {
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 375 });
    window.dispatchEvent(new Event("resize"));

    render(<ModelingWorkspacePage />);

    await waitFor(() => {
      expect(screen.getByTestId("modeling-layout-parity-shell")).toBeInTheDocument();
    });

    expect(screen.getByTestId("modeling-top-status-bar")).toBeInTheDocument();
    expect(screen.getByTestId("modeling-layout-left-pane")).toBeInTheDocument();
    expect(screen.getByTestId("modeling-layout-canvas-pane")).toBeInTheDocument();
    expect(screen.getByTestId("modeling-layout-context-pane")).toBeInTheDocument();
  });
});
