import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsersManagementPanel } from "@/components/settings/users-management-panel";
import {
  createUser,
  deleteUsersBatch,
  listUsers,
  listWorkspaces,
  resetUserPassword,
  setUserStatus,
  type AdminUser
} from "@/lib/admin-api-client";

vi.mock("@/lib/admin-api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin-api-client")>();
  return {
    ...actual,
    listUsers: vi.fn(),
    listWorkspaces: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    setUserStatus: vi.fn(),
    resetUserPassword: vi.fn(),
    deleteUser: vi.fn(),
    deleteUsersBatch: vi.fn()
  };
});

const mockListUsers = vi.mocked(listUsers);
const mockListWorkspaces = vi.mocked(listWorkspaces);
const mockCreateUser = vi.mocked(createUser);
const mockSetUserStatus = vi.mocked(setUserStatus);
const mockResetUserPassword = vi.mocked(resetUserPassword);
const mockDeleteUsersBatch = vi.mocked(deleteUsersBatch);

const USERS: AdminUser[] = [
  {
    id: "u-1",
    account: "alice",
    name: "Alice",
    email: "alice@example.com",
    status: "active" as const,
    isSystemAdmin: false,
    workspaces: [{ id: "ws-1", name: "默认空间", isDefault: true }],
    variables: { REGION: "cn" },
    createdAt: "2026-04-15T00:00:00.000Z"
  },
  {
    id: "u-2",
    account: "bob",
    name: "Bob",
    email: "bob@example.com",
    status: "disabled" as const,
    isSystemAdmin: false,
    workspaces: [{ id: "ws-2", name: "增长分析", isDefault: false }],
    variables: {},
    createdAt: "2026-04-15T00:00:00.000Z"
  }
];

describe("UsersManagementPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListUsers.mockResolvedValue({
      items: USERS,
      total: 20,
      page: 1,
      pageSize: 10
    });
    mockListWorkspaces.mockResolvedValue({
      items: [
        { id: "ws-1", name: "默认空间", isDefault: true },
        { id: "ws-2", name: "增长分析", isDefault: false }
      ],
      total: 2,
      page: 1,
      pageSize: 200
    });
    mockCreateUser.mockResolvedValue(USERS[0]);
    mockSetUserStatus.mockResolvedValue(USERS[0]);
    mockResetUserPassword.mockResolvedValue({
      temporaryPassword: "Temp@123456",
      message: "ok"
    });
    mockDeleteUsersBatch.mockResolvedValue({
      deletedCount: 2,
      failedCount: 0
    });
  });

  it(
    "supports create user with workspace and variables",
    async () => {
    const user = userEvent.setup();

    render(<UsersManagementPanel actorRole="admin" />);
    await screen.findByText("Alice");

    await user.click(screen.getByRole("button", { name: "新增用户" }));

    await user.type(screen.getByLabelText("账号"), "new_user");
    await user.type(screen.getByLabelText("姓名"), "New User");
    await user.type(screen.getByLabelText("邮箱"), "new@example.com");
    await user.click(screen.getByRole("checkbox", { name: "增长分析" }));

    await user.click(screen.getByRole("button", { name: "添加变量" }));
    const keyInput = screen.getByPlaceholderText("变量 Key #1");
    await user.type(keyInput, "TEAM");
    await user.type(screen.getByPlaceholderText("变量 Value"), "growth");

    await user.click(screen.getByRole("button", { name: "创建用户" }));

    await waitFor(() => {
      expect(mockCreateUser).toHaveBeenCalledWith({
        account: "new_user",
        name: "New User",
        email: "new@example.com",
        status: "active",
        workspaceIds: ["ws-2"],
        variables: { TEAM: "growth" }
      });
    });
    },
    15000
  );

  it("supports status toggle, reset password and batch delete", async () => {
    const user = userEvent.setup();

    render(<UsersManagementPanel actorRole="admin" />);
    await screen.findByText("Alice");

    await user.click(screen.getByLabelText("切换用户 Alice 状态"));
    await waitFor(() => {
      expect(mockSetUserStatus).toHaveBeenCalledWith("u-1", "disabled");
    });

    await user.click(screen.getByLabelText("重置 Alice 密码"));
    await user.click(screen.getByRole("button", { name: "确认重置" }));
    await waitFor(() => {
      expect(mockResetUserPassword).toHaveBeenCalledWith("u-1");
    });

    await user.click(screen.getByLabelText("选择用户 Alice"));
    await user.click(screen.getByLabelText("选择用户 Bob"));
    await user.click(screen.getByRole("button", { name: "批量删除" }));
    await user.click(screen.getByRole("button", { name: "执行删除" }));

    await waitFor(() => {
      expect(mockDeleteUsersBatch).toHaveBeenCalledWith(["u-1", "u-2"]);
    });
  });

  it("keeps filters when switching pages", async () => {
    const user = userEvent.setup();

    render(<UsersManagementPanel actorRole="admin" />);
    await screen.findByText("Alice");

    await user.selectOptions(screen.getByDisplayValue("全部状态"), "disabled");
    await waitFor(() => {
      expect(mockListUsers).toHaveBeenLastCalledWith({
        keyword: "",
        status: "disabled",
        workspaceId: undefined,
        page: 1,
        pageSize: 10
      });
    });

    await user.click(screen.getByRole("button", { name: "下一页" }));

    await waitFor(() => {
      expect(mockListUsers).toHaveBeenLastCalledWith({
        keyword: "",
        status: "disabled",
        workspaceId: undefined,
        page: 2,
        pageSize: 10
      });
    });

    const table = screen.getByRole("table");
    expect(within(table).getByText("Alice")).toBeInTheDocument();
  });
});
