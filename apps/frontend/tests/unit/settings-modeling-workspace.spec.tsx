import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ModelingWorkspacePage from "@/app/settings/modeling/page";
import {
  getWorkspaceModelingGraph,
  listWorkspaceDatasourceBindings,
  listWorkspaceDatasourceTablePermissions,
  listWorkspaces,
  upsertWorkspaceModelingGraph
} from "@/lib/admin-api-client";

vi.mock("@/lib/admin-api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin-api-client")>();
  return {
    ...actual,
    listWorkspaces: vi.fn(),
    listWorkspaceDatasourceBindings: vi.fn(),
    listWorkspaceDatasourceTablePermissions: vi.fn(),
    getWorkspaceModelingGraph: vi.fn(),
    upsertWorkspaceModelingGraph: vi.fn()
  };
});

const mockListWorkspaces = vi.mocked(listWorkspaces);
const mockListWorkspaceDatasourceBindings = vi.mocked(listWorkspaceDatasourceBindings);
const mockListWorkspaceDatasourceTablePermissions = vi.mocked(
  listWorkspaceDatasourceTablePermissions
);
const mockGetWorkspaceModelingGraph = vi.mocked(getWorkspaceModelingGraph);
const mockUpsertWorkspaceModelingGraph = vi.mocked(upsertWorkspaceModelingGraph);

describe("ModelingWorkspacePage", () => {
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
      tableNames: ["orders"],
      policyVersion: 7
    });

    mockGetWorkspaceModelingGraph.mockResolvedValue({
      workspaceId: "ws-2",
      datasourceId: "ds-2b",
      activeRevision: 1,
      draft: {
        policyVersion: 7,
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
              description: "old desc",
              columns: []
            }
          ],
          relationships: [],
          calculatedFields: [],
          views: [],
          schemaChanges: []
        }
      }
    });

    mockUpsertWorkspaceModelingGraph.mockImplementation(async (workspaceId, datasourceId, input) => ({
      workspaceId,
      datasourceId,
      activeRevision: 1,
      draft: {
        policyVersion: input.policyVersion,
        revision: 3,
        graphHash: "hash-r3",
        updatedAt: "2026-04-23T01:00:00.000Z",
        graphPayload: {
          models: input.models ?? [],
          relationships: input.relationships ?? [],
          calculatedFields: input.calculatedFields ?? [],
          views: input.views ?? [],
          schemaChanges: input.schemaChanges ?? []
        }
      }
    }));
  });

  it("updates model metadata in workspace and saves via modeling graph upsert", async () => {
    const user = userEvent.setup();
    render(<ModelingWorkspacePage />);

    await screen.findByRole("button", { name: "选择 model Orders Model" });

    await user.clear(screen.getByRole("textbox", { name: "显示名称" }));
    await user.type(screen.getByRole("textbox", { name: "显示名称" }), "订单模型V2");
    await user.click(screen.getByRole("button", { name: "保存 Metadata" }));

    await user.click(screen.getByRole("button", { name: "保存 Modeling Draft" }));

    await waitFor(() => {
      expect(mockUpsertWorkspaceModelingGraph).toHaveBeenCalledWith(
        "ws-2",
        "ds-2b",
        expect.objectContaining({
          policyVersion: 7,
          models: [
            expect.objectContaining({
              id: "model.orders",
              displayName: expect.stringContaining("订单模型V2")
            })
          ]
        })
      );
    });
  });

  it("keeps relationship selection context when draft save fails", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "ResizeObserver", {
      writable: true,
      configurable: true,
      value: undefined
    });

    mockGetWorkspaceModelingGraph.mockResolvedValueOnce({
      workspaceId: "ws-2",
      datasourceId: "ds-2b",
      activeRevision: 1,
      draft: {
        policyVersion: 7,
        revision: 2,
        graphHash: "hash-r2-relationship",
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
            },
            {
              id: "model.customers",
              tableName: "customers",
              modelName: "customers",
              displayName: "Customers",
              description: null,
              columns: []
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
          views: [],
          schemaChanges: []
        }
      }
    });

    mockUpsertWorkspaceModelingGraph.mockRejectedValueOnce(new Error("draft save failed"));

    render(<ModelingWorkspacePage />);

    await screen.findByText("orders.customer_id = customers.id");
    await user.click(screen.getByRole("button", { name: "orders.customer_id = customers.id" }));

    expect(
      await screen.findByText("Current Context: relationship · rel-orders-customers")
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "保存 Modeling Draft" }));

    expect(await screen.findByText("draft save failed")).toBeInTheDocument();
    expect(
      screen.getByText("Current Context: relationship · rel-orders-customers")
    ).toBeInTheDocument();
    expect(screen.getByText("Relationship Editor")).toBeInTheDocument();
  });
});
