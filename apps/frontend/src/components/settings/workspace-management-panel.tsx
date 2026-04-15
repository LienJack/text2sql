"use client";

import { Pencil, Plus, Trash2, UserMinus, UserPlus } from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  addWorkspaceMembers,
  createWorkspace,
  deleteWorkspace,
  listWorkspaceMembers,
  listWorkspaces,
  removeWorkspaceMember,
  removeWorkspaceMembersBatch,
  renameWorkspace,
  updateWorkspaceMemberRole,
  type WorkspaceMember,
  type WorkspaceSummary
} from "@/lib/admin-api-client";
import { WorkspaceEditorDialog } from "./workspace-editor-dialog";
import { WorkspaceMembersDialog } from "./workspace-members-dialog";

interface WorkspaceManagementPanelProps {
  actorRole: "admin" | "user";
  refreshToken?: number;
}

type EditorState = {
  open: boolean;
  mode: "create" | "rename";
  workspace: WorkspaceSummary | null;
};

const MEMBER_PAGE_SIZE = 10;

function formatDate(value?: string): string {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
}

export function WorkspaceManagementPanel({ actorRole, refreshToken = 0 }: WorkspaceManagementPanelProps) {
  const [loadingWorkspaceList, setLoadingWorkspaceList] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [operating, setOperating] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [workspaceKeyword, setWorkspaceKeyword] = useState("");
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");

  const [memberKeyword, setMemberKeyword] = useState("");
  const [memberPage, setMemberPage] = useState(1);
  const [memberTotal, setMemberTotal] = useState(0);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);

  const [editor, setEditor] = useState<EditorState>({
    open: false,
    mode: "create",
    workspace: null
  });
  const [membersDialogOpen, setMembersDialogOpen] = useState(false);

  const [deleteWorkspaceTarget, setDeleteWorkspaceTarget] = useState<WorkspaceSummary | null>(null);
  const [removeMemberTarget, setRemoveMemberTarget] = useState<WorkspaceMember | null>(null);
  const [batchRemoveOpen, setBatchRemoveOpen] = useState(false);

  const selectedWorkspace = useMemo(
    () => workspaces.find((item) => item.id === selectedWorkspaceId) ?? null,
    [selectedWorkspaceId, workspaces]
  );

  const loadWorkspaceList = useCallback(async (): Promise<void> => {
    setLoadingWorkspaceList(true);
    try {
      const result = await listWorkspaces({
        keyword: workspaceKeyword,
        page: 1,
        pageSize: 200
      });
      setWorkspaces(result.items);
      setFeedback(null);
      if (result.items.length === 0) {
        setSelectedWorkspaceId("");
        return;
      }
      setSelectedWorkspaceId((previous) =>
        previous && result.items.some((workspace) => workspace.id === previous)
          ? previous
          : result.items[0].id
      );
    } catch (error) {
      setFeedback({
        type: "error",
        text: error instanceof Error ? error.message : "加载工作空间失败"
      });
    } finally {
      setLoadingWorkspaceList(false);
    }
  }, [workspaceKeyword]);

  const loadMembers = useCallback(async (): Promise<void> => {
    if (!selectedWorkspaceId) {
      setMembers([]);
      setMemberTotal(0);
      return;
    }

    setLoadingMembers(true);
    try {
      const result = await listWorkspaceMembers(selectedWorkspaceId, {
        keyword: memberKeyword,
        page: memberPage,
        pageSize: MEMBER_PAGE_SIZE
      });
      setMembers(result.items);
      setMemberTotal(result.total);
      setSelectedMemberIds((previous) =>
        previous.filter((id) => result.items.some((member) => member.id === id))
      );
      setFeedback(null);
    } catch (error) {
      setFeedback({
        type: "error",
        text: error instanceof Error ? error.message : "加载成员列表失败"
      });
    } finally {
      setLoadingMembers(false);
    }
  }, [memberKeyword, memberPage, selectedWorkspaceId]);

  useEffect(() => {
    void loadWorkspaceList();
  }, [loadWorkspaceList, refreshToken]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers, refreshToken]);

  useEffect(() => {
    setMemberPage(1);
  }, [selectedWorkspaceId, memberKeyword]);

  const totalMemberPages = Math.max(1, Math.ceil(memberTotal / MEMBER_PAGE_SIZE));

  const setSuccess = (text: string): void => {
    setFeedback({ type: "success", text });
  };

  const setError = (error: unknown, fallback: string): void => {
    setFeedback({
      type: "error",
      text: error instanceof Error ? error.message : fallback
    });
  };

  const submitWorkspaceEditor = async (name: string): Promise<void> => {
    setOperating(true);
    try {
      if (editor.mode === "create") {
        const created = await createWorkspace({ name });
        setSuccess(`工作空间「${created.name}」已创建。`);
      } else if (editor.workspace) {
        const renamed = await renameWorkspace(editor.workspace.id, { name });
        setSuccess(`工作空间已重命名为「${renamed.name}」。`);
      }

      await loadWorkspaceList();
      await loadMembers();
    } finally {
      setOperating(false);
    }
  };

  const confirmDeleteWorkspace = async (): Promise<void> => {
    if (!deleteWorkspaceTarget) {
      return;
    }

    setOperating(true);
    try {
      await deleteWorkspace(deleteWorkspaceTarget.id);
      setDeleteWorkspaceTarget(null);
      setSuccess(`工作空间「${deleteWorkspaceTarget.name}」已删除。`);
      await loadWorkspaceList();
      await loadMembers();
    } catch (error) {
      setError(error, "删除工作空间失败");
    } finally {
      setOperating(false);
    }
  };

  const submitAddMembers = async (
    membersToAdd: Array<{ userId: string; role: "admin" | "member" }>
  ): Promise<void> => {
    if (!selectedWorkspaceId) {
      throw new Error("请先选择工作空间");
    }

    setOperating(true);
    try {
      const result = await addWorkspaceMembers(selectedWorkspaceId, membersToAdd);
      setSuccess(`已添加 ${result.addedCount} 名成员。`);
      await loadMembers();
    } finally {
      setOperating(false);
    }
  };

  const changeMemberRole = async (
    member: WorkspaceMember,
    role: "admin" | "member"
  ): Promise<void> => {
    if (!selectedWorkspaceId) {
      return;
    }

    setOperating(true);
    try {
      await updateWorkspaceMemberRole(selectedWorkspaceId, member.id, role);
      setSuccess(`${member.name} 角色已更新为${role === "admin" ? "空间管理员" : "普通成员"}。`);
      await loadMembers();
    } catch (error) {
      setError(error, "更新成员角色失败");
    } finally {
      setOperating(false);
    }
  };

  const removeSingleMember = async (): Promise<void> => {
    if (!selectedWorkspaceId || !removeMemberTarget) {
      return;
    }

    setOperating(true);
    try {
      await removeWorkspaceMember(selectedWorkspaceId, removeMemberTarget.id);
      setRemoveMemberTarget(null);
      setSuccess(`${removeMemberTarget.name} 已移除。`);
      await loadMembers();
    } catch (error) {
      setError(error, "移除成员失败");
    } finally {
      setOperating(false);
    }
  };

  const removeBatchMembers = async (): Promise<void> => {
    if (!selectedWorkspaceId || selectedMemberIds.length === 0) {
      setBatchRemoveOpen(false);
      return;
    }

    setOperating(true);
    try {
      const result = await removeWorkspaceMembersBatch(selectedWorkspaceId, selectedMemberIds);
      setBatchRemoveOpen(false);
      setSelectedMemberIds([]);
      setSuccess(`批量移除完成：成功 ${result.removedCount}，失败 ${result.failedCount}。`);
      await loadMembers();
    } catch (error) {
      setError(error, "批量移除成员失败");
    } finally {
      setOperating(false);
    }
  };

  if (actorRole !== "admin") {
    return <StateBlock variant="idle">当前账号仅可查看空间信息，不可执行管理操作。</StateBlock>;
  }

  return (
    <section className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <aside className="space-y-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-panel)] p-4">
        <div className="flex items-center gap-2">
          <Input
            value={workspaceKeyword}
            onChange={(event) => setWorkspaceKeyword(event.target.value)}
            placeholder="搜索工作空间"
          />
          <Button
            size="icon-sm"
            aria-label="新建工作空间"
            onClick={() =>
              setEditor({
                open: true,
                mode: "create",
                workspace: null
              })
            }
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {feedback ? <StateBlock variant={feedback.type}>{feedback.text}</StateBlock> : null}
        {loadingWorkspaceList ? <StateBlock variant="loading">正在加载工作空间...</StateBlock> : null}
        {!loadingWorkspaceList && workspaces.length === 0 ? (
          <StateBlock variant="idle">暂无工作空间。</StateBlock>
        ) : null}

        <div className="space-y-1">
          {workspaces.map((workspace) => {
            const active = workspace.id === selectedWorkspaceId;
            return (
              <div
                key={workspace.id}
                className={`rounded-lg border px-3 py-2 transition ${
                  active
                    ? "border-[var(--action-primary)] bg-[var(--surface-active)]"
                    : "border-[var(--border-default)] hover:bg-[var(--surface-page)]"
                }`}
              >
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => setSelectedWorkspaceId(workspace.id)}
                >
                  <p className="truncate text-sm font-medium text-[var(--text-primary)]">{workspace.name}</p>
                  <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                    成员 {workspace.memberCount ?? "--"} · 创建于 {formatDate(workspace.createdAt)}
                  </p>
                </button>
                <div className="mt-2 flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`重命名工作空间 ${workspace.name}`}
                    onClick={() =>
                      setEditor({
                        open: true,
                        mode: "rename",
                        workspace
                      })
                    }
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={workspace.isDefault}
                    aria-label={`删除工作空间 ${workspace.name}`}
                    onClick={() => setDeleteWorkspaceTarget(workspace)}
                  >
                    <Trash2 className="h-4 w-4 text-rose-600" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      <section className="space-y-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-panel)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-base font-semibold text-[var(--text-primary)]">
              {selectedWorkspace ? `成员管理 · ${selectedWorkspace.name}` : "成员管理"}
            </p>
            <p className="text-xs text-[var(--text-tertiary)]">支持搜索、角色调整、移除与批量移除。</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={!selectedWorkspace || operating}
              onClick={() => setMembersDialogOpen(true)}
            >
              <UserPlus className="h-4 w-4" />
              添加成员
            </Button>
            {selectedMemberIds.length > 0 ? (
              <Button variant="destructive" disabled={operating} onClick={() => setBatchRemoveOpen(true)}>
                <UserMinus className="h-4 w-4" />
                批量移除 ({selectedMemberIds.length})
              </Button>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={memberKeyword}
            onChange={(event) => setMemberKeyword(event.target.value)}
            placeholder="搜索成员（姓名 / 账号 / 邮箱）"
            className="w-full sm:w-80"
          />
        </div>

        {selectedWorkspace === null ? (
          <StateBlock variant="idle">请选择左侧工作空间后查看成员。</StateBlock>
        ) : (
          <div className="overflow-hidden rounded-lg border border-[var(--border-default)]">
            {loadingMembers ? <StateBlock variant="loading" className="m-4">正在加载成员...</StateBlock> : null}
            {!loadingMembers && members.length === 0 ? (
              <StateBlock variant="idle" className="m-4">当前空间暂无成员。</StateBlock>
            ) : null}

            {!loadingMembers && members.length > 0 ? (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <Checkbox
                          checked={
                            members.length > 0 && members.every((member) => selectedMemberIds.includes(member.id))
                          }
                          aria-label="全选成员"
                          onCheckedChange={(checked) =>
                            setSelectedMemberIds(checked === true ? members.map((member) => member.id) : [])
                          }
                        />
                      </TableHead>
                      <TableHead className="w-[260px]">成员</TableHead>
                      <TableHead className="w-[180px]">角色</TableHead>
                      <TableHead className="w-[140px]">账号状态</TableHead>
                      <TableHead className="w-[140px]">加入时间</TableHead>
                      <TableHead className="w-[120px] text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {members.map((member) => (
                      <TableRow key={member.id}>
                        <TableCell>
                          <Checkbox
                            checked={selectedMemberIds.includes(member.id)}
                            aria-label={`选择成员 ${member.name}`}
                            onCheckedChange={(checked) =>
                              setSelectedMemberIds((previous) => {
                                if (checked === true) {
                                  return previous.includes(member.id) ? previous : [...previous, member.id];
                                }
                                return previous.filter((id) => id !== member.id);
                              })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <p className="font-medium">{member.name}</p>
                          <p className="text-xs text-[var(--text-tertiary)]">@{member.account} · {member.email}</p>
                        </TableCell>
                        <TableCell>
                          <select
                            value={member.role}
                            className="h-8 rounded-md border border-[var(--border-default)] bg-[var(--surface-panel)] px-2 text-sm"
                            onChange={(event) =>
                              void changeMemberRole(
                                member,
                                event.target.value === "admin" ? "admin" : "member"
                              )
                            }
                          >
                            <option value="member">普通成员</option>
                            <option value="admin">空间管理员</option>
                          </select>
                        </TableCell>
                        <TableCell>
                          <Badge variant={member.status === "active" ? "secondary" : "outline"}>
                            {member.status === "active" ? "正常" : "停用"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-[var(--text-tertiary)]">{formatDate(member.createdAt)}</TableCell>
                        <TableCell>
                          <div className="flex justify-end">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`移除成员 ${member.name}`}
                              onClick={() => setRemoveMemberTarget(member)}
                            >
                              <UserMinus className="h-4 w-4 text-rose-600" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <div className="flex items-center justify-between border-t border-[var(--border-default)] px-4 py-3 text-sm text-[var(--text-secondary)]">
                  <p>
                    第 {memberPage} / {totalMemberPages} 页，共 {memberTotal} 名成员
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={memberPage <= 1 || loadingMembers}
                      onClick={() => setMemberPage((previous) => Math.max(1, previous - 1))}
                    >
                      上一页
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={memberPage >= totalMemberPages || loadingMembers}
                      onClick={() => setMemberPage((previous) => Math.min(totalMemberPages, previous + 1))}
                    >
                      下一页
                    </Button>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        )}
      </section>

      <WorkspaceEditorDialog
        open={editor.open}
        mode={editor.mode}
        loading={operating}
        initialName={editor.workspace?.name}
        onOpenChange={(open) => setEditor((previous) => ({ ...previous, open }))}
        onSubmit={submitWorkspaceEditor}
      />

      <WorkspaceMembersDialog
        open={membersDialogOpen}
        workspaceName={selectedWorkspace?.name ?? ""}
        excludedUserIds={members.map((member) => member.userId)}
        onOpenChange={setMembersDialogOpen}
        onSubmit={submitAddMembers}
      />

      <AlertDialog open={deleteWorkspaceTarget !== null} onOpenChange={(open) => !open && setDeleteWorkspaceTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除工作空间？</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteWorkspaceTarget
                ? `删除「${deleteWorkspaceTarget.name}」后无法恢复。`
                : "删除后无法恢复。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmDeleteWorkspace()}>
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={removeMemberTarget !== null} onOpenChange={(open) => !open && setRemoveMemberTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认移除成员？</AlertDialogTitle>
            <AlertDialogDescription>
              {removeMemberTarget
                ? `将从当前工作空间移除 ${removeMemberTarget.name}。`
                : "将从当前工作空间移除该成员。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void removeSingleMember()}>
              确认移除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={batchRemoveOpen} onOpenChange={setBatchRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认批量移除成员？</AlertDialogTitle>
            <AlertDialogDescription>
              将移除 {selectedMemberIds.length} 名成员，仅移除当前空间授权。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void removeBatchMembers()}>
              执行移除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
