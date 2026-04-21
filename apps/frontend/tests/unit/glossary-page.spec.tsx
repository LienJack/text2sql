import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Datasource, GlossaryTerm, UpsertGlossaryTermResponse } from "@text2sql/shared-types";
import GlossaryPage from "@/app/glossary/page";
import {
  AdminApiError,
  createGlossaryTerm,
  listGlossaryTerms,
  toggleGlossaryTerm,
  updateGlossaryTerm
} from "@/lib/admin-api-client";
import { listDatasources } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    listDatasources: vi.fn()
  };
});

vi.mock("@/lib/admin-api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin-api-client")>();
  return {
    ...actual,
    listGlossaryTerms: vi.fn(),
    createGlossaryTerm: vi.fn(),
    updateGlossaryTerm: vi.fn(),
    toggleGlossaryTerm: vi.fn()
  };
});

const mockListDatasources = vi.mocked(listDatasources);
const mockListGlossaryTerms = vi.mocked(listGlossaryTerms);
const mockCreateGlossaryTerm = vi.mocked(createGlossaryTerm);
const mockUpdateGlossaryTerm = vi.mocked(updateGlossaryTerm);
const mockToggleGlossaryTerm = vi.mocked(toggleGlossaryTerm);

const DATASOURCES: Datasource[] = [
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
];

const GLOBAL_TERM: GlossaryTerm = {
  id: "gterm-global-1",
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
};

const DATASOURCE_TERM: GlossaryTerm = {
  id: "gterm-ds-1",
  term: "订单",
  normalizedTerm: "订单",
  definition: "订单事实表",
  synonyms: ["order"],
  scope: "datasource",
  scopeKey: "datasource:sqlite_main",
  datasourceId: "sqlite_main",
  priority: 90,
  conflictResolution: "priority_then_updated_at",
  status: "active",
  version: 1,
  versionAnchorId: null,
  rollbackAnchorId: null,
  metadata: null,
  createdAt: "2026-04-10T00:00:00.000Z",
  updatedAt: "2026-04-10T00:00:00.000Z"
};

function listResult(items: GlossaryTerm[]) {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 100
  };
}

function upsertResponse(term: GlossaryTerm, overrides?: Partial<UpsertGlossaryTermResponse>): UpsertGlossaryTermResponse {
  return {
    term,
    linkageStatus: "success",
    conflictDecision: null,
    activeAnchor: null,
    ...overrides
  };
}

describe("GlossaryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListDatasources.mockResolvedValue(DATASOURCES);
  });

  it("supports create and update flows with scope/priority controls and linkage feedback", async () => {
    const user = userEvent.setup();
    const updatedGlobalTerm: GlossaryTerm = {
      ...GLOBAL_TERM,
      definition: "gross merchandise value updated",
      priority: 77,
      updatedAt: "2026-04-11T00:00:00.000Z"
    };

    mockListGlossaryTerms
      .mockResolvedValueOnce(listResult([GLOBAL_TERM]))
      .mockResolvedValueOnce(listResult([DATASOURCE_TERM, GLOBAL_TERM]))
      .mockResolvedValueOnce(listResult([DATASOURCE_TERM, updatedGlobalTerm]));

    mockCreateGlossaryTerm.mockResolvedValue(
      upsertResponse(DATASOURCE_TERM, {
        linkageStatus: "degraded",
        conflictDecision: {
          resolution: "priority_then_updated_at",
          winnerTermId: DATASOURCE_TERM.id,
          loserTermIds: [GLOBAL_TERM.id],
          winnerPriority: DATASOURCE_TERM.priority,
          winnerUpdatedAt: DATASOURCE_TERM.updatedAt
        }
      })
    );
    mockUpdateGlossaryTerm.mockResolvedValue(upsertResponse(updatedGlobalTerm));

    render(<GlossaryPage />);
    expect(await screen.findByText("GMV")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "新增术语" }));
    await user.type(screen.getByLabelText("术语名称"), "订单");
    await user.type(screen.getByLabelText("同义词"), "order");
    await user.type(screen.getByLabelText("定义"), "订单事实表");
    await user.selectOptions(screen.getByLabelText("作用范围"), "datasource");
    await user.selectOptions(screen.getByLabelText("数据源范围"), "sqlite_main");
    await user.clear(screen.getByLabelText("优先级（0-100）"));
    await user.type(screen.getByLabelText("优先级（0-100）"), "90");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(mockCreateGlossaryTerm).toHaveBeenCalledWith(
        {
          term: "订单",
          definition: "订单事实表",
          synonyms: ["order"],
          scope: "datasource",
          datasourceId: "sqlite_main",
          priority: 90
        },
        expect.objectContaining({ idempotencyKey: expect.any(String) })
      );
    });
    expect(await screen.findByText(/作用域规则：同名术语下，数据源作用域优先于全局。/)).toBeInTheDocument();
    expect(screen.getByText(/联动降级：术语已保存，RAG 联动当前处于降级状态。/)).toBeInTheDocument();

    const gmvRow = screen.getByText("GMV").closest("tr");
    expect(gmvRow).not.toBeNull();
    await user.click(within(gmvRow!).getByRole("button", { name: /编辑/ }));
    const definitionField = screen.getByLabelText("定义");
    await user.clear(definitionField);
    await user.type(definitionField, "gross merchandise value updated");
    await user.clear(screen.getByLabelText("优先级（0-100）"));
    await user.type(screen.getByLabelText("优先级（0-100）"), "77");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(mockUpdateGlossaryTerm).toHaveBeenCalledWith(
        GLOBAL_TERM.id,
        expect.objectContaining({
          definition: "gross merchandise value updated",
          priority: 77
        }),
        expect.objectContaining({ idempotencyKey: expect.any(String) })
      );
    });
    expect(await screen.findByText(/术语已更新。/)).toBeInTheDocument();
  });

  it("shows readable feedback when non-admin toggle gets 403", async () => {
    const user = userEvent.setup();

    mockListGlossaryTerms.mockResolvedValue(listResult([GLOBAL_TERM]));
    mockToggleGlossaryTerm.mockRejectedValue(
      new AdminApiError("仅管理员可执行该操作。", { code: "FORBIDDEN" })
    );

    render(<GlossaryPage />);
    expect(await screen.findByText("GMV")).toBeInTheDocument();

    await user.click(screen.getByLabelText("切换术语 GMV 状态"));

    expect(
      await screen.findByText("当前账号没有术语写权限（仅管理员可执行写操作）。")
    ).toBeInTheDocument();
  });
});
