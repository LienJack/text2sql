import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ModelingWorkspacePage from "@/app/settings/modeling/page";
import { SaveAsViewDialog } from "@/components/chat/save-as-view-dialog";
import {
  getWorkspaceModelingGraph,
  listWorkspaceDatasourceBindings,
  listWorkspaceDatasourceTablePermissions,
  listWorkspaces,
  saveModelingViewFromRun
} from "@/lib/admin-api-client";

vi.mock("@/components/settings/modeling/modeling-details-panel", () => ({
  ModelingDetailsPanel: (props: { selectedNode: { kind: string; id: string } | null }) => (
    <div data-testid="selected-modeling-node">
      {props.selectedNode ? `${props.selectedNode.kind}:${props.selectedNode.id}` : "none"}
    </div>
  )
}));

vi.mock("@/lib/admin-api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin-api-client")>();
  return {
    ...actual,
    saveModelingViewFromRun: vi.fn(),
    listWorkspaces: vi.fn(),
    listWorkspaceDatasourceBindings: vi.fn(),
    listWorkspaceDatasourceTablePermissions: vi.fn(),
    getWorkspaceModelingGraph: vi.fn()
  };
});

const mockSaveModelingViewFromRun = vi.mocked(saveModelingViewFromRun);
const mockListWorkspaces = vi.mocked(listWorkspaces);
const mockListWorkspaceDatasourceBindings = vi.mocked(listWorkspaceDatasourceBindings);
const mockListWorkspaceDatasourceTablePermissions = vi.mocked(
  listWorkspaceDatasourceTablePermissions
);
const mockGetWorkspaceModelingGraph = vi.mocked(getWorkspaceModelingGraph);

describe("settings modeling view sync from chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    mockSaveModelingViewFromRun.mockResolvedValue({
      stage: "chat_run_view_saved",
      workspaceId: "ws-sync",
      datasourceId: "ds-sync",
      runId: "run-sync",
      replayed: false,
      activeRevision: 2,
      draftRevision: 3,
      view: {
        id: "view.chat_run.run-sync",
        name: "orders_sync_view",
        sql: "SELECT * FROM orders",
        displayName: "Orders Sync View",
        description: "Saved from run"
      }
    });
  });

  it("stores modeling context and redirects with viewId after save", async () => {
    const user = userEvent.setup();
    const originalLocation = window.location;
    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        assign: assignSpy
      }
    });

    render(
      <SaveAsViewDialog
        open
        onOpenChange={() => undefined}
        workspaceId="ws-sync"
        datasourceId="ds-sync"
        runId="run-sync"
      />
    );

    await user.clear(screen.getByLabelText("View 名称"));
    await user.type(screen.getByLabelText("View 名称"), "orders_sync_view");
    await user.click(screen.getByRole("button", { name: "保存为 View" }));

    await screen.findByRole("button", { name: "前往 Modeling" });
    await user.click(screen.getByRole("button", { name: "前往 Modeling" }));

    await waitFor(() => {
      expect(window.sessionStorage.getItem("text2sql.activeWorkspaceId")).toBe("ws-sync");
      expect(window.sessionStorage.getItem("text2sql.activeDatasourceId")).toBe("ds-sync");
      expect(window.sessionStorage.getItem("text2sql.modeling.selectViewId")).toBe(
        "view.chat_run.run-sync"
      );
      expect(assignSpy).toHaveBeenCalledWith(
        "/settings/modeling?workspaceId=ws-sync&datasourceId=ds-sync&viewId=view.chat_run.run-sync"
      );
    });

    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation
    });
  });
});

describe("settings modeling page view selection sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    mockListWorkspaces.mockResolvedValue({
      items: [{ id: "ws-sync", name: "Workspace Sync", isDefault: true }],
      total: 1,
      page: 1,
      pageSize: 200
    });
    mockListWorkspaceDatasourceBindings.mockResolvedValue([
      {
        id: "binding-sync",
        workspaceId: "ws-sync",
        datasourceId: "ds-sync",
        datasourceName: "Datasource Sync",
        createdAt: "2026-04-23T00:00:00.000Z",
        updatedAt: "2026-04-23T00:00:00.000Z"
      }
    ]);
    mockListWorkspaceDatasourceTablePermissions.mockResolvedValue({
      workspaceId: "ws-sync",
      datasourceId: "ds-sync",
      tableNames: ["orders"],
      policyVersion: 4
    });
    mockGetWorkspaceModelingGraph.mockResolvedValue({
      workspaceId: "ws-sync",
      datasourceId: "ds-sync",
      activeRevision: 1,
      draft: {
        policyVersion: 4,
        revision: 2,
        graphHash: "hash-sync",
        updatedAt: "2026-04-23T00:00:00.000Z",
        graphPayload: {
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
          relationships: [],
          calculatedFields: [],
          views: [
            {
              id: "view.chat_run.run-sync",
              name: "orders_sync_view",
              displayName: "Orders Sync View",
              description: null,
              sql: "SELECT * FROM orders"
            }
          ],
          schemaChanges: []
        }
      }
    });
  });

  it("prefers query viewId and selects target view on page load", async () => {
    window.sessionStorage.setItem("text2sql.modeling.selectViewId", "view.old");
    window.history.replaceState(
      {},
      "",
      "/settings/modeling?workspaceId=ws-sync&datasourceId=ds-sync&viewId=view.chat_run.run-sync"
    );

    render(<ModelingWorkspacePage />);

    await waitFor(() => {
      expect(screen.getByTestId("selected-modeling-node")).toHaveTextContent(
        "view:view.chat_run.run-sync"
      );
    });
  });

  it("falls back to sessionStorage view signal and consumes it", async () => {
    window.sessionStorage.setItem("text2sql.modeling.selectViewId", "view.chat_run.run-sync");
    window.history.replaceState(
      {},
      "",
      "/settings/modeling?workspaceId=ws-sync&datasourceId=ds-sync"
    );

    render(<ModelingWorkspacePage />);

    await waitFor(() => {
      expect(screen.getByTestId("selected-modeling-node")).toHaveTextContent(
        "view:view.chat_run.run-sync"
      );
      expect(window.sessionStorage.getItem("text2sql.modeling.selectViewId")).toBeNull();
    });
  });
});
