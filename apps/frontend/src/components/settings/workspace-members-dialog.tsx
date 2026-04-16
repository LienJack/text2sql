"use client";

import { Search, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StateBlock } from "@/components/ui/state-block";
import {
  listUsers,
  type AdminUser,
  type WorkspaceMemberRole
} from "@/lib/admin-api-client";

type SelectedMember = {
  user: AdminUser;
  role: WorkspaceMemberRole;
};

interface WorkspaceMembersDialogProps {
  open: boolean;
  workspaceName: string;
  excludedUserIds: string[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (members: Array<{ userId: string; role: WorkspaceMemberRole }>) => Promise<void>;
}

export function WorkspaceMembersDialog({
  open,
  workspaceName,
  excludedUserIds,
  onOpenChange,
  onSubmit
}: WorkspaceMembersDialogProps) {
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState<AdminUser[]>([]);
  const [selectedMap, setSelectedMap] = useState<Record<string, SelectedMember>>({});

  useEffect(() => {
    if (!open) {
      return;
    }
    setSelectedMap({});
    setError("");
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let active = true;
    const loadCandidates = async (): Promise<void> => {
      setLoading(true);
      try {
        const result = await listUsers({
          keyword,
          status: "active",
          page: 1,
          pageSize: 100
        });
        if (!active) {
          return;
        }

        const excluded = new Set(excludedUserIds);
        const filtered = result.items.filter((user) => !excluded.has(user.id));
        setCandidates(filtered);
      } catch (loadError) {
        if (!active) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "加载候选成员失败");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadCandidates();
    return () => {
      active = false;
    };
  }, [excludedUserIds, keyword, open]);

  const selectedMembers = useMemo(() => Object.values(selectedMap), [selectedMap]);

  const toggleCandidate = (user: AdminUser, checked: boolean): void => {
    setSelectedMap((previous) => {
      if (checked) {
        return {
          ...previous,
          [user.id]: {
            user,
            role: previous[user.id]?.role ?? "member"
          }
        };
      }

      const next = { ...previous };
      delete next[user.id];
      return next;
    });
  };

  const setRole = (userId: string, role: WorkspaceMemberRole): void => {
    setSelectedMap((previous) => {
      const current = previous[userId];
      if (!current) {
        return previous;
      }
      return {
        ...previous,
        [userId]: {
          ...current,
          role
        }
      };
    });
  };

  const submit = async (): Promise<void> => {
    if (selectedMembers.length === 0) {
      setError("请至少选择一个成员。");
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(
        selectedMembers.map((item) => ({
          userId: item.user.id,
          role: item.role
        }))
      );
      onOpenChange(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "添加成员失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-hidden p-0">
        <DialogHeader className="border-b border-[var(--border-default)] px-5 pt-5 pb-4">
          <DialogTitle>添加成员到「{workspaceName}」</DialogTitle>
          <DialogDescription>支持搜索候选用户、多选并分配成员角色后一次性提交。</DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[65vh] grid-cols-1 gap-0 md:grid-cols-[1.25fr_0.75fr]">
          <section className="space-y-3 overflow-y-auto border-b border-[var(--border-default)] p-4 md:border-r md:border-b-0">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--text-tertiary)]" />
              <Input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                className="pl-9"
                placeholder="搜索账号 / 姓名 / 邮箱"
              />
            </div>

            {loading ? <StateBlock variant="loading">正在加载候选用户...</StateBlock> : null}
            {!loading && candidates.length === 0 ? <StateBlock variant="idle">没有可添加的候选成员。</StateBlock> : null}

            <div className="space-y-1">
              {candidates.map((user) => {
                const checked = Boolean(selectedMap[user.id]);
                return (
                  <label
                    key={user.id}
                    className="flex items-start gap-2 rounded-md border border-[var(--border-default)] px-3 py-2 hover:bg-[var(--surface-page)]"
                  >
                    <Checkbox
                      checked={checked}
                      aria-label={`选择用户 ${user.name}`}
                      onCheckedChange={(next) => toggleCandidate(user, next === true)}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--text-primary)]">{user.name}</p>
                      <p className="truncate text-xs text-[var(--text-tertiary)]">@{user.account} · {user.email}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </section>

          <section className="space-y-3 overflow-y-auto p-4">
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <Users className="h-4 w-4 text-[var(--action-primary)]" />
              已选成员 {selectedMembers.length}
            </div>

            {selectedMembers.length === 0 ? (
              <StateBlock variant="idle">请先在左侧勾选成员。</StateBlock>
            ) : (
              <div className="space-y-2">
                {selectedMembers.map((item) => (
                  <div key={item.user.id} className="rounded-md border border-[var(--border-default)] px-3 py-2">
                    <p className="text-sm font-medium">{item.user.name}</p>
                    <p className="truncate text-xs text-[var(--text-tertiary)]">{item.user.email}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <Badge variant="outline">角色</Badge>
                      <select
                        value={item.role}
                        className="h-7 rounded-md border border-[var(--border-default)] bg-[var(--surface-panel)] px-2 text-xs"
                        onChange={(event) =>
                          setRole(item.user.id, event.target.value === "admin" ? "admin" : "member")
                        }
                      >
                        <option value="member">普通成员</option>
                        <option value="admin">空间管理员</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {error ? <StateBlock variant="error" className="mx-4 mb-2">{error}</StateBlock> : null}

        <DialogFooter>
          <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={submitting} onClick={() => void submit()}>
            {submitting ? "添加中..." : "确认添加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
