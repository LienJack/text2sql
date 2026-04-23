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

    const baseSchemaChanges = [
      {
        id: "schema-change:deleted_table:legacy_orders",
        kind: "deleted_table" as const,
        summary: "legacy_orders 表已删除"
      },
      {
        id: "schema-change:deleted_column:orders:total_amount",
        kind: "deleted_column" as const,
        summary: "orders.total_amount 已删除"
      }
    ];
    let schemaChangesDetected = false;
    const resolvedChangeIds = new Set<string>();

    mockGetWorkspaceModelingGraph.mockImplementation(async () => {
      const schemaChanges = schemaChangesDetected
        ? baseSchemaChanges.map((item) => ({
            ...item,
            status: resolvedChangeIds.has(item.id)
              ? ("resolved" as const)
              : ("detected" as const)
          }))
        : [];
      return {
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        activeRevision: 1,
        draft: {
          policyVersion: 9,
          revision: 2,
          graphHash: schemaChangesDetected ? "hash-detected" : "hash-initial",
          updatedAt: "2026-04-23T00:00:00.000Z",
          graphPayload: {
            models: [],
            relationships: [],
            calculatedFields: [],
            views: [],
            schemaChanges
          }
        }
      };
    });

    mockDetectWorkspaceModelingSchemaChanges
      .mockImplementationOnce(async () => {
        schemaChangesDetected = true;
        return {
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
      };
      })
      .mockImplementationOnce(async () => {
        schemaChangesDetected = true;
        return {
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
      };
      });

    mockResolveWorkspaceModelingSchemaChange.mockImplementation(async () => {
      resolvedChangeIds.add("schema-change:deleted_table:legacy_orders");
      return {
        stage: "schema_change_resolved",
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        policyVersion: 9,
        schemaChangeId: "schema-change:deleted_table:legacy_orders",
        alreadyResolved: false,
        unresolvedHighRiskCount: 1
      };
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

    expect(await screen.findByText("Schema Change")).toBeInTheDocument();
    const resolveButtons = await screen.findAllByRole("button", { name: "Resolve" });
    expect(resolveButtons.length).toBeGreaterThan(0);
    await user.click(resolveButtons[0]);

    await waitFor(() => {
      expect(mockResolveWorkspaceModelingSchemaChange).toHaveBeenCalledWith("ws-1", "ds-1", {
        policyVersion: 9,
        changeId: "schema-change:deleted_table:legacy_orders"
      });
    });
    expect(await screen.findByText(/仍有 \d+ 项待处理/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Detect" }));

    expect(await screen.findByText(/仍有 \d+ 项待处理/)).toBeInTheDocument();
  });
});
