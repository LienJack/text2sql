import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Datasource } from "@text2sql/shared-types";
import DataSourcesPage from "@/app/data-sources/page";
import { listDatasources, submitDatasourceWorkflow } from "@/lib/api-client";
import {
  commitModelingSetup,
  listModelingSetupTables,
  listWorkspaces,
  recommendModelingSetupRelationships,
  saveModelingSetupSelectedTables
} from "@/lib/admin-api-client";

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush
  }),
  useSearchParams: () => new URLSearchParams()
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    listDatasources: vi.fn(),
    submitDatasourceWorkflow: vi.fn(),
    createSession: vi.fn(),
    uploadDatasourceFile: vi.fn()
  };
});

vi.mock("@/lib/admin-api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin-api-client")>();
  return {
    ...actual,
    listWorkspaces: vi.fn(),
    createWorkspace: vi.fn(),
    listModelingSetupTables: vi.fn(),
    saveModelingSetupSelectedTables: vi.fn(),
    recommendModelingSetupRelationships: vi.fn(),
    commitModelingSetup: vi.fn()
  };
});

const mockListDatasources = vi.mocked(listDatasources);
const mockSubmitDatasourceWorkflow = vi.mocked(submitDatasourceWorkflow);
const mockListWorkspaces = vi.mocked(listWorkspaces);
const mockListModelingSetupTables = vi.mocked(listModelingSetupTables);
const mockSaveModelingSetupSelectedTables = vi.mocked(saveModelingSetupSelectedTables);
const mockRecommendModelingSetupRelationships = vi.mocked(
  recommendModelingSetupRelationships
);
const mockCommitModelingSetup = vi.mocked(commitModelingSetup);

const MYSQL_DS: Datasource = {
  id: "mysql_main",
  name: "MySQL 主数据源",
  type: "mysql",
  status: "available",
  readonly: true,
  shared: true,
  config: {
    host: "127.0.0.1",
    port: 3306,
    database: "analytics",
    username: "root"
  },
  fileMeta: null,
  unavailableAt: null,
  deletedAt: null,
  createdAt: "2026-04-10T00:00:00.000Z",
  updatedAt: "2026-04-10T00:00:00.000Z"
};

async function openCreateToStep2(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("button", { name: "新增" }));
  await user.click(screen.getByRole("button", { name: /MySQL/i }));
  await user.click(screen.getByRole("button", { name: "下一步" }));

  await user.type(screen.getByPlaceholderText("数据源名称"), "测试 MySQL");
  await user.clear(screen.getByPlaceholderText("Host"));
  await user.type(screen.getByPlaceholderText("Host"), "127.0.0.1");
  await user.clear(screen.getByPlaceholderText("Database"));
  await user.type(screen.getByPlaceholderText("Database"), "analytics");
  await user.clear(screen.getByPlaceholderText("Username"));
  await user.type(screen.getByPlaceholderText("Username"), "root");
  await user.type(screen.getByPlaceholderText("Password"), "secret");
}

async function createDatasourceAndOpenSetupWizard(
  user: ReturnType<typeof userEvent.setup>
): Promise<void> {
  render(<DataSourcesPage />);
  await screen.findByText("MySQL 主数据源");
  await openCreateToStep2(user);
  await user.click(screen.getByRole("button", { name: "完成创建" }));
  await screen.findByText("建模设置向导");
}

describe("DataSourcesPage modeling setup wizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    window.sessionStorage.setItem("text2sql.activeWorkspaceId", "ws-new");

    mockListDatasources.mockResolvedValue([MYSQL_DS]);
    mockListWorkspaces.mockResolvedValue({
      items: [
        {
          id: "ws-new",
          name: "增长分析",
          isDefault: true
        }
      ],
      total: 1,
      page: 1,
      pageSize: 200
    });
    mockSubmitDatasourceWorkflow.mockResolvedValue({
      mode: "create",
      stage: "completed",
      workspaceId: "ws-new",
      datasourceId: "ds-created",
      replayed: false,
      bindingSummary: {
        bound: true,
        workspaceId: "ws-new",
        datasourceId: "ds-created"
      }
    });
    mockListModelingSetupTables.mockResolvedValue([
      { id: "orders", tableName: "orders" },
      { id: "customers", tableName: "customers" }
    ]);
    mockSaveModelingSetupSelectedTables.mockResolvedValue({
      workspaceId: "ws-new",
      datasourceId: "ds-created",
      selectedTables: ["customers", "orders"]
    });
    mockRecommendModelingSetupRelationships.mockResolvedValue([
      {
        id: "rel-orders-customers",
        name: "orders.customer_id = customers.id",
        confidence: 0.92,
        left: { dataset: "analytics", table: "orders", column: "customer_id" },
        right: { dataset: "analytics", table: "customers", column: "id" }
      }
    ]);
    mockCommitModelingSetup.mockResolvedValue({
      workspaceId: "ws-new",
      datasourceId: "ds-created",
      revision: 1
    });
  });

  it("runs setup wizard and navigates to modeling page after commit", async () => {
    const user = userEvent.setup();
    await createDatasourceAndOpenSetupWizard(user);

    await user.click(screen.getByRole("button", { name: "下一步：确认关系" }));
    await screen.findByText("orders.customer_id = customers.id");

    await user.click(screen.getByRole("button", { name: "完成设置并进入建模页" }));

    await waitFor(() => {
      expect(mockCommitModelingSetup).toHaveBeenCalledWith("ws-new", "ds-created", {
        selectedTables: ["customers", "orders"],
        selectedRecommendationIds: ["rel-orders-customers"]
      });
      expect(mockPush).toHaveBeenCalledWith("/settings/modeling?datasourceId=ds-created");
    });

    expect(window.sessionStorage.getItem("text2sql.activeWorkspaceId")).toBe("ws-new");
    expect(window.sessionStorage.getItem("text2sql.activeDatasourceId")).toBe("ds-created");
  }, 15000);

  it("allows continuing when recommendation list is empty", async () => {
    const user = userEvent.setup();
    mockRecommendModelingSetupRelationships.mockResolvedValueOnce([]);

    await createDatasourceAndOpenSetupWizard(user);
    await user.click(screen.getByRole("button", { name: "下一步：确认关系" }));

    await screen.findByText("暂无可推荐的关系，直接继续即可进入建模页面进行手动补充。");
    await user.click(screen.getByRole("button", { name: "继续进入建模页" }));

    await waitFor(() => {
      expect(mockCommitModelingSetup).toHaveBeenCalledWith("ws-new", "ds-created", {
        selectedTables: ["customers", "orders"],
        selectedRecommendationIds: []
      });
      expect(mockPush).toHaveBeenCalledWith("/settings/modeling?datasourceId=ds-created");
    });
  });

  it("keeps user selections after setup API error and retries successfully", async () => {
    const user = userEvent.setup();
    mockSaveModelingSetupSelectedTables
      .mockRejectedValueOnce(new Error("选表保存失败"))
      .mockResolvedValue({
        workspaceId: "ws-new",
        datasourceId: "ds-created",
        selectedTables: ["customers", "orders"]
      });
    mockRecommendModelingSetupRelationships.mockResolvedValue([]);

    await createDatasourceAndOpenSetupWizard(user);
    await user.click(screen.getByRole("button", { name: "下一步：确认关系" }));

    expect(await screen.findByText("选表保存失败")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "选择数据表 orders" })
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "选择数据表 customers" })
    ).toBeChecked();

    await user.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => {
      expect(mockSaveModelingSetupSelectedTables).toHaveBeenCalledTimes(2);
      expect(mockRecommendModelingSetupRelationships).toHaveBeenCalledTimes(1);
    });

    expect(mockSaveModelingSetupSelectedTables.mock.calls[1]?.[2]).toEqual({
      selectedTables: ["customers", "orders"]
    });
  });

  it("opens setup wizard from existing datasource card menu", async () => {
    const user = userEvent.setup();
    mockListWorkspaces.mockResolvedValueOnce({
      items: [
        {
          id: "ws-existing",
          name: "默认工作空间",
          isDefault: true
        }
      ],
      total: 1,
      page: 1,
      pageSize: 200
    });

    render(<DataSourcesPage />);
    await screen.findByText("MySQL 主数据源");

    await user.click(screen.getByRole("button", { name: "更多操作" }));
    await user.click(screen.getByRole("menuitem", { name: "建模设置" }));

    expect(await screen.findByText("建模设置向导")).toBeInTheDocument();
    await waitFor(() => {
      expect(mockListModelingSetupTables).toHaveBeenCalledWith("ws-existing", "mysql_main");
    });
  });
});
