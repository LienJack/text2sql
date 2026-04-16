"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StateBlock } from "@/components/ui/state-block";
import { Textarea } from "@/components/ui/textarea";
import type { AdminUser, UserStatus, WorkspaceSummary } from "@/lib/admin-api-client";

type Mode = "create" | "edit";

type VariableRow = {
  id: string;
  key: string;
  value: string;
};

interface UserEditorSheetProps {
  open: boolean;
  mode: Mode;
  loading?: boolean;
  workspaces: WorkspaceSummary[];
  initialUser?: AdminUser | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: {
    account: string;
    name: string;
    email: string;
    status: UserStatus;
    workspaceIds: string[];
    variables: Record<string, string>;
  }) => Promise<void>;
}

function toVariableRows(source?: Record<string, string>): VariableRow[] {
  if (!source) {
    return [];
  }
  return Object.entries(source).map(([key, value], index) => ({
    id: `var-${key}-${index}`,
    key,
    value
  }));
}

function validateEmail(value: string): boolean {
  return /^\S+@\S+\.\S+$/.test(value);
}

function validateVariableKey(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);
}

function validateVariableValue(value: string): boolean {
  return value.trim().length > 0 && value.length <= 200 && !/\n/.test(value);
}

export function UserEditorSheet({
  open,
  mode,
  loading,
  workspaces,
  initialUser,
  onOpenChange,
  onSubmit
}: UserEditorSheetProps) {
  const [account, setAccount] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<UserStatus>("active");
  const [workspaceIds, setWorkspaceIds] = useState<string[]>([]);
  const [variables, setVariables] = useState<VariableRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }

    setError("");
    if (mode === "edit" && initialUser) {
      setAccount(initialUser.account);
      setName(initialUser.name);
      setEmail(initialUser.email);
      setStatus(initialUser.status);
      setWorkspaceIds(initialUser.workspaces.map((workspace) => workspace.id));
      setVariables(toVariableRows(initialUser.variables));
      return;
    }

    setAccount("");
    setName("");
    setEmail("");
    setStatus("active");
    setWorkspaceIds([]);
    setVariables([]);
  }, [initialUser, mode, open]);

  const variableKeySet = useMemo(() => {
    const set = new Set<string>();
    for (const item of variables) {
      const key = item.key.trim();
      if (key) {
        set.add(key);
      }
    }
    return set;
  }, [variables]);

  const toggleWorkspace = (workspaceId: string, checked: boolean): void => {
    setWorkspaceIds((previous) => {
      if (checked) {
        return previous.includes(workspaceId) ? previous : [...previous, workspaceId];
      }
      return previous.filter((id) => id !== workspaceId);
    });
  };

  const updateVariable = (
    variableId: string,
    field: "key" | "value",
    value: string
  ): void => {
    setVariables((previous) =>
      previous.map((item) =>
        item.id === variableId
          ? {
              ...item,
              [field]: value
            }
          : item
      )
    );
  };

  const removeVariable = (variableId: string): void => {
    setVariables((previous) => previous.filter((item) => item.id !== variableId));
  };

  const addVariable = (): void => {
    setVariables((previous) => [
      ...previous,
      {
        id: `var-${Date.now()}-${previous.length}`,
        key: "",
        value: ""
      }
    ]);
  };

  const submit = async (): Promise<void> => {
    setError("");

    if (!account.trim()) {
      setError("请输入账号。");
      return;
    }
    if (!name.trim()) {
      setError("请输入姓名。");
      return;
    }
    if (!email.trim() || !validateEmail(email.trim())) {
      setError("请输入有效邮箱。");
      return;
    }
    if (workspaceIds.length === 0) {
      setError("请至少选择一个工作空间。");
      return;
    }

    const variablePayload: Record<string, string> = {};
    for (const item of variables) {
      const key = item.key.trim();
      const value = item.value.trim();
      if (!key && !value) {
        continue;
      }
      if (!validateVariableKey(key)) {
        setError("系统变量 Key 仅支持字母、数字、下划线，且必须以字母或下划线开头。");
        return;
      }
      if (!validateVariableValue(value)) {
        setError("系统变量 Value 不能为空、不能换行，且长度不超过 200 字符。");
        return;
      }
      if (key in variablePayload) {
        setError("系统变量 Key 不能重复。");
        return;
      }
      variablePayload[key] = value;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        account: account.trim(),
        name: name.trim(),
        email: email.trim(),
        status,
        workspaceIds,
        variables: variablePayload
      });
      onOpenChange(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "保存用户失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto border-[var(--border-default)] bg-[var(--surface-panel)] p-0 sm:max-w-xl">
        <SheetHeader className="space-y-1 border-b border-[var(--border-default)] bg-[linear-gradient(180deg,#ffffff_0%,#f7fbff_100%)] px-5 py-4">
          <SheetTitle>{mode === "create" ? "新增用户" : "编辑用户"}</SheetTitle>
          <SheetDescription>
            {mode === "create"
              ? "填写账号信息并分配工作空间权限。"
              : "可更新姓名、邮箱、状态、工作空间和系统变量。"}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-5 py-4">
          {error ? <StateBlock variant="error">{error}</StateBlock> : null}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="user-editor-account">账号</Label>
              <Input
                id="user-editor-account"
                value={account}
                disabled={mode === "edit" || loading || submitting}
                placeholder="例如：alice"
                onChange={(event) => setAccount(event.target.value)}
              />
              {mode === "edit" ? (
                <p className="text-xs text-[var(--text-tertiary)]">账号创建后不可修改。</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-editor-name">姓名</Label>
              <Input
                id="user-editor-name"
                value={name}
                disabled={loading || submitting}
                placeholder="例如：Alice Chen"
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-editor-email">邮箱</Label>
              <Input
                id="user-editor-email"
                value={email}
                disabled={loading || submitting}
                placeholder="alice@example.com"
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-editor-status">状态</Label>
              <select
                id="user-editor-status"
                className="h-9 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-panel)] px-3 text-sm"
                value={status}
                disabled={loading || submitting}
                onChange={(event) => setStatus(event.target.value === "disabled" ? "disabled" : "active")}
              >
                <option value="active">正常</option>
                <option value="disabled">停用</option>
              </select>
            </div>
          </div>

          {mode === "edit" && initialUser?.isSystemAdmin ? (
            <Badge variant="secondary">系统内置管理员（不可删除）</Badge>
          ) : null}

          <div className="space-y-2">
            <p className="text-sm font-medium text-[var(--text-primary)]">工作空间分配</p>
            {workspaces.length === 0 ? (
              <StateBlock variant="idle">暂无可分配工作空间。</StateBlock>
            ) : (
              <div className="grid gap-2 rounded-lg border border-[var(--border-default)] p-3 sm:grid-cols-2">
                {workspaces.map((workspace) => (
                  <label
                    key={workspace.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--surface-page)]"
                  >
                    <Checkbox
                      checked={workspaceIds.includes(workspace.id)}
                      onCheckedChange={(checked) => toggleWorkspace(workspace.id, checked === true)}
                    />
                    <span className="text-sm text-[var(--text-secondary)]">{workspace.name}</span>
                    {workspace.isDefault ? (
                      <Badge variant="outline" className="text-[10px]">
                        默认
                      </Badge>
                    ) : null}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">系统变量</p>
                <p className="text-xs text-[var(--text-tertiary)]">支持 `KEY=VALUE` 形式，用于注入用户级配置。</p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={loading || submitting}
                onClick={addVariable}
              >
                <Plus className="h-4 w-4" />
                添加变量
              </Button>
            </div>

            {variables.length === 0 ? (
              <StateBlock variant="idle">未配置系统变量。</StateBlock>
            ) : (
              <div className="space-y-2 rounded-lg border border-[var(--border-default)] p-3">
                {variables.map((item, index) => {
                  const duplicate = item.key.trim() && variableKeySet.has(item.key.trim())
                    ? variables.filter((entry) => entry.key.trim() === item.key.trim()).length > 1
                    : false;

                  return (
                    <div key={item.id} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                      <div className="space-y-1">
                        <Input
                          value={item.key}
                          disabled={loading || submitting}
                          placeholder={`变量 Key #${index + 1}`}
                          onChange={(event) => updateVariable(item.id, "key", event.target.value)}
                        />
                        {duplicate ? (
                          <p className="text-xs text-destructive">该 Key 已重复。</p>
                        ) : null}
                      </div>
                      <Textarea
                        value={item.value}
                        disabled={loading || submitting}
                        className="min-h-9"
                        placeholder="变量 Value"
                        onChange={(event) => updateVariable(item.id, "value", event.target.value)}
                      />
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        disabled={loading || submitting}
                        aria-label="删除变量"
                        onClick={() => removeVariable(item.id)}
                      >
                        <Trash2 className="h-4 w-4 text-rose-600" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <SheetFooter className="border-t border-[var(--border-default)] bg-[var(--surface-page)] px-5 py-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" disabled={loading || submitting} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" disabled={loading || submitting} onClick={() => void submit()}>
            {submitting ? "保存中..." : mode === "create" ? "创建用户" : "保存变更"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
