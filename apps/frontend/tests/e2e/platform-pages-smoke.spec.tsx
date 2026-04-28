import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DataSourcesPage from "@/app/data-sources/page";
import DashboardsPage from "@/app/dashboards/page";
import GlossaryPage from "@/app/glossary/page";
import OverviewPage from "@/app/page";
import PromptsPage from "@/app/prompts/page";
import SettingsPage from "@/app/settings/page";
import { listGlossaryTerms, listPromptTemplates } from "@/lib/admin-api-client";
import { listDatasources } from "@/lib/api-client";

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
    createDatasource: vi.fn(),
    createSession: vi.fn(),
    uploadDatasourceFile: vi.fn()
  };
});

vi.mock("@/lib/admin-api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin-api-client")>();
  return {
    ...actual,
    listGlossaryTerms: vi.fn(),
    listPromptTemplates: vi.fn()
  };
});

const mockListDatasources = vi.mocked(listDatasources);
const mockListGlossaryTerms = vi.mocked(listGlossaryTerms);
const mockListPromptTemplates = vi.mocked(listPromptTemplates);

describe("platform pages smoke", () => {
  beforeEach(() => {
    mockListDatasources.mockResolvedValue([
      {
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
      }
    ]);
    mockListGlossaryTerms.mockResolvedValue({
      items: [
        {
          id: "gterm-1",
          term: "GMV",
          normalizedTerm: "gmv",
          definition: "gross merchandise value",
          synonyms: ["成交额"],
          scope: "global",
          scopeKey: "global",
          datasourceId: null,
          priority: 60,
          conflictResolution: "priority_then_updated_at",
          status: "active",
          version: 1,
          versionAnchorId: null,
          rollbackAnchorId: null,
          metadata: null,
          createdAt: "2026-04-10T00:00:00.000Z",
          updatedAt: "2026-04-10T00:00:00.000Z"
        }
      ],
      total: 1,
      page: 1,
      pageSize: 100
    });
    mockListPromptTemplates.mockResolvedValue({
      items: [
        {
          id: "prompt-sql-main",
          name: "MySQL 基础查询优化",
          scene: "sql",
          scopeType: "global",
          scopeId: null,
          scopeLabel: "全局",
          version: 2,
          status: "active",
          content: "SQL baseline",
          createdAt: "2026-04-10T00:00:00.000Z",
          updatedAt: "2026-04-10T00:00:00.000Z"
        }
      ],
      total: 1,
      page: 1,
      pageSize: 100
    });
  });

  it("renders overview page", async () => {
    render(<OverviewPage />);
    expect(await screen.findByText("Text2SQL 平台总览")).toBeInTheDocument();
  });

  it("renders data sources page", async () => {
    render(<DataSourcesPage />);
    expect(await screen.findByRole("heading", { name: "数据源" })).toBeInTheDocument();
    expect(await screen.findByText("SQLite 主数据源")).toBeInTheDocument();
  });

  it("shows clear-filter action when datasource filter returns empty", async () => {
    const user = userEvent.setup();
    render(<DataSourcesPage />);

    expect(await screen.findByText("SQLite 主数据源")).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("搜索"), "not-found");

    expect(
      await screen.findByText("暂无匹配数据源，请调整筛选或新建数据源。")
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(await screen.findByText("SQLite 主数据源")).toBeInTheDocument();
  });

  it("renders dashboards page", async () => {
    render(<DashboardsPage />);
    expect(await screen.findByRole("heading", { name: "我的看板" })).toBeInTheDocument();
  });

  it("renders glossary page", async () => {
    render(<GlossaryPage />);
    expect(await screen.findByText("业务术语库")).toBeInTheDocument();
  });

  it("renders prompts page", async () => {
    render(<PromptsPage />);
    expect(await screen.findByText("自定义提示词模板")).toBeInTheDocument();
  });

  it("renders settings page", async () => {
    render(<SettingsPage />);
    expect(await screen.findByText("LLM 模型")).toBeInTheDocument();
    expect(screen.queryByText("规则组")).not.toBeInTheDocument();
    expect(screen.queryByText("兼容路径")).not.toBeInTheDocument();
  });
});
