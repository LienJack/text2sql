"use client";

import { Edit3, KeyRound, Plus, RefreshCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { StateBlock } from "@/components/ui/state-block";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  createUser,
  deleteUser,
  deleteUsersBatch,
  listUsers,
  listWorkspaces,
  resetUserPassword,
  setUserStatus,
  updateUser,
  type AdminUser,
  type UserStatus,
  type WorkspaceSummary
} from "@/lib/admin-api-client";
import { UserEditorSheet } from "./user-editor-sheet";

interface UsersManagementPanelProps {
  actorRole: "admin" | "user";
  refreshToken?: number;
}

type EditorState = {
  open: boolean;
  mode: "create" | "edit";
  user: AdminUser | null;
};

const DEFAULT_PAGE_SIZE = 10;

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function UsersManagementPanel({ actorRole, refreshToken = 0 }: UsersManagementPanelProps) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [operating, setOperating] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<UserStatus | "all">("all");
  const [workspaceFilter, setWorkspaceFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState(0);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [editor, setEditor] = useState<EditorState>({
    open: false,
    mode: "create",
    user: null
  });

  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);

  const loadWorkspaces = useCallback(async (): Promise<void> => {
    const result = await listWorkspaces({ page: 1, pageSize: 200 });
    setWorkspaces(result.items);
  }, []);

  const loadUsers = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const result = await listUsers({
        keyword,
        status: statusFilter,
        workspaceId: workspaceFilter === "all" ? undefined : workspaceFilter,
        page,
        pageSize
      });
      setUsers(result.items);
      setTotal(result.total);
      setSelectedIds((previous) => previous.filter((id) => result.items.some((item) => item.id === id)));
      setFeedback(null);
    } catch (error) {
      setFeedback({
        type: "error",
        text: error instanceof Error ? error.message : "加载用户列表失败"
      });
    } finally {
      setLoading(false);
    }
  }, [keyword, page, pageSize, statusFilter, workspaceFilter]);

  useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers, refreshToken]);

  useEffect(() => {
    setPage(1);
  }, [keyword, statusFilter, workspaceFilter]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const selectableIds = useMemo(
    () => users.filter((user) => !user.isSystemAdmin).map((user) => user.id),
    [users]
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.includes(id));

  const setSuccess = (text: string): void => {
    setFeedback({ type: "success", text });
  };

  const setError = (error: unknown, fallback: string): void => {
    setFeedback({
      type: "error",
      text: error instanceof Error ? error.message : fallback
    });
  };

  const toggleSelectAll = (checked: boolean): void => {
    if (checked) {
      setSelectedIds(selectableIds);
      return;
    }
    setSelectedIds([]);
  };

  const toggleSelectOne = (userId: string, checked: boolean): void => {
    setSelectedIds((previous) => {
      if (checked) {
        return previous.includes(userId) ? previous : [...previous, userId];
      }
      return previous.filter((id) => id !== userId);
    });
  };

  const onToggleStatus = async (user: AdminUser, checked: boolean): Promise<void> => {
    if (actorRole !== "admin") {
      return;
    }
    setOperating(true);
    try {
      await setUserStatus(user.id, checked ? "active" : "disabled");
      setSuccess(`${user.name} 已${checked ? "启用" : "停用"}。`);
      await loadUsers();
    } catch (error) {
      setError(error, "更新用户状态失败");
    } finally {
      setOperating(false);
    }
  };

  const onSubmitEditor = async (payload: {
    account: string;
    name: string;
    email: string;
    status: UserStatus;
    workspaceIds: string[];
    variables: Record<string, string>;
  }): Promise<void> => {
    setOperating(true);
    try {
      if (editor.mode === "create") {
        await createUser(payload);
        setSuccess(`用户 ${payload.name} 创建成功。`);
      } else if (editor.user) {
        await updateUser(editor.user.id, {
          name: payload.name,
          email: payload.email,
          status: payload.status,
          workspaceIds: payload.workspaceIds,
          variables: payload.variables
        });
        setSuccess(`用户 ${payload.name} 更新成功。`);
      }
      await loadUsers();
    } finally {
      setOperating(false);
    }
  };

  const onConfirmDeleteOne = async (): Promise<void> => {
    if (!deleteTarget) {
      return;
    }
    setOperating(true);
    try {
      await deleteUser(deleteTarget.id);
      setDeleteTarget(null);
      setSuccess(`用户 ${deleteTarget.name} 已删除。`);
      await loadUsers();
    } catch (error) {
      setError(error, "删除用户失败");
    } finally {
      setOperating(false);
    }
  };

  const onConfirmBatchDelete = async (): Promise<void> => {
    if (selectedIds.length === 0) {
      setBatchDeleteOpen(false);
      return;
    }
    setOperating(true);
    try {
      const result = await deleteUsersBatch(selectedIds);
      setBatchDeleteOpen(false);
      setSelectedIds([]);
      setSuccess(`批量删除完成：成功 ${result.deletedCount}，失败 ${result.failedCount}。`);
      await loadUsers();
    } catch (error) {
      setError(error, "批量删除用户失败");
    } finally {
      setOperating(false);
    }
  };

  const onConfirmResetPassword = async (): Promise<void> => {
    if (!resetTarget) {
      return;
    }
    setOperating(true);
    try {
      const result = await resetUserPassword(resetTarget.id);
      setResetTarget(null);
      setSuccess(
        result.temporaryPassword
          ? `${resetTarget.name} 密码已重置，默认密码：${result.temporaryPassword}`
          : `${resetTarget.name} 密码已重置。`
      );
    } catch (error) {
      setError(error, "重置密码失败");
    } finally {
      setOperating(false);
    }
  };

  if (actorRole !== "admin") {
    return <StateBlock variant="idle">当前账号仅可查看用户信息，不可执行管理操作。</StateBlock>;
  }

  return (
    <section className="space-y-4">
      <div className="space-y-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-panel)] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索账号 / 姓名 / 邮箱"
            className="w-full sm:w-72"
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as UserStatus | "all")}
            className="h-8 rounded-md border border-[var(--border-default)] bg-[var(--surface-panel)] px-2 text-sm"
          >
            <option value="all">全部状态</option>
            <option value="active">正常</option>
            <option value="disabled">停用</option>
          </select>
          <select
            value={workspaceFilter}
            onChange={(event) => setWorkspaceFilter(event.target.value)}
            className="h-8 rounded-md border border-[var(--border-default)] bg-[var(--surface-panel)] px-2 text-sm"
          >
            <option value="all">全部工作空间</option>
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            disabled={loading || operating}
            onClick={() => {
              void loadUsers();
            }}
          >
            <RefreshCcw className="h-4 w-4" />
            刷新
          </Button>
          <Button
            disabled={operating}
            onClick={() =>
              setEditor({
                open: true,
                mode: "create",
                user: null
              })
            }
          >
            <Plus className="h-4 w-4" />
            新增用户
          </Button>
        </div>

        {selectedIds.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="text-sm text-amber-900">已选择 {selectedIds.length} 个用户。</p>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>
                清空选择
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setBatchDeleteOpen(true)}>
                批量删除
              </Button>
            </div>
          </div>
        ) : null}

        {feedback ? <StateBlock variant={feedback.type}>{feedback.text}</StateBlock> : null}
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-panel)]">
        {loading ? <StateBlock variant="loading" className="m-4">正在加载用户列表...</StateBlock> : null}
        {!loading && users.length === 0 ? <StateBlock variant="idle" className="m-4">暂无用户数据。</StateBlock> : null}
        {!loading && users.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                      checked={allSelected}
                      aria-label="全选用户"
                      onCheckedChange={(checked) => toggleSelectAll(checked === true)}
                    />
                  </TableHead>
                  <TableHead className="w-[240px]">账号</TableHead>
                  <TableHead className="w-[220px]">邮箱</TableHead>
                  <TableHead>工作空间</TableHead>
                  <TableHead className="w-[120px]">状态</TableHead>
                  <TableHead className="w-[180px]">创建时间</TableHead>
                  <TableHead className="w-[220px] text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => {
                  const userWorkspaceNames = user.workspaces.map((workspace) => workspace.name).join("、") || "--";
                  return (
                    <TableRow key={user.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.includes(user.id)}
                          disabled={user.isSystemAdmin}
                          aria-label={`选择用户 ${user.name}`}
                          onCheckedChange={(checked) => toggleSelectOne(user.id, checked === true)}
                        />
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{user.name}</p>
                        <p className="text-xs text-[var(--text-tertiary)]">@{user.account}</p>
                        {user.isSystemAdmin ? (
                          <Badge variant="outline" className="mt-1 text-[10px]">
                            系统管理员
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell className="max-w-[280px] truncate text-sm text-[var(--text-secondary)]">
                        {userWorkspaceNames}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={user.status === "active"}
                          disabled={operating || user.isSystemAdmin}
                          aria-label={`切换用户 ${user.name} 状态`}
                          onCheckedChange={(checked) => {
                            void onToggleStatus(user, checked);
                          }}
                        />
                      </TableCell>
                      <TableCell className="text-xs text-[var(--text-tertiary)]">{formatDate(user.createdAt)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`编辑用户 ${user.name}`}
                            onClick={() =>
                              setEditor({
                                open: true,
                                mode: "edit",
                                user
                              })
                            }
                          >
                            <Edit3 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`重置 ${user.name} 密码`}
                            onClick={() => setResetTarget(user)}
                          >
                            <KeyRound className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled={user.isSystemAdmin}
                            aria-label={`删除用户 ${user.name}`}
                            onClick={() => setDeleteTarget(user)}
                          >
                            <Trash2 className="h-4 w-4 text-rose-600" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <div className="flex items-center justify-between border-t border-[var(--border-default)] px-4 py-3 text-sm text-[var(--text-secondary)]">
              <p>
                第 {page} / {totalPages} 页，共 {total} 条
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((previous) => Math.max(1, previous - 1))}
                >
                  上一页
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((previous) => Math.min(totalPages, previous + 1))}
                >
                  下一页
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </div>

      <UserEditorSheet
        open={editor.open}
        mode={editor.mode}
        initialUser={editor.user}
        workspaces={workspaces}
        loading={operating}
        onOpenChange={(open) => setEditor((previous) => ({ ...previous, open }))}
        onSubmit={onSubmitEditor}
      />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除用户？</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `删除 ${deleteTarget.name} 后无法恢复。`
                : "删除后无法恢复。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void onConfirmDeleteOne()}>
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={batchDeleteOpen} onOpenChange={setBatchDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认批量删除？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除 {selectedIds.length} 个用户。该操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void onConfirmBatchDelete()}>
              执行删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={resetTarget !== null} onOpenChange={(open) => !open && setResetTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认重置密码？</AlertDialogTitle>
            <AlertDialogDescription>
              {resetTarget
                ? `将为 ${resetTarget.name} 生成新密码。`
                : "将为该用户生成新密码。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onConfirmResetPassword()}>
              确认重置
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
