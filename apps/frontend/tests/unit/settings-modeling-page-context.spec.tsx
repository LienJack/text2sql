import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RelationshipModelingPage from "@/app/settings/modeling/page";
import {
  getWorkspaceRelationshipDraft,
  listWorkspaceDatasourceBindings,
  listWorkspaceDatasourceTablePermissions,
  listWorkspaces
} from "@/lib/admin-api-client";

vi.mock("@/components/settings/relationship-modeling-canvas", () => ({
  RelationshipModelingCanvas: () => <div data-testid="mock-modeling-canvas" />
}));

vi.mock("@/components/settings/relationship-edge-editor-dialog", () => ({
  RelationshipEdgeEditorDialog: () => null
}));

vi.mock("@/components/settings/relationship-publish-panel", () => ({
  RelationshipPublishPanel: () => null
}));

vi.mock("@/lib/admin-api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin-api-client")>();
  return {
    ...actual,
    listWorkspaces: vi.fn(),
    listWorkspaceDatasourceBindings: vi.fn(),
    listWorkspaceDatasourceTablePermissions: vi.fn(),
    getWorkspaceRelationshipDraft: vi.fn()
  };
});

const mockListWorkspaces = vi.mocked(listWorkspaces);
const mockListWorkspaceDatasourceBindings = vi.mocked(listWorkspaceDatasourceBindings);
const mockListWorkspaceDatasourceTablePermissions = vi.mocked(
  listWorkspaceDatasourceTablePermissions
);
const mockGetWorkspaceRelationshipDraft = vi.mocked(getWorkspaceRelationshipDraft);

describe("RelationshipModelingPage context hydrate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(
      {},
      "",
      "/settings/modeling?workspaceId=ws-2&datasourceId=ds-2b"
    );
    window.sessionStorage.clear();
    window.sessionStorage.setItem("text2sql.activeWorkspaceId", "ws-1");
    window.sessionStorage.setItem("text2sql.activeDatasourceId", "ds-1a");

    mockListWorkspaces.mockResolvedValue({
      items: [
        { id: "ws-1", name: "Workspace 1", isDefault: true },
        { id: "ws-2", name: "Workspace 2", isDefault: false }
      ],
      total: 2,
      page: 1,
      pageSize: 200
    });

    mockListWorkspaceDatasourceBindings.mockImplementation(async (workspaceId) => {
      if (workspaceId === "ws-2") {
        return [
          {
            id: "binding-ws2-a",
            workspaceId: "ws-2",
            datasourceId: "ds-2a",
            datasourceName: "Datasource 2A",
            createdAt: "2026-04-23T00:00:00.000Z",
            updatedAt: "2026-04-23T00:00:00.000Z"
          },
          {
            id: "binding-ws2-b",
            workspaceId: "ws-2",
            datasourceId: "ds-2b",
            datasourceName: "Datasource 2B",
            createdAt: "2026-04-23T00:00:00.000Z",
            updatedAt: "2026-04-23T00:00:00.000Z"
          }
        ];
      }
      return [];
    });

    mockListWorkspaceDatasourceTablePermissions.mockResolvedValue({
      workspaceId: "ws-2",
      datasourceId: "ds-2b",
      tableNames: [],
      policyVersion: 1
    });

    mockGetWorkspaceRelationshipDraft.mockResolvedValue({
      workspaceId: "ws-2",
      datasourceId: "ds-2b",
      draft: null,
      activeRevision: undefined
    });
  });

  it("prefers workspace/datasource from query context when available", async () => {
    render(<RelationshipModelingPage />);

    const workspaceSelect = await screen.findByRole("combobox", {
      name: "选择工作空间"
    });
    const datasourceSelect = await screen.findByRole("combobox", {
      name: "选择数据源"
    });

    await waitFor(() => {
      expect(workspaceSelect).toHaveValue("ws-2");
      expect(datasourceSelect).toHaveValue("ds-2b");
    });

    expect(mockListWorkspaceDatasourceBindings).toHaveBeenCalledWith("ws-2");
    expect(mockListWorkspaceDatasourceTablePermissions).toHaveBeenCalledWith(
      "ws-2",
      "ds-2b"
    );
    expect(mockGetWorkspaceRelationshipDraft).toHaveBeenCalledWith("ws-2", "ds-2b");
    expect(window.sessionStorage.getItem("text2sql.activeWorkspaceId")).toBe("ws-2");
    expect(window.sessionStorage.getItem("text2sql.activeDatasourceId")).toBe("ds-2b");
  });
});
