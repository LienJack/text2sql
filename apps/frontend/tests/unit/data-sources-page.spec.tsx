import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Datasource } from "@text2sql/shared-types";
import DataSourcesPage from "@/app/data-sources/page";
import {
  createDatasource,
  createSession,
  listDatasources,
  uploadDatasourceFile
} from "@/lib/api-client";

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush
  })
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    listDatasources: vi.fn(),
    createDatasource: vi.fn(),
    createSession: vi.fn(),
    uploadDatasourceFile: vi.fn()
  };
});

const mockListDatasources = vi.mocked(listDatasources);
const mockCreateDatasource = vi.mocked(createDatasource);
const mockCreateSession = vi.mocked(createSession);
const mockUploadDatasourceFile = vi.mocked(uploadDatasourceFile);

const SQLITE_MAIN: Datasource = {
  id: "sqlite_main",
  name: "SQLite 主数据源",
  type: "sqlite",
  status: "available",
  readonly: true,
  shared: true,
  config: null,
  fileMeta: null,
  unavailableAt: null,
  deletedAt: null,
  createdAt: "2026-04-10T00:00:00.000Z",
  updatedAt: "2026-04-10T00:00:00.000Z"
};

async function openWizardToStep3(user: ReturnType<typeof userEvent.setup>): Promise<void> {
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

  await user.click(screen.getByRole("button", { name: "下一步" }));
  expect(screen.getByText("接入范围确认")).toBeInTheDocument();
}

describe("DataSourcesPage onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListDatasources.mockResolvedValue([SQLITE_MAIN]);
    mockCreateDatasource.mockResolvedValue({
      ...SQLITE_MAIN,
      id: "ds-mysql-1",
      name: "测试 MySQL",
      type: "mysql",
      config: { host: "127.0.0.1", port: 3306, database: "analytics" }
    });
    mockCreateSession.mockResolvedValue({
      id: "session-1",
      datasource: "ds-mysql-1",
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
    mockUploadDatasourceFile.mockResolvedValue({
      ...SQLITE_MAIN,
      id: "ds-csv-1",
      name: "CSV 数据源",
      type: "csv"
    });
  });

  it("shows retry CTA for auth/network preflight failures", async () => {
    const user = userEvent.setup();
    mockCreateDatasource.mockRejectedValueOnce(
      new Error("连接认证失败 [CONNECTION_AUTH_FAILED]")
    );

    render(<DataSourcesPage />);
    await screen.findByText("SQLite 主数据源");
    await openWizardToStep3(user);

    await user.click(screen.getByRole("button", { name: "完成创建" }));

    expect(await screen.findByText("连接认证失败")).toBeInTheDocument();
    expect(
      screen.getByText("请检查用户名和密码后重试当前步骤。")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });

  it("shows previous-step CTA for config-invalid/database-not-found failures", async () => {
    const user = userEvent.setup();
    mockCreateDatasource.mockRejectedValueOnce(
      new Error("连接配置缺失 [CONNECTION_CONFIG_INVALID]")
    );

    render(<DataSourcesPage />);
    await screen.findByText("SQLite 主数据源");
    await openWizardToStep3(user);

    await user.click(screen.getByRole("button", { name: "完成创建" }));

    expect(await screen.findByText("连接配置缺失")).toBeInTheDocument();
    const previousButton = screen.getAllByRole("button", { name: "上一步" })[0];
    await user.click(previousButton);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Host")).toBeInTheDocument();
    });
  });
});
