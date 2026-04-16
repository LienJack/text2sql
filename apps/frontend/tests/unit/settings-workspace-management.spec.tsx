import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceManagementPanel } from "@/components/settings/workspace-management-panel";
import {
  addWorkspaceMembers,
  createWorkspace,
  listUsers,
  listWorkspaceDatasourceBindings,
  listWorkspaceMembers,
  listWorkspaces,
  removeWorkspaceMembersBatch,
  renameWorkspace,
  updateWorkspaceMemberRole
} from "@/lib/admin-api-client";

vi.mock("@/lib/admin-api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin-api-client")>();
  return {
    ...actual,
    listWorkspaces: vi.fn(),
    listWorkspaceMembers: vi.fn(),
    createWorkspace: vi.fn(),
    renameWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
    listWorkspaceDatasourceBindings: vi.fn(),
    listUsers: vi.fn(),
    addWorkspaceMembers: vi.fn(),
    updateWorkspaceMemberRole: vi.fn(),
    removeWorkspaceMember: vi.fn(),
    removeWorkspaceMembersBatch: vi.fn()
  };
});

vi.mock("@/components/settings/workspace-datasource-table-permissions-dialog", () => ({
  WorkspaceDatasourceTablePermissionsDialog: ({
    open,
    datasourceId
  }: {
    open: boolean;
    datasourceId: string;
  }) => (open ? <div>{`table-permissions-dialog:${datasourceId}`}</div> : null)
}));

const mockListWorkspaces = vi.mocked(listWorkspaces);
const mockListWorkspaceMembers = vi.mocked(listWorkspaceMembers);
const mockCreateWorkspace = vi.mocked(createWorkspace);
const mockRenameWorkspace = vi.mocked(renameWorkspace);
const mockListUsers = vi.mocked(listUsers);
const mockListWorkspaceDatasourceBindings = vi.mocked(listWorkspaceDatasourceBindings);
const mockAddWorkspaceMembers = vi.mocked(addWorkspaceMembers);
const mockUpdateWorkspaceMemberRole = vi.mocked(updateWorkspaceMemberRole);
const mockRemoveWorkspaceMembersBatch = vi.mocked(removeWorkspaceMembersBatch);

const WORKSPACES = [
  { id: "ws-1", name: "默认空间", isDefault: true, memberCount: 2, createdAt: "2026-04-15T00:00:00.000Z" },
  { id: "ws-2", name: "增长分析", isDefault: false, memberCount: 1, createdAt: "2026-04-15T00:00:00.000Z" }
];

const MEMBERS = [
  {
    id: "m-1",
    userId: "u-1",
    account: "alice",
    name: "Alice",
    email: "alice@example.com",
    role: "member" as const,
    status: "active" as const,
    createdAt: "2026-04-15T00:00:00.000Z"
  },
  {
    id: "m-2",
    userId: "u-2",
    account: "bob",
    name: "Bob",
    email: "bob@example.com",
    role: "member" as const,
    status: "active" as const,
    createdAt: "2026-04-15T00:00:00.000Z"
  }
];

describe("WorkspaceManagementPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockListWorkspaces.mockResolvedValue({
      items: WORKSPACES,
      total: 2,
      page: 1,
      pageSize: 200
    });

    mockListWorkspaceMembers.mockResolvedValue({
      items: MEMBERS,
      total: 2,
      page: 1,
      pageSize: 10
    });

    mockCreateWorkspace.mockResolvedValue(WORKSPACES[1]);
    mockRenameWorkspace.mockResolvedValue({ ...WORKSPACES[1], name: "增长分析-新" });

    mockListUsers.mockResolvedValue({
      items: [
        {
          id: "u-3",
          account: "charlie",
          name: "Charlie",
          email: "charlie@example.com",
          status: "active",
          isSystemAdmin: false,
          workspaces: [],
          variables: {},
          createdAt: "2026-04-15T00:00:00.000Z"
        }
      ],
      total: 1,
      page: 1,
      pageSize: 100
    });
    mockListWorkspaceDatasourceBindings.mockResolvedValue([
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

    mockAddWorkspaceMembers.mockResolvedValue({ addedCount: 1 });
    mockUpdateWorkspaceMemberRole.mockResolvedValue({ ...MEMBERS[0], role: "admin" });
    mockRemoveWorkspaceMembersBatch.mockResolvedValue({ removedCount: 1, failedCount: 0 });
  });

  it("supports create and rename workspace", async () => {
    const user = userEvent.setup();

    render(<WorkspaceManagementPanel actorRole="admin" />);
    await screen.findByText("默认空间");

    await user.click(screen.getByLabelText("新建工作空间"));
    await user.type(screen.getByLabelText("工作空间名称"), "增长分析");
    await user.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => {
      expect(mockCreateWorkspace).toHaveBeenCalledWith({ name: "增长分析" });
    });

    await user.click(screen.getByLabelText("重命名工作空间 增长分析"));
    const nameInput = screen.getByLabelText("工作空间名称");
    await user.clear(nameInput);
    await user.type(nameInput, "增长分析-新");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(mockRenameWorkspace).toHaveBeenCalledWith("ws-2", { name: "增长分析-新" });
    });
  });

  it("supports add members, update role and batch remove", async () => {
    const user = userEvent.setup();

    render(<WorkspaceManagementPanel actorRole="admin" />);
    await screen.findByText("成员管理 · 默认空间");

    await user.click(screen.getByRole("button", { name: "添加成员" }));
    await screen.findByText("Charlie");

    await user.click(screen.getByLabelText("选择用户 Charlie"));
    await user.click(screen.getByRole("button", { name: "确认添加" }));

    await waitFor(() => {
      expect(mockAddWorkspaceMembers).toHaveBeenCalledWith("ws-1", [
        {
          userId: "u-3",
          role: "member"
        }
      ]);
    });

    const aliceRow = screen.getByText("Alice").closest("tr");
    expect(aliceRow).not.toBeNull();
    const roleSelect = within(aliceRow as HTMLElement).getByRole("combobox");
    await user.selectOptions(roleSelect, "admin");

    await waitFor(() => {
      expect(mockUpdateWorkspaceMemberRole).toHaveBeenCalledWith("ws-1", "m-1", "admin");
    });

    await user.click(screen.getByLabelText("选择成员 Alice"));
    await user.click(screen.getByRole("button", { name: /批量移除 \(1\)/ }));
    await user.click(screen.getByRole("button", { name: "执行移除" }));

    await waitFor(() => {
      expect(mockRemoveWorkspaceMembersBatch).toHaveBeenCalledWith("ws-1", ["m-1"]);
    });
  });

  it("shows workspace datasource bindings list and opens table permissions dialog", async () => {
    const user = userEvent.setup();
    render(<WorkspaceManagementPanel actorRole="admin" />);
    await screen.findByText("成员管理 · 默认空间");
    await screen.findByText("工作空间 - 数据源绑定关系");
    expect(screen.getByText("SQLite 主数据源")).toBeInTheDocument();
    expect(mockListWorkspaceDatasourceBindings).toHaveBeenCalledWith("ws-1");
    await user.click(screen.getByRole("button", { name: "表权限编辑" }));
    expect(screen.getByText("table-permissions-dialog:sqlite_main")).toBeInTheDocument();
  });
});
