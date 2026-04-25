import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Datasource } from "@text2sql/shared-types";
import DataSourcesPage from "@/app/data-sources/page";
import {
  DatasourceApiError,
  createSession,
  listDatasources,
  submitDatasourceWorkflow
} from "@/lib/api-client";
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
  useSearchParams: () =>
    new URLSearchParams()
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
const mockCreateSession = vi.mocked(createSession);
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

async function openCreateSqliteToStep2(
  user: ReturnType<typeof userEvent.setup>
): Promise<void> {
  await user.click(screen.getByRole("button", { name: "新增" }));
  await user.click(screen.getByRole("button", { name: /SQLite 数据库连接/i }));
  await user.click(screen.getByRole("button", { name: "下一步" }));
  await user.type(screen.getByPlaceholderText("数据源名称"), "测试 SQLite");
  await user.type(
    screen.getByPlaceholderText("例如 /Users/alice/data/sqlite/chinook.db"),
    "/tmp/chinook.db"
  );
}

describe("DataSourcesPage workflow closure", () => {
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
    mockListModelingSetupTables.mockResolvedValue([
      { id: "orders", tableName: "orders" },
      { id: "customers", tableName: "customers" }
    ]);
    mockSaveModelingSetupSelectedTables.mockResolvedValue({
      workspaceId: "ws-new",
      datasourceId: "ds-created",
      selectedTableNames: ["orders", "customers"]
    });
    mockRecommendModelingSetupRelationships.mockResolvedValue([]);
    mockCommitModelingSetup.mockResolvedValue({
      workspaceId: "ws-new",
      datasourceId: "ds-created"
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
    mockCreateSession.mockResolvedValue({
      id: "session-1",
      datasource: "ds-created",
      datasourceName: "测试 MySQL",
      datasourceType: "mysql",
      datasourceStatus: "available",
      syncStatus: "healthy",
      title: "新会话",
      modelCatalogId: "model-1",
      modelProvider: "openai",
      modelName: "gpt-4o-mini",
      debugEnabled: false,
      createdAt: "2026-04-10T00:00:00.000Z"
    });
  });

  it(
    "completes create workflow with active workspace binding",
    async () => {
    const user = userEvent.setup();
    render(<DataSourcesPage />);

    await screen.findByText("MySQL 主数据源");
    await openCreateToStep2(user);

    await user.click(screen.getByRole("button", { name: "完成创建" }));

    await waitFor(() => {
      expect(mockSubmitDatasourceWorkflow).toHaveBeenCalledTimes(1);
    });

    const workflowPayload = mockSubmitDatasourceWorkflow.mock.calls[0]?.[0];
    expect(workflowPayload).toMatchObject({
      mode: "create",
      workspaceId: "ws-new"
    });
    expect(workflowPayload).not.toHaveProperty("acl");
    expect(mockSubmitDatasourceWorkflow.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ idempotencyKey: expect.any(String) })
    );
    },
    15000
  );

  it(
    "reuses idempotency key between retries of the same submit",
    async () => {
    const user = userEvent.setup();
    mockSubmitDatasourceWorkflow
      .mockRejectedValueOnce(
        new DatasourceApiError("绑定失败", {
          code: "BINDING_APPLY_FAILED",
          stage: "binding_apply_failed"
        })
      )
      .mockResolvedValueOnce({
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

    render(<DataSourcesPage />);
    await screen.findByText("MySQL 主数据源");
    await openCreateToStep2(user);

    await user.click(screen.getByRole("button", { name: "完成创建" }));
    expect(await screen.findByText("绑定失败")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => {
      expect(mockSubmitDatasourceWorkflow).toHaveBeenCalledTimes(2);
    });

    const firstKey = mockSubmitDatasourceWorkflow.mock.calls[0]?.[1]?.idempotencyKey;
    const secondKey = mockSubmitDatasourceWorkflow.mock.calls[1]?.[1]?.idempotencyKey;
    expect(firstKey).toBeTruthy();
    expect(secondKey).toBe(firstKey);
    },
    15000
  );

  it(
    "supports creating sqlite datasource from wizard",
    async () => {
      const user = userEvent.setup();
      render(<DataSourcesPage />);

      await screen.findByText("MySQL 主数据源");
      await openCreateSqliteToStep2(user);
      await user.click(screen.getByRole("button", { name: "完成创建" }));

      await waitFor(() => {
        expect(mockSubmitDatasourceWorkflow).toHaveBeenCalledTimes(1);
      });

      const workflowPayload = mockSubmitDatasourceWorkflow.mock.calls[0]?.[0];
      expect(workflowPayload).toMatchObject({
        mode: "create",
        workspaceId: "ws-new",
        datasource: {
          name: "测试 SQLite",
          type: "sqlite",
          shared: true,
          filePath: "/tmp/chinook.db"
        }
      });
    },
    15000
  );

  it(
    "blocks sqlite create when file path is not absolute",
    async () => {
      const user = userEvent.setup();
      render(<DataSourcesPage />);

      await screen.findByText("MySQL 主数据源");
      await user.click(screen.getByRole("button", { name: "新增" }));
      await user.click(screen.getByRole("button", { name: /SQLite 数据库连接/i }));
      await user.click(screen.getByRole("button", { name: "下一步" }));
      await user.type(screen.getByPlaceholderText("数据源名称"), "测试 SQLite");
      await user.type(
        screen.getByPlaceholderText("例如 /Users/alice/data/sqlite/chinook.db"),
        "relative/chinook.db"
      );
      await user.click(screen.getByRole("button", { name: "完成创建" }));

      expect(
        await screen.findByText(
          "SQLite 路径必须是绝对路径（例如 /Users/name/data/demo.db）。"
        )
      ).toBeInTheDocument();
      expect(mockSubmitDatasourceWorkflow).not.toHaveBeenCalled();
    },
    15000
  );
});
