import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceDatasourceTablePermissionsPanel } from "@/components/settings/workspace-datasource-table-permissions-panel";
import {
  AdminApiError,
  listWorkspaceDatasourceBindings,
  listWorkspaceDatasourceTablePermissions,
  listWorkspaceDatasourceTables,
  replaceWorkspaceDatasourceTablePermissions
} from "@/lib/admin-api-client";

vi.mock("@/lib/admin-api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin-api-client")>();
  return {
    ...actual,
    listWorkspaceDatasourceBindings: vi.fn(),
    listWorkspaceDatasourceTables: vi.fn(),
    listWorkspaceDatasourceTablePermissions: vi.fn(),
    replaceWorkspaceDatasourceTablePermissions: vi.fn()
  };
});

const mockListWorkspaceDatasourceBindings = vi.mocked(listWorkspaceDatasourceBindings);
const mockListWorkspaceDatasourceTables = vi.mocked(listWorkspaceDatasourceTables);
const mockListWorkspaceDatasourceTablePermissions = vi.mocked(
  listWorkspaceDatasourceTablePermissions
);
const mockReplaceWorkspaceDatasourceTablePermissions = vi.mocked(
  replaceWorkspaceDatasourceTablePermissions
);

describe("WorkspaceDatasourceTablePermissionsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListWorkspaceDatasourceBindings.mockResolvedValue([
      {
        id: "binding-1",
        workspaceId: "ws-1",
        datasourceId: "ds-main",
        datasourceName: "主数据源",
        datasourceType: "sqlite",
        datasourceStatus: "available",
        createdAt: "2026-04-16T00:00:00.000Z",
        updatedAt: "2026-04-16T00:00:00.000Z"
      }
    ]);
    mockListWorkspaceDatasourceTables.mockResolvedValue([
      "orders",
      "order_items",
      "users"
    ]);
    mockListWorkspaceDatasourceTablePermissions.mockResolvedValue({
      workspaceId: "ws-1",
      datasourceId: "ds-main",
      tableNames: ["users"],
      policyVersion: 1
    });
    mockReplaceWorkspaceDatasourceTablePermissions.mockResolvedValue({
      workspaceId: "ws-1",
      datasourceId: "ds-main",
      tableNames: ["order_items", "orders", "users"],
      policyVersion: 2,
      beforeCount: 1,
      afterCount: 3,
      addedCount: 2,
      removedCount: 0,
      retainedCount: 1,
      addedTables: ["order_items", "orders"],
      removedTables: []
    });
  });

  it("supports filtered bulk select and save", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceDatasourceTablePermissionsPanel
        actorRole="admin"
        workspaceId="ws-1"
        workspaceName="默认空间"
      />
    );

    expect(await screen.findByText("users")).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("搜索表名"), "order");
    await user.click(screen.getByRole("button", { name: /全选筛选结果（2）/ }));
    await user.click(screen.getByRole("button", { name: "保存权限" }));

    await waitFor(() => {
      expect(mockReplaceWorkspaceDatasourceTablePermissions).toHaveBeenCalledWith(
        "ws-1",
        "ds-main",
        expect.objectContaining({
          tableNames: ["order_items", "orders", "users"],
          policyVersion: 1
        })
      );
    });

    const successMessages = await screen.findAllByText(
      /已保存并作用于工作空间全部成员。当前授权 3 张表，较上次减少 0 张。/
    );
    expect(successMessages.length).toBeGreaterThan(0);
  });

  it("locks datasource context in fixed datasource mode", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceDatasourceTablePermissionsPanel
        actorRole="admin"
        workspaceId="ws-1"
        workspaceName="默认空间"
        fixedDatasourceId="ds-main"
        fixedDatasourceName="主数据源"
        hideDatasourceSelector
      />
    );

    expect(await screen.findByText("users")).toBeInTheDocument();
    expect(screen.queryByLabelText("选择数据源")).not.toBeInTheDocument();
    expect(screen.getByText("数据源：主数据源")).toBeInTheDocument();
    expect(mockListWorkspaceDatasourceBindings).not.toHaveBeenCalled();

    await user.click(screen.getByRole("checkbox", { name: "orders" }));
    await user.click(screen.getByRole("button", { name: "保存权限" }));

    await waitFor(() => {
      expect(mockReplaceWorkspaceDatasourceTablePermissions).toHaveBeenCalledWith(
        "ws-1",
        "ds-main",
        expect.objectContaining({
          tableNames: ["orders", "users"],
          policyVersion: 1
        })
      );
    });
  });

  it("preserves local draft and shows retry/refresh on 409 conflict", async () => {
    const user = userEvent.setup();
    mockReplaceWorkspaceDatasourceTablePermissions
      .mockRejectedValueOnce(
        new AdminApiError("策略版本冲突", {
          code: "POLICY_VERSION_CONFLICT",
          details: {
            latestPolicyVersion: 2,
            afterCount: 3,
            addedCount: 1,
            removedCount: 0,
            statusCode: 409
          }
        })
      )
      .mockResolvedValueOnce({
        workspaceId: "ws-1",
        datasourceId: "ds-main",
        tableNames: ["orders", "users"],
        policyVersion: 2,
        beforeCount: 1,
        afterCount: 2,
        addedCount: 1,
        removedCount: 0,
        retainedCount: 1,
        addedTables: ["orders"],
        removedTables: []
      });

    render(
      <WorkspaceDatasourceTablePermissionsPanel
        actorRole="admin"
        workspaceId="ws-1"
        workspaceName="默认空间"
      />
    );

    expect(await screen.findByText("users")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "orders" }));
    await user.click(screen.getByRole("button", { name: "保存权限" }));

    expect(
      await screen.findByText("保存冲突：已保留本地草稿，可刷新服务端快照后重试。")
    ).toBeInTheDocument();
    expect(
      screen.getByText("服务端当前授权 3 张表；最近变更：新增 1，移除 0")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试保存" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新服务端" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "orders" })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "重试保存" }));
    await waitFor(() => {
      expect(mockReplaceWorkspaceDatasourceTablePermissions).toHaveBeenNthCalledWith(
        2,
        "ws-1",
        "ds-main",
        expect.objectContaining({
          tableNames: ["orders", "users"],
          policyVersion: 2
        })
      );
    });
  });

  it("reuses idempotency key when retrying the same failed save intent", async () => {
    const user = userEvent.setup();
    mockReplaceWorkspaceDatasourceTablePermissions
      .mockRejectedValueOnce(new Error("请求超时（>15s），请重试。"))
      .mockResolvedValueOnce({
        workspaceId: "ws-1",
        datasourceId: "ds-main",
        tableNames: ["orders", "users"],
        policyVersion: 2,
        beforeCount: 1,
        afterCount: 2,
        addedCount: 1,
        removedCount: 0,
        retainedCount: 1,
        addedTables: ["orders"],
        removedTables: []
      });

    render(
      <WorkspaceDatasourceTablePermissionsPanel
        actorRole="admin"
        workspaceId="ws-1"
        workspaceName="默认空间"
      />
    );

    expect(await screen.findByText("users")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "orders" }));
    await user.click(screen.getByRole("button", { name: "保存权限" }));

    expect(await screen.findByText("请求超时（>15s），请重试。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试保存" }));

    await waitFor(() => {
      expect(mockReplaceWorkspaceDatasourceTablePermissions).toHaveBeenCalledTimes(2);
    });

    const firstCallPayload = mockReplaceWorkspaceDatasourceTablePermissions.mock.calls[0]?.[2];
    const secondCallPayload = mockReplaceWorkspaceDatasourceTablePermissions.mock.calls[1]?.[2];
    expect(firstCallPayload?.idempotencyKey).toBeTruthy();
    expect(secondCallPayload?.idempotencyKey).toBe(firstCallPayload?.idempotencyKey);
  });

  it("supports one-click restore to previous snapshot after save", async () => {
    const user = userEvent.setup();
    mockReplaceWorkspaceDatasourceTablePermissions
      .mockResolvedValueOnce({
        workspaceId: "ws-1",
        datasourceId: "ds-main",
        tableNames: ["order_items", "orders", "users"],
        policyVersion: 2,
        beforeCount: 1,
        afterCount: 3,
        addedCount: 2,
        removedCount: 0,
        retainedCount: 1,
        addedTables: ["order_items", "orders"],
        removedTables: []
      })
      .mockResolvedValueOnce({
        workspaceId: "ws-1",
        datasourceId: "ds-main",
        tableNames: ["users"],
        policyVersion: 3,
        beforeCount: 3,
        afterCount: 1,
        addedCount: 0,
        removedCount: 2,
        retainedCount: 1,
        addedTables: [],
        removedTables: ["order_items", "orders"]
      });

    render(
      <WorkspaceDatasourceTablePermissionsPanel
        actorRole="admin"
        workspaceId="ws-1"
        workspaceName="默认空间"
      />
    );

    expect(await screen.findByText("users")).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("搜索表名"), "order");
    await user.click(screen.getByRole("button", { name: /全选筛选结果（2）/ }));
    await user.click(screen.getByRole("button", { name: "保存权限" }));
    await screen.findByRole("button", { name: "恢复上一次版本" });

    await user.click(screen.getByRole("button", { name: "恢复上一次版本" }));
    await waitFor(() => {
      expect(mockReplaceWorkspaceDatasourceTablePermissions).toHaveBeenNthCalledWith(
        2,
        "ws-1",
        "ds-main",
        expect.objectContaining({
          tableNames: ["users"],
          policyVersion: 2
        })
      );
    });

    const restoreMessages = await screen.findAllByText(
      "已恢复到上一版本快照并作用于工作空间全部成员。当前授权 1 张表，较上次减少 2 张。"
    );
    expect(restoreMessages.length).toBeGreaterThan(0);
  });

  it("does not expose governance actions to non-admin users", () => {
    render(
      <WorkspaceDatasourceTablePermissionsPanel
        actorRole="user"
        workspaceId="ws-1"
        workspaceName="默认空间"
      />
    );

    expect(screen.getByText("当前账号不可管理工作空间表权限。")).toBeInTheDocument();
    expect(mockListWorkspaceDatasourceBindings).not.toHaveBeenCalled();
    expect(mockListWorkspaceDatasourceTables).not.toHaveBeenCalled();
    expect(mockListWorkspaceDatasourceTablePermissions).not.toHaveBeenCalled();
  });
});
