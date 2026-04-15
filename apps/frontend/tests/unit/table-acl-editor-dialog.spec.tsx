import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TableAclEditorDialog } from "@/components/settings/table-acl-editor-dialog";
import {
  listWorkspaceDatasourceBindings,
  listWorkspaceDatasourceTableAcl,
  listWorkspaceDatasourceTables,
  replaceWorkspaceDatasourceTableAcl
} from "@/lib/admin-api-client";

vi.mock("@/lib/admin-api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin-api-client")>();
  return {
    ...actual,
    listWorkspaceDatasourceBindings: vi.fn(),
    listWorkspaceDatasourceTableAcl: vi.fn(),
    listWorkspaceDatasourceTables: vi.fn(),
    replaceWorkspaceDatasourceTableAcl: vi.fn()
  };
});

const mockListBindings = vi.mocked(listWorkspaceDatasourceBindings);
const mockListAcl = vi.mocked(listWorkspaceDatasourceTableAcl);
const mockListTables = vi.mocked(listWorkspaceDatasourceTables);
const mockReplaceAcl = vi.mocked(replaceWorkspaceDatasourceTableAcl);

describe("TableAclEditorDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListBindings.mockResolvedValue([
      {
        id: "binding-1",
        workspaceId: "ws-1",
        datasourceId: "sqlite_main",
        datasourceName: "SQLite 主数据源",
        datasourceType: "sqlite",
        datasourceStatus: "available",
        createdAt: "2026-04-15T00:00:00.000Z",
        updatedAt: "2026-04-15T00:00:00.000Z"
      }
    ]);
    mockListAcl.mockResolvedValue([
      {
        id: "rule-1",
        workspaceId: "ws-1",
        datasourceId: "sqlite_main",
        tableName: "orders",
        subjectType: "role",
        subjectId: "member",
        effect: "allow",
        createdAt: "2026-04-15T00:00:00.000Z",
        updatedAt: "2026-04-15T00:00:00.000Z"
      }
    ]);
    mockListTables.mockResolvedValue(["orders", "users", "payments"]);
    mockReplaceAcl.mockResolvedValue({
      addedTables: ["users"],
      removedTables: [],
      retainedTables: ["orders"]
    });
  });

  it("loads datasource tables and saves checked ACL tables", async () => {
    const user = userEvent.setup();
    render(
      <TableAclEditorDialog
        open
        workspaceId="ws-1"
        workspaceName="默认工作空间"
        onOpenChange={() => undefined}
      />
    );

    await screen.findByText("表权限编辑器");
    await screen.findByText("orders");
    await screen.findByText("users");
    await waitFor(() => {
      expect(mockListTables).toHaveBeenCalledWith("ws-1", "sqlite_main");
    });

    const usersCheckbox = screen.getByRole("checkbox", { name: /users/i });
    await user.click(usersCheckbox);
    await user.click(screen.getByRole("button", { name: "保存规则" }));

    await waitFor(() => {
      expect(mockReplaceAcl).toHaveBeenCalledWith({
        workspaceId: "ws-1",
        datasourceId: "sqlite_main",
        subjectType: "role",
        subjectId: "member",
        effect: "allow",
        tableNames: expect.arrayContaining(["orders", "users"])
      });
    });
  });

  it("suppresses duplicate save clicks while request is in flight", async () => {
    const user = userEvent.setup();
    let resolveReplace:
      | ((value: { addedTables: string[]; removedTables: string[]; retainedTables: string[] }) => void)
      | undefined;
    mockReplaceAcl.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveReplace = resolve;
        })
    );

    render(
      <TableAclEditorDialog
        open
        workspaceId="ws-1"
        workspaceName="默认工作空间"
        onOpenChange={() => undefined}
      />
    );

    await screen.findByText("orders");
    const submitButton = screen.getByRole("button", { name: "保存规则" });
    await user.click(submitButton);
    await user.click(screen.getByRole("button", { name: "保存中..." }));

    expect(mockReplaceAcl).toHaveBeenCalledTimes(1);

    resolveReplace?.({
      addedTables: [],
      removedTables: [],
      retainedTables: ["orders"]
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "保存规则" })).toBeEnabled();
    });
  });
});
