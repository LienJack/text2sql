import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ModelingWorkspacePage from "@/app/settings/modeling/page";
import {
  detectWorkspaceModelingSchemaChanges,
  getWorkspaceModelingGraph,
  listWorkspaceDatasourceBindings,
  listWorkspaceDatasourceTablePermissions,
  listWorkspaces,
  resolveWorkspaceModelingSchemaChange
} from "@/lib/admin-api-client";

vi.mock("@/lib/admin-api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin-api-client")>();
  return {
    ...actual,
    listWorkspaces: vi.fn(),
    listWorkspaceDatasourceBindings: vi.fn(),
    listWorkspaceDatasourceTablePermissions: vi.fn(),
    getWorkspaceModelingGraph: vi.fn(),
    detectWorkspaceModelingSchemaChanges: vi.fn(),
    resolveWorkspaceModelingSchemaChange: vi.fn()
  };
});

const mockListWorkspaces = vi.mocked(listWorkspaces);
const mockListWorkspaceDatasourceBindings = vi.mocked(listWorkspaceDatasourceBindings);
const mockListWorkspaceDatasourceTablePermissions = vi.mocked(
  listWorkspaceDatasourceTablePermissions
);
const mockGetWorkspaceModelingGraph = vi.mocked(getWorkspaceModelingGraph);
const mockDetectWorkspaceModelingSchemaChanges = vi.mocked(
  detectWorkspaceModelingSchemaChanges
);
const mockResolveWorkspaceModelingSchemaChange = vi.mocked(
  resolveWorkspaceModelingSchemaChange
);

describe("settings modeling schema change flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/settings/modeling?workspaceId=ws-1&datasourceId=ds-1");

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
      policyVersion: 9
    });

    let graphCall = 0;
    mockGetWorkspaceModelingGraph.mockImplementation(async () => {
      graphCall += 1;
      if (graphCall === 1) {
        return {
          workspaceId: "ws-1",
          datasourceId: "ds-1",
          activeRevision: 1,
          draft: {
            policyVersion: 9,
            revision: 2,
            graphHash: "hash-initial",
            updatedAt: "2026-04-23T00:00:00.000Z",
            graphPayload: {
              models: [],
              relationships: [],
              calculatedFields: [],
              views: [],
              schemaChanges: []
            }
          }
        };
      }
      if (graphCall === 2) {
        return {
          workspaceId: "ws-1",
          datasourceId: "ds-1",
          activeRevision: 1,
          draft: {
            policyVersion: 9,
            revision: 2,
            graphHash: "hash-detected",
            updatedAt: "2026-04-23T00:05:00.000Z",
            graphPayload: {
              models: [],
              relationships: [],
              calculatedFields: [],
              views: [],
              schemaChanges: [
                {
                  id: "schema-change:deleted_table:legacy_orders",
                  kind: "deleted_table",
                  status: "detected",
                  summary: "legacy_orders 表已删除"
                },
                {
                  id: "schema-change:deleted_column:orders:total_amount",
                  kind: "deleted_column",
                  status: "detected",
                  summary: "orders.total_amount 已删除"
                }
              ]
            }
          }
        };
      }
      return {
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        activeRevision: 1,
        draft: {
          policyVersion: 9,
          revision: 2,
          graphHash: "hash-residual",
          updatedAt: "2026-04-23T00:10:00.000Z",
          graphPayload: {
            models: [],
            relationships: [],
            calculatedFields: [],
            views: [],
            schemaChanges: [
              {
                id: "schema-change:deleted_table:legacy_orders",
                kind: "deleted_table",
                status: "resolved",
                summary: "legacy_orders 表已删除"
              },
              {
                id: "schema-change:deleted_column:orders:total_amount",
                kind: "deleted_column",
                status: "detected",
                summary: "orders.total_amount 已删除"
              }
            ]
          }
        }
      };
    });

    mockDetectWorkspaceModelingSchemaChanges
      .mockResolvedValueOnce({
        stage: "schema_change_detected",
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        policyVersion: 9,
        unresolvedHighRiskCount: 2,
        highRiskStatus: "high",
        changes: [
          {
            id: "schema-change:deleted_table:legacy_orders",
            kind: "deleted_table",
            status: "detected",
            summary: "legacy_orders 表已删除"
          },
          {
            id: "schema-change:deleted_column:orders:total_amount",
            kind: "deleted_column",
            status: "detected",
            summary: "orders.total_amount 已删除"
          }
        ],
        groupedChanges: {
          deletedTables: [
            {
              id: "schema-change:deleted_table:legacy_orders",
              kind: "deleted_table",
              status: "detected",
              summary: "legacy_orders 表已删除"
            }
          ],
          deletedColumns: [
            {
              id: "schema-change:deleted_column:orders:total_amount",
              kind: "deleted_column",
              status: "detected",
              summary: "orders.total_amount 已删除"
            }
          ],
          modifiedColumns: [],
          other: []
        }
      })
      .mockResolvedValueOnce({
        stage: "schema_change_detected",
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        policyVersion: 9,
        unresolvedHighRiskCount: 1,
        highRiskStatus: "high",
        changes: [
          {
            id: "schema-change:deleted_column:orders:total_amount",
            kind: "deleted_column",
            status: "detected",
            summary: "orders.total_amount 已删除"
          }
        ],
        groupedChanges: {
          deletedTables: [],
          deletedColumns: [
            {
              id: "schema-change:deleted_column:orders:total_amount",
              kind: "deleted_column",
              status: "detected",
              summary: "orders.total_amount 已删除"
            }
          ],
          modifiedColumns: [],
          other: []
        }
      });

    mockResolveWorkspaceModelingSchemaChange.mockResolvedValue({
      stage: "schema_change_resolved",
      workspaceId: "ws-1",
      datasourceId: "ds-1",
      policyVersion: 9,
      schemaChangeId: "schema-change:deleted_table:legacy_orders",
      alreadyResolved: false,
      unresolvedHighRiskCount: 1
    });
  });

  it("supports detect -> resolve -> re-detect and keeps residual count clear", async () => {
    const user = userEvent.setup();
    render(<ModelingWorkspacePage />);

    const detectButton = await screen.findByRole("button", { name: "Detect" });
    await waitFor(() => {
      expect(detectButton).toBeEnabled();
    });
    await user.click(detectButton);

    expect(await screen.findByText("Schema change detect 完成，未解决项 2。")).toBeInTheDocument();
    expect(screen.getByText("仍有 2 项待处理")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Resolve" })[0]);
    expect(await screen.findByText("Schema change 已标记为 resolved。")).toBeInTheDocument();
    expect(screen.getByText("仍有 1 项待处理")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Detect" }));
    expect(await screen.findByText("Schema change detect 完成，未解决项 1。")).toBeInTheDocument();

    await waitFor(() => {
      expect(mockResolveWorkspaceModelingSchemaChange).toHaveBeenCalledWith("ws-1", "ds-1", {
        policyVersion: 9,
        changeId: "schema-change:deleted_table:legacy_orders"
      });
    });
  });
});
