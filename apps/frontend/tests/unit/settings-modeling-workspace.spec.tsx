import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ModelingWorkspacePage from "@/app/settings/modeling/page";
import { ModelingCalculatedFieldEditor } from "@/components/settings/modeling/modeling-calculated-field-editor";
import {
  AdminApiError,
  getWorkspaceModelingPreview,
  getWorkspaceModelingGraph,
  listWorkspaceDatasourceBindings,
  listWorkspaceDatasourceTablePermissions,
  listWorkspaces,
  precheckWorkspaceModelingDeploy,
  upsertWorkspaceModelingGraph
} from "@/lib/admin-api-client";

vi.mock("@/components/settings/modeling/modeling-flow-canvas", () => ({
  ModelingFlowCanvas: (props: {
    graphPayload: {
      relationships: Array<{
        id: string;
        bridge: {
          left: { table: string; column: string };
          right: { table: string; column: string };
        };
      }>;
    };
    onSelectNode: (node: { kind: "relationship"; id: string } | null) => void;
    onNodePositionsChange?: (patch: {
      models: Record<string, { x: number; y: number }>;
      views: Record<string, { x: number; y: number }>;
    }) => void;
  }) => (
    <div data-testid="mock-modeling-flow-canvas">
      {props.graphPayload.relationships.map((relationship) => (
        <button
          key={relationship.id}
          type="button"
          onClick={() => {
            props.onSelectNode({
              kind: "relationship",
              id: relationship.id
            });
          }}
        >
          {`${relationship.bridge.left.table}.${relationship.bridge.left.column} = ${relationship.bridge.right.table}.${relationship.bridge.right.column}`}
        </button>
      ))}
      <button
        type="button"
        onClick={() => {
          props.onNodePositionsChange?.({
            models: {
              "model.orders": { x: 500, y: 320 }
            },
            views: {}
          });
        }}
      >
        trigger-position-change
      </button>
    </div>
  )
}));

vi.mock("@/lib/admin-api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin-api-client")>();
  return {
    ...actual,
    listWorkspaces: vi.fn(),
    listWorkspaceDatasourceBindings: vi.fn(),
    listWorkspaceDatasourceTablePermissions: vi.fn(),
    getWorkspaceModelingPreview: vi.fn(),
    getWorkspaceModelingGraph: vi.fn(),
    precheckWorkspaceModelingDeploy: vi.fn(),
    upsertWorkspaceModelingGraph: vi.fn()
  };
});

const mockListWorkspaces = vi.mocked(listWorkspaces);
const mockListWorkspaceDatasourceBindings = vi.mocked(listWorkspaceDatasourceBindings);
const mockListWorkspaceDatasourceTablePermissions = vi.mocked(
  listWorkspaceDatasourceTablePermissions
);
const mockGetWorkspaceModelingPreview = vi.mocked(getWorkspaceModelingPreview);
const mockGetWorkspaceModelingGraph = vi.mocked(getWorkspaceModelingGraph);
const mockPrecheckWorkspaceModelingDeploy = vi.mocked(precheckWorkspaceModelingDeploy);
const mockUpsertWorkspaceModelingGraph = vi.mocked(upsertWorkspaceModelingGraph);

async function waitForWorkspaceDatasourceReady(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByLabelText("选择工作空间")).toHaveValue("ws-2");
    expect(screen.getByLabelText("选择数据源")).toHaveValue("ds-2b");
  });
}

describe("ModelingWorkspacePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(
      {},
      "",
      "/modeling?workspaceId=ws-2&datasourceId=ds-2b"
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
    mockGetWorkspaceModelingPreview.mockResolvedValue({
      stage: "modeling_preview_ready",
      workspaceId: "ws-2",
      datasourceId: "ds-2b",
      targetKind: "model",
      targetId: "model.orders",
      limit: 100,
      rowCount: 1,
      truncated: false,
      columns: ["id", "total_amount"],
      rows: [{ id: 1, total_amount: 100.12 }]
    });

    mockPrecheckWorkspaceModelingDeploy.mockResolvedValue({
      stage: "modeling_deploy_precheck_completed",
      workspaceId: "ws-2",
      datasourceId: "ds-2b",
      policyVersion: 7,
      pass: true,
      riskLevel: "low",
      blockingReasons: [],
      draftRevision: 2,
      activeRevision: 1,
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

    await waitForWorkspaceDatasourceReady();
    await screen.findByRole("button", { name: "选择 model Orders Model" });
    expect(screen.getByTestId("modeling-mobile-quick-access")).toBeInTheDocument();

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

  it("auto-refreshes policyVersion and retries save when stale policy conflict occurs", async () => {
    const user = userEvent.setup();
    let permissionReadCount = 0;
    mockListWorkspaceDatasourceTablePermissions.mockImplementation(async () => {
      permissionReadCount += 1;
      return {
        workspaceId: "ws-2",
        datasourceId: "ds-2b",
        tableNames: ["orders"],
        policyVersion: permissionReadCount > 1 ? 8 : 7
      };
    });
    mockUpsertWorkspaceModelingGraph
      .mockRejectedValueOnce(
        new AdminApiError("policyVersion 已过期，请刷新后重试。", {
          code: "WORKSPACE_DATASOURCE_POLICY_VERSION_CONFLICT",
          details: {
            expectedPolicyVersion: 8,
            providedPolicyVersion: 7
          }
        })
      )
      .mockImplementationOnce(async (workspaceId, datasourceId, input) => ({
        workspaceId,
        datasourceId,
        activeRevision: 1,
        draft: {
          policyVersion: input.policyVersion,
          revision: 3,
          graphHash: "hash-r3-retried",
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

    render(<ModelingWorkspacePage />);

    await waitForWorkspaceDatasourceReady();
    await user.click(screen.getByRole("button", { name: "保存 Modeling Draft" }));

    await waitFor(() => {
      expect(mockUpsertWorkspaceModelingGraph).toHaveBeenCalledTimes(2);
      expect(mockUpsertWorkspaceModelingGraph).toHaveBeenNthCalledWith(
        2,
        "ws-2",
        "ds-2b",
        expect.objectContaining({
          policyVersion: 8
        })
      );
    });
    expect(
      screen.getByText(/policyVersion 已从 7 更新为 8，已自动重试并保存成功/)
    ).toBeInTheDocument();
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

    await waitForWorkspaceDatasourceReady();
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

  it("blocks deploy precheck when graph has unsaved local edits", async () => {
    const user = userEvent.setup();
    render(<ModelingWorkspacePage />);

    await waitForWorkspaceDatasourceReady();
    await screen.findByRole("button", { name: "选择 model Orders Model" });

    await user.clear(screen.getByRole("textbox", { name: "显示名称" }));
    await user.type(screen.getByRole("textbox", { name: "显示名称" }), "订单模型未保存");
    await user.click(screen.getByRole("button", { name: "保存 Metadata" }));

    expect(screen.getByRole("button", { name: "Precheck" })).toBeDisabled();
    expect(
      screen.getByText("Deploy State: undeployed。检测到未保存的 modeling 改动，请先保存 Modeling Draft。")
    ).toBeInTheDocument();
    expect(mockPrecheckWorkspaceModelingDeploy).not.toHaveBeenCalled();
  });

  it("treats position-only updates as pending draft changes and persists coordinates on save", async () => {
    const user = userEvent.setup();
    render(<ModelingWorkspacePage />);

    await waitForWorkspaceDatasourceReady();
    await user.click(screen.getByRole("button", { name: "trigger-position-change" }));

    expect(
      screen.getByText("Deploy State: undeployed。检测到未保存的 modeling 改动，请先保存 Modeling Draft。")
    ).toBeInTheDocument();

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
              position: { x: 500, y: 320 }
            })
          ]
        })
      );
    });
  });

  it("shows grouped calculated-field function hints and persists aggregate expression into draft", async () => {
    const user = userEvent.setup();
    render(<ModelingWorkspacePage />);

    await waitForWorkspaceDatasourceReady();
    await screen.findByRole("button", { name: "选择 model Orders Model" });

    await user.click(screen.getByRole("button", { name: "Calculated Field" }));
    expect(
      await screen.findByTestId("calculated-field-expression-function-groups")
    ).toBeInTheDocument();
    expect(screen.getByText("可用函数清单")).toBeInTheDocument();
    expect(screen.getByText(/聚合函数：sum\(expr\)、avg\(expr\)/)).toBeInTheDocument();
    expect(screen.getByText(/数学函数：abs\(x\)、round\(x, digits\)/)).toBeInTheDocument();
    expect(screen.getByText(/字符串函数：lower\(text\)、upper\(text\)/)).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "计算字段名称" }), "total_sum");
    await user.type(screen.getByRole("textbox", { name: "表达式" }), "sum(total_amount)");
    await user.type(screen.getByRole("textbox", { name: "数据类型" }), "numeric");
    await user.click(screen.getByRole("button", { name: "添加计算字段" }));
    await user.click(screen.getByRole("button", { name: "保存计算字段" }));
    await user.click(screen.getByRole("button", { name: "保存 Modeling Draft" }));

    await waitFor(() => {
      expect(mockUpsertWorkspaceModelingGraph).toHaveBeenCalledWith(
        "ws-2",
        "ds-2b",
        expect.objectContaining({
          calculatedFields: expect.arrayContaining([
            expect.objectContaining({
              name: "total_sum",
              expression: "sum(total_amount)"
            })
          ])
        })
      );
    });
  });

  it("maps backend calculated-field expression errors to readable grouped guidance", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue(
      new AdminApiError("calculated field expression 非法：函数 pow 不在支持清单中。", {
        code: "WORKSPACE_MODELING_GRAPH_CALCULATED_FIELD_EXPRESSION_INVALID",
        details: {
          category: "not-supported",
          reason: "函数 pow 不在支持清单中。",
          functionName: "pow",
          supportedFunctionGroups: {
            aggregate: ["sum", "avg"],
            math: ["abs", "round"],
            string: ["upper", "concat"]
          }
        }
      })
    );

    render(
      <ModelingCalculatedFieldEditor
        model={{
          id: "model.orders",
          tableName: "orders",
          modelName: "orders",
          displayName: "Orders",
          description: null,
          columns: []
        }}
        calculatedFields={[]}
        onSave={onSave}
      />
    );

    await user.type(screen.getByRole("textbox", { name: "计算字段名称" }), "pow_case");
    await user.type(screen.getByRole("textbox", { name: "表达式" }), "pow(total_amount, 2)");
    await user.type(screen.getByRole("textbox", { name: "数据类型" }), "numeric");
    await user.click(screen.getByRole("button", { name: "添加计算字段" }));
    await user.click(screen.getByRole("button", { name: "保存计算字段" }));

    expect(
      await screen.findByText(/表达式函数不在支持清单中（pow）/)
    ).toBeInTheDocument();
    expect(screen.getByText(/可用函数：聚合函数\(sum, avg\)/)).toBeInTheDocument();
  });

  it("creates model from sidebar and persists it into draft save payload", async () => {
    const user = userEvent.setup();
    render(<ModelingWorkspacePage />);

    await waitForWorkspaceDatasourceReady();
    await user.click(screen.getByRole("button", { name: "创建 model" }));
    await user.click(screen.getByRole("button", { name: "保存 Modeling Draft" }));

    await waitFor(() => {
      expect(mockUpsertWorkspaceModelingGraph).toHaveBeenCalledWith(
        "ws-2",
        "ds-2b",
        expect.objectContaining({
          models: expect.arrayContaining([
            expect.objectContaining({
              id: expect.stringMatching(/^model\.new_model_/),
              tableName: expect.stringMatching(/^new_model_/)
            })
          ])
        })
      );
    });
  });

  it("loads metadata preview for selected model", async () => {
    const user = userEvent.setup();
    render(<ModelingWorkspacePage />);

    await waitForWorkspaceDatasourceReady();
    await screen.findByRole("button", { name: "选择 model Orders Model" });
    await user.click(screen.getByRole("button", { name: "加载 Data Preview" }));

    await waitFor(() => {
      expect(mockGetWorkspaceModelingPreview).toHaveBeenCalledWith("ws-2", "ds-2b", {
        targetKind: "model",
        targetId: "model.orders",
        limit: 100
      });
    });
    expect(await screen.findByText("Preview Rows: 1")).toBeInTheDocument();
    expect(screen.getByText("100.12")).toBeInTheDocument();
  });

  it("supports view metadata save and view preview when selected from query viewId", async () => {
    const user = userEvent.setup();
    window.history.replaceState(
      {},
      "",
      "/modeling?workspaceId=ws-2&datasourceId=ds-2b&viewId=view.orders_recent"
    );

    mockGetWorkspaceModelingGraph.mockResolvedValueOnce({
      workspaceId: "ws-2",
      datasourceId: "ds-2b",
      activeRevision: 1,
      draft: {
        policyVersion: 7,
        revision: 2,
        graphHash: "hash-r2-with-view",
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
          views: [
            {
              id: "view.orders_recent",
              name: "orders_recent",
              sql: "SELECT id, total_amount FROM orders ORDER BY id DESC",
              displayName: "Recent Orders",
              description: "recent orders"
            }
          ],
          schemaChanges: []
        }
      }
    });
    mockGetWorkspaceModelingPreview.mockResolvedValueOnce({
      stage: "modeling_preview_ready",
      workspaceId: "ws-2",
      datasourceId: "ds-2b",
      targetKind: "view",
      targetId: "view.orders_recent",
      limit: 100,
      rowCount: 1,
      truncated: false,
      columns: ["id", "total_amount"],
      rows: [{ id: 99, total_amount: 410.5 }]
    });

    render(<ModelingWorkspacePage />);

    await waitForWorkspaceDatasourceReady();
    await waitFor(() => {
      expect(screen.getByTestId("modeling-top-status-bar")).toHaveTextContent(
        "Current Context: view · view.orders_recent"
      );
    });

    await user.click(screen.getByRole("button", { name: "加载 Data Preview" }));
    await waitFor(() => {
      expect(mockGetWorkspaceModelingPreview).toHaveBeenCalledWith("ws-2", "ds-2b", {
        targetKind: "view",
        targetId: "view.orders_recent",
        limit: 100
      });
    });
    expect(await screen.findByText("Preview Rows: 1")).toBeInTheDocument();
    expect(screen.getByText("410.5")).toBeInTheDocument();

    await user.clear(screen.getByRole("textbox", { name: "显示名称" }));
    await user.type(screen.getByRole("textbox", { name: "显示名称" }), "Recent Orders V2");
    await user.click(screen.getByRole("button", { name: "保存 Metadata" }));
    await user.click(screen.getByRole("button", { name: "保存 Modeling Draft" }));

    await waitFor(() => {
      expect(mockUpsertWorkspaceModelingGraph).toHaveBeenCalledWith(
        "ws-2",
        "ds-2b",
        expect.objectContaining({
          views: expect.arrayContaining([
            expect.objectContaining({
              id: "view.orders_recent",
              displayName: expect.stringContaining("Recent Orders V2")
            })
          ])
        })
      );
    });
  });

  it("deletes view from sidebar, flips deploy state to undeployed, and persists view removal", async () => {
    const user = userEvent.setup();
    mockGetWorkspaceModelingGraph.mockResolvedValueOnce({
      workspaceId: "ws-2",
      datasourceId: "ds-2b",
      activeRevision: 2,
      draft: {
        policyVersion: 7,
        revision: 2,
        graphHash: "hash-r2-synced",
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
          views: [
            {
              id: "view.orders_recent",
              name: "orders_recent",
              sql: "SELECT id, total_amount FROM orders ORDER BY id DESC",
              displayName: "Recent Orders",
              description: "recent orders"
            }
          ],
          schemaChanges: []
        }
      }
    });

    render(<ModelingWorkspacePage />);

    await waitForWorkspaceDatasourceReady();
    await waitFor(() => {
      expect(screen.getByTestId("modeling-top-status-bar")).toHaveTextContent(
        "Deploy State synced"
      );
    });

    await user.click(screen.getByRole("button", { name: "删除 view Recent Orders" }));
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
          views: []
        })
      );
    });
  });
});
