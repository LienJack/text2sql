import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PromptsPage from "@/app/prompts/page";
import {
  AdminApiError,
  createPromptTemplate,
  deletePromptTemplate,
  listPromptTemplates,
  updatePromptTemplate,
  type PromptTemplate
} from "@/lib/admin-api-client";

vi.mock("@/lib/admin-api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin-api-client")>();
  return {
    ...actual,
    listPromptTemplates: vi.fn(),
    createPromptTemplate: vi.fn(),
    updatePromptTemplate: vi.fn(),
    deletePromptTemplate: vi.fn()
  };
});

const mockListPromptTemplates = vi.mocked(listPromptTemplates);
const mockCreatePromptTemplate = vi.mocked(createPromptTemplate);
const mockUpdatePromptTemplate = vi.mocked(updatePromptTemplate);
const mockDeletePromptTemplate = vi.mocked(deletePromptTemplate);

const SQL_TEMPLATE: PromptTemplate = {
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
};

const ANALYSIS_TEMPLATE: PromptTemplate = {
  id: "prompt-analysis-main",
  name: "营收分析总结模板",
  scene: "analysis",
  scopeType: "global",
  scopeId: null,
  scopeLabel: "全局",
  version: 1,
  status: "active",
  content: "analysis baseline",
  createdAt: "2026-04-10T00:00:00.000Z",
  updatedAt: "2026-04-10T00:00:00.000Z"
};

function listResult(items: PromptTemplate[]) {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 100
  };
}

async function fillCreateForm(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: "新增模板" }));
  await user.type(screen.getByLabelText("模板名称"), name);
  await user.type(screen.getByLabelText("模板内容"), "prompt template body");
}

describe("PromptsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListPromptTemplates.mockResolvedValue(listResult([SQL_TEMPLATE, ANALYSIS_TEMPLATE]));
  });

  it("supports create/edit/delete and keeps scene/search filters after mutations", async () => {
    const user = userEvent.setup();
    const createdTemplate: PromptTemplate = {
      ...SQL_TEMPLATE,
      id: "prompt-sql-new",
      name: "MySQL 高阶优化",
      version: 1
    };
    const updatedTemplate: PromptTemplate = {
      ...createdTemplate,
      name: "MySQL 高阶优化 V2",
      content: "updated template body",
      version: 2,
      updatedAt: "2026-04-11T00:00:00.000Z"
    };

    mockListPromptTemplates
      .mockResolvedValueOnce(listResult([SQL_TEMPLATE, ANALYSIS_TEMPLATE]))
      .mockResolvedValueOnce(listResult([SQL_TEMPLATE, ANALYSIS_TEMPLATE, createdTemplate]))
      .mockResolvedValueOnce(listResult([SQL_TEMPLATE, ANALYSIS_TEMPLATE, updatedTemplate]))
      .mockResolvedValueOnce(listResult([SQL_TEMPLATE, ANALYSIS_TEMPLATE]));
    mockCreatePromptTemplate.mockResolvedValue(createdTemplate);
    mockUpdatePromptTemplate.mockResolvedValue(updatedTemplate);
    mockDeletePromptTemplate.mockResolvedValue({ deleted: true });

    render(<PromptsPage />);
    expect(await screen.findByText("MySQL 基础查询优化")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "生成 SQL" }));
    await user.type(screen.getByPlaceholderText("搜索模板名称..."), "MySQL");
    expect(screen.queryByText("营收分析总结模板")).not.toBeInTheDocument();

    await fillCreateForm(user, "MySQL 高阶优化");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(mockCreatePromptTemplate).toHaveBeenCalledWith({
        name: "MySQL 高阶优化",
        scene: "sql",
        scopeType: "global",
        scopeId: undefined,
        status: "active",
        content: "prompt template body"
      });
    });

    expect(await screen.findByText("模板已创建。")).toBeInTheDocument();
    expect(await screen.findByText("MySQL 高阶优化")).toBeInTheDocument();
    expect(screen.queryByText("营收分析总结模板")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("搜索模板名称...")).toHaveValue("MySQL");

    await user.click(screen.getByRole("button", { name: "编辑模板 MySQL 高阶优化" }));
    const contentField = screen.getByLabelText("模板内容");
    await user.clear(contentField);
    await user.type(contentField, "updated template body");
    const nameField = screen.getByLabelText("模板名称");
    await user.clear(nameField);
    await user.type(nameField, "MySQL 高阶优化 V2");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(mockUpdatePromptTemplate).toHaveBeenCalledWith(
        createdTemplate.id,
        expect.objectContaining({
          name: "MySQL 高阶优化 V2",
          content: "updated template body"
        })
      );
    });

    expect(await screen.findByText("模板已更新。")).toBeInTheDocument();
    expect(await screen.findByText("MySQL 高阶优化 V2")).toBeInTheDocument();
    expect(screen.queryByText("营收分析总结模板")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("搜索模板名称...")).toHaveValue("MySQL");

    await user.click(screen.getByRole("button", { name: "删除模板 MySQL 高阶优化 V2" }));
    await waitFor(() => {
      expect(mockDeletePromptTemplate).toHaveBeenCalledWith(updatedTemplate.id);
    });

    expect(await screen.findByText("模板已删除。")).toBeInTheDocument();
    expect(screen.queryByText("MySQL 高阶优化 V2")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("搜索模板名称...")).toHaveValue("MySQL");
  });

  it.each([
    ["FORBIDDEN", "当前账号没有模板写权限（仅管理员可执行写操作）。"],
    ["CONFLICT", "当前作用域下已存在同名模板，请修改名称后重试。"],
    ["INTERNAL_ERROR", "服务暂时不可用，请稍后重试。"]
  ])("shows minimal error message for %s", async (code, expectedMessage) => {
    const user = userEvent.setup();

    mockCreatePromptTemplate.mockRejectedValue(
      new AdminApiError("request failed", { code })
    );

    render(<PromptsPage />);
    expect(await screen.findByText("MySQL 基础查询优化")).toBeInTheDocument();

    await fillCreateForm(user, "失败模板");
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText(expectedMessage)).toBeInTheDocument();
  });
});
