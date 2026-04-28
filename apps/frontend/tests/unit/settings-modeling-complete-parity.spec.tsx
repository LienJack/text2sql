import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ModelingWorkspacePage from "@/app/settings/modeling/page";
import {
  deployWorkspaceModeling,
  getWorkspaceModelingGraph,
  getWorkspaceModelingPreview,
  listWorkspaceDatasourceBindings,
  listWorkspaceDatasourceTablePermissions,
  listWorkspaces,
  precheckWorkspaceModelingDeploy,
  upsertWorkspaceModelingGraph
} from "@/lib/admin-api-client";

vi.mock("@/components/settings/modeling/modeling-flow-canvas", () => ({
  ModelingFlowCanvas: (props: {
    graphPayload: {
      relationships: Array<{ id: string }>;
    };
    onNodeAction?: (input: {
      modelId: string;
      action:
        | { type: "addCalculatedField" }
        | { type: "addRelationship" }
        | { type: "editRelationship"; relationshipId: string };
    }) => void;
  }) => {
    const firstRelationshipId = props.graphPayload.relationships[0]?.id ?? "rel-orders-customers";
    return (
      <div data-testid="mock-modeling-flow-canvas">
        <button
          type="button"
          onClick={() => {
            props.onNodeAction?.({
              modelId: "model.orders",
              action: { type: "addCalculatedField" }
            });
          }}
        >
          trigger-node-action-add-calculated-field
        </button>
        <button
          type="button"
          onClick={() => {
            props.onNodeAction?.({
              modelId: "model.orders",
              action: { type: "addRelationship" }
            });
          }}
        >
          trigger-node-action-add-relationship
        </button>
        <button
          type="button"
          onClick={() => {
            props.onNodeAction?.({
              modelId: "model.orders",
              action: {
                type: "editRelationship",
                relationshipId: firstRelationshipId
              }
            });
          }}
        >
          trigger-node-action-edit-relationship
        </button>
      </div>
    );
  }
}));

vi.mock("@/lib/admin-api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin-api-client")>();
  return {
    ...actual,
    listWorkspaces: vi.fn(),
    listWorkspaceDatasourceBindings: vi.fn(),
    listWorkspaceDatasourceTablePermissions: vi.fn(),
    getWorkspaceModelingGraph: vi.fn(),
    getWorkspaceModelingPreview: vi.fn(),
    upsertWorkspaceModelingGraph: vi.fn(),
    precheckWorkspaceModelingDeploy: vi.fn(),
    deployWorkspaceModeling: vi.fn()
  };
});

const mockListWorkspaces = vi.mocked(listWorkspaces);
const mockListWorkspaceDatasourceBindings = vi.mocked(listWorkspaceDatasourceBindings);
const mockListWorkspaceDatasourceTablePermissions = vi.mocked(
  listWorkspaceDatasourceTablePermissions
);
const mockGetWorkspaceModelingGraph = vi.mocked(getWorkspaceModelingGraph);
const mockGetWorkspaceModelingPreview = vi.mocked(getWorkspaceModelingPreview);
const mockUpsertWorkspaceModelingGraph = vi.mocked(upsertWorkspaceModelingGraph);
const mockPrecheckWorkspaceModelingDeploy = vi.mocked(precheckWorkspaceModelingDeploy);
const mockDeployWorkspaceModeling = vi.mocked(deployWorkspaceModeling);
const originalShowSchemaDeployPanels =
  process.env.NEXT_PUBLIC_MODELING_SHOW_SCHEMA_DEPLOY_PANELS;

describe("settings modeling complete parity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_MODELING_SHOW_SCHEMA_DEPLOY_PANELS = "true";
    window.history.replaceState(
      {},
      "",
      "/modeling?workspaceId=ws-2&datasourceId=ds-2b&viewId=view.orders_recent"
    );
    window.sessionStorage.clear();

    mockListWorkspaces.mockResolvedValue({
      items: [{ id: "ws-2", name: "Workspace 2", isDefault: true }],
      total: 1,
      page: 1,
      pageSize: 200
    });
    mockListWorkspaceDatasourceBindings.mockResolvedValue([
      {
        id: "binding-ws2-b",
        workspaceId: "ws-2",
        datasourceId: "ds-2b",
        datasourceName: "Datasource 2B",
        createdAt: "2026-04-24T00:00:00.000Z",
        updatedAt: "2026-04-24T00:00:00.000Z"
      }
    ]);
    mockListWorkspaceDatasourceTablePermissions.mockResolvedValue({
      workspaceId: "ws-2",
      datasourceId: "ds-2b",
      tableNames: ["orders"],
      policyVersion: 11
    });

    let graphCall = 0;
    mockGetWorkspaceModelingGraph.mockImplementation(async () => {
      graphCall += 1;
      if (graphCall === 1) {
        return {
          workspaceId: "ws-2",
          datasourceId: "ds-2b",
          activeRevision: 2,
          draft: {
            policyVersion: 11,
            revision: 2,
            graphHash: "hash-r2",
            updatedAt: "2026-04-24T00:00:00.000Z",
            graphPayload: {
              models: [
                {
                  id: "model.orders",
                  tableName: "orders",
                  modelName: "orders",
                  displayName: "Orders Model",
                  description: null,
                  position: { x: 120, y: 96 },
                  columns: [
                    { name: "id", dataType: "integer", isPrimaryKey: true, isNullable: false },
                    { name: "order_no", dataType: "text", isPrimaryKey: false, isNullable: false },
                    {
                      name: "customer_id",
                      dataType: "integer",
                      isPrimaryKey: false,
                      isNullable: false
                    }
                  ],
                  nodeSections: {
                    columns: ["id", "order_no", "customer_id"],
                    calculatedFields: ["order_total"],
                    relationships: ["rel-orders-customers"]
                  }
                }
              ],
              relationships: [
                {
                  id: "rel-orders-customers",
                  name: "orders_to_customers",
                  source: "manual",
                  confidence: 0.92,
                  type: "many-to-one",
                  cardinality: "many-to-one",
                  bridge: {
                    left: { dataset: "analytics", table: "orders", column: "customer_id" },
                    right: { dataset: "analytics", table: "customers", column: "id" },
                    operator: "eq",
                    confidence: 0.92
                  }
                }
              ],
              calculatedFields: [
                {
                  id: "cf.orders.order_total",
                  modelId: "model.orders",
                  name: "order_total",
                  expression: "total_amount",
                  dataType: "numeric"
                }
              ],
              views: [
                {
                  id: "view.orders_recent",
                  name: "orders_recent",
                  sql: "SELECT id, total_amount FROM orders ORDER BY id DESC",
                  displayName: "Recent Orders",
                  description: "saved from chat",
                  position: { x: 580, y: 260 }
                }
              ],
              schemaChanges: []
            }
          }
        };
      }
      return {
        workspaceId: "ws-2",
        datasourceId: "ds-2b",
        activeRevision: 3,
        draft: {
          policyVersion: 11,
          revision: 3,
          graphHash: "hash-r3",
          updatedAt: "2026-04-24T00:05:00.000Z",
          graphPayload: {
            models: [
              {
                id: "model.orders",
                tableName: "orders",
                modelName: "orders",
                displayName: "Orders Model",
                description: null,
                position: { x: 120, y: 96 },
                columns: [
                  { name: "id", dataType: "integer", isPrimaryKey: true, isNullable: false },
                  { name: "order_no", dataType: "text", isPrimaryKey: false, isNullable: false },
                  {
                    name: "customer_id",
                    dataType: "integer",
                    isPrimaryKey: false,
                    isNullable: false
                  }
                ],
                nodeSections: {
                  columns: ["id", "order_no", "customer_id"],
                  calculatedFields: ["order_total"],
                  relationships: ["rel-orders-customers"]
                }
              }
            ],
            relationships: [
              {
                id: "rel-orders-customers",
                name: "orders_to_customers",
                source: "manual",
                confidence: 0.92,
                type: "many-to-one",
                cardinality: "many-to-one",
                bridge: {
                  left: { dataset: "analytics", table: "orders", column: "customer_id" },
                  right: { dataset: "analytics", table: "customers", column: "id" },
                  operator: "eq",
                  confidence: 0.92
                }
              }
            ],
            calculatedFields: [
              {
                id: "cf.orders.order_total",
                modelId: "model.orders",
                name: "order_total",
                expression: "total_amount",
                dataType: "numeric"
              }
            ],
            views: [],
            schemaChanges: []
          }
        }
      };
    });

    mockGetWorkspaceModelingPreview.mockResolvedValue({
      stage: "modeling_preview_ready",
      workspaceId: "ws-2",
      datasourceId: "ds-2b",
      targetKind: "view",
      targetId: "view.orders_recent",
      limit: 100,
      rowCount: 1,
      truncated: false,
      columns: ["id", "total_amount"],
      rows: [{ id: 101, total_amount: 88.9 }]
    });

    mockUpsertWorkspaceModelingGraph.mockImplementation(async (workspaceId, datasourceId, input) => ({
      workspaceId,
      datasourceId,
      activeRevision: 2,
      draft: {
        policyVersion: input.policyVersion,
        revision: 3,
        graphHash: "hash-r3",
        updatedAt: "2026-04-24T00:02:00.000Z",
        graphPayload: {
          models: input.models ?? [],
          relationships: input.relationships ?? [],
          calculatedFields: input.calculatedFields ?? [],
          views: input.views ?? [],
          schemaChanges: input.schemaChanges ?? []
        }
      }
    }));
    mockPrecheckWorkspaceModelingDeploy.mockResolvedValue({
      stage: "modeling_deploy_precheck_completed",
      workspaceId: "ws-2",
      datasourceId: "ds-2b",
      policyVersion: 11,
      draftRevision: 3,
      activeRevision: 2,
      pass: true,
      riskLevel: "low",
      blockingReasons: [],
      dryRun: {
        pass: true,
        executedCount: 1,
        failedSamples: []
      },
      schemaChange: {
        highRiskStatus: "low",
        unresolvedHighRiskCount: 0,
        unresolvedSchemaChangeIds: []
      }
    });
    mockDeployWorkspaceModeling.mockResolvedValue({
      stage: "modeling_deployed",
      workspaceId: "ws-2",
      datasourceId: "ds-2b",
      activeRevision: 3,
      graphHash: "hash-r3",
      blockingReasons: []
    });
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_MODELING_SHOW_SCHEMA_DEPLOY_PANELS = originalShowSchemaDeployPanels;
  });

  it("keeps save-as-view context, supports view delete, and completes deploy gating flow", async () => {
    const user = userEvent.setup();
    render(<ModelingWorkspacePage />);

    await waitFor(() => {
      expect(screen.getByTestId("modeling-top-status-bar")).toHaveTextContent(
        "Current Context: view · view.orders_recent"
      );
      expect(screen.getByTestId("modeling-top-status-bar")).toHaveTextContent(
        "Deploy State synced"
      );
    });

    expect(screen.queryByRole("button", { name: "加载 Data Preview" })).not.toBeInTheDocument();
    expect(mockGetWorkspaceModelingPreview).not.toHaveBeenCalled();

    await user.click(await screen.findByRole("button", { name: "删除 view Recent Orders" }));
    await waitFor(() => {
      expect(screen.getByTestId("modeling-top-status-bar")).toHaveTextContent(
        "Deploy State undeployed"
      );
    });
    expect(screen.getByRole("button", { name: "Precheck" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "保存 Modeling Draft" }));
    await waitFor(() => {
      expect(mockUpsertWorkspaceModelingGraph).toHaveBeenCalledWith(
        "ws-2",
        "ds-2b",
        expect.objectContaining({
          policyVersion: 11,
          models: [expect.objectContaining({ id: "model.orders", position: { x: 120, y: 96 } })],
          views: []
        })
      );
    });

    const precheckButton = screen.getByRole("button", { name: "Precheck" });
    await waitFor(() => {
      expect(precheckButton).toBeEnabled();
    });
    await user.click(precheckButton);
    await waitFor(() => {
      expect(mockPrecheckWorkspaceModelingDeploy).toHaveBeenCalledWith("ws-2", "ds-2b", {
        policyVersion: 11,
        draftRevision: 3
      });
    });

    const activateButton = screen.getByRole("button", { name: "Activate Revision" });
    await waitFor(() => {
      expect(activateButton).toBeEnabled();
    });
    await user.click(activateButton);
    await waitFor(() => {
      expect(mockDeployWorkspaceModeling).toHaveBeenCalledWith("ws-2", "ds-2b", {
        policyVersion: 11,
        draftRevision: 3
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("modeling-top-status-bar")).toHaveTextContent("Deploy State synced");
      expect(screen.getByText(/Deploy State: synced。当前无 undeployed revision。/)).toBeInTheDocument();
    });
  });

  it("publishes from top action after draft save and precheck", async () => {
    const user = userEvent.setup();
    render(<ModelingWorkspacePage />);

    await waitFor(() => {
      expect(screen.getByTestId("modeling-top-status-bar")).toHaveTextContent(
        "Deploy State synced"
      );
    });

    await user.click(await screen.findByRole("button", { name: "删除 view Recent Orders" }));
    await waitFor(() => {
      expect(screen.getByTestId("modeling-top-status-bar")).toHaveTextContent(
        "Deploy State undeployed"
      );
    });

    const publishButton = screen.getByRole("button", { name: "发布" });
    await waitFor(() => {
      expect(publishButton).toBeEnabled();
    });
    await user.click(publishButton);

    await waitFor(() => {
      expect(mockUpsertWorkspaceModelingGraph).toHaveBeenCalledWith(
        "ws-2",
        "ds-2b",
        expect.objectContaining({
          policyVersion: 11,
          views: []
        })
      );
      expect(mockPrecheckWorkspaceModelingDeploy).toHaveBeenCalledWith("ws-2", "ds-2b", {
        policyVersion: 11,
        draftRevision: 3
      });
      expect(mockDeployWorkspaceModeling).toHaveBeenCalledWith("ws-2", "ds-2b", {
        policyVersion: 11,
        draftRevision: 3
      });
    });
  });

  it("routes node action entries with keyboard support and opens relationship dialogs", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(<ModelingWorkspacePage />);
    const topStatusBar = screen.getByTestId("modeling-top-status-bar");

    await waitFor(() => {
      expect(screen.getByTestId("modeling-top-status-bar")).toHaveTextContent("Deploy State synced");
    });

    const addCalculatedFieldEntry = screen.getByRole("button", {
      name: "trigger-node-action-add-calculated-field"
    });
    addCalculatedFieldEntry.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(topStatusBar).toHaveTextContent("Current Context: model · model.orders");
      expect(screen.getByTestId("modeling-context-drawer")).toHaveAttribute("data-open", "true");
    });
    expect(screen.queryByRole("button", { name: "保存计算字段" })).not.toBeInTheDocument();

    const addRelationshipEntry = screen.getByRole("button", {
      name: "trigger-node-action-add-relationship"
    });
    addRelationshipEntry.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("dialog", { name: "Add relationship" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    const editRelationshipEntry = screen.getByRole("button", {
      name: "trigger-node-action-edit-relationship"
    });
    editRelationshipEntry.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("dialog", { name: "Edit relationship" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(topStatusBar).toHaveTextContent("Current Context: relationship · rel-orders-customers");
    confirmSpy.mockRestore();
  });
});
