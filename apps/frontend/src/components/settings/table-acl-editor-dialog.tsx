"use client";

import { useEffect, useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption
} from "@/components/ui/native-select";
import { StateBlock } from "@/components/ui/state-block";
import { useWorkspaceTableAcl } from "./use-workspace-table-acl";

interface TableAclEditorDialogProps {
  open: boolean;
  workspaceId: string;
  workspaceName: string;
  onOpenChange: (open: boolean) => void;
}

export function TableAclEditorDialog({
  open,
  workspaceId,
  workspaceName,
  onOpenChange
}: TableAclEditorDialogProps) {
  const {
    bindings,
    datasourceId,
    rules,
    tableOptions,
    loadingBindings,
    loadingTables,
    saving,
    error,
    setDatasourceId,
    clearError,
    replaceAcl
  } = useWorkspaceTableAcl({ open, workspaceId });
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [subjectType, setSubjectType] = useState<"role" | "user">("role");
  const [subjectId, setSubjectId] = useState("member");
  const [effect, setEffect] = useState<"allow" | "deny">("allow");
  const [formError, setFormError] = useState("");

  const normalizedSubjectId = useMemo(() => subjectId.trim().toLowerCase(), [subjectId]);
  const currentRuleTables = useMemo(
    () =>
      rules
        .filter(
          (rule) =>
            rule.datasourceId === datasourceId &&
            rule.subjectType === subjectType &&
            rule.effect === effect &&
            rule.subjectId.trim().toLowerCase() === normalizedSubjectId
        )
        .map((rule) => rule.tableName.trim().toLowerCase())
        .filter(Boolean),
    [datasourceId, effect, normalizedSubjectId, rules, subjectType]
  );

  const displayTableOptions = useMemo(() => {
    const deduped = new Set<string>();
    for (const tableName of tableOptions) {
      const normalized = tableName.trim().toLowerCase();
      if (normalized) {
        deduped.add(normalized);
      }
    }
    for (const tableName of currentRuleTables) {
      const normalized = tableName.trim().toLowerCase();
      if (normalized) {
        deduped.add(normalized);
      }
    }
    return Array.from(deduped).sort((a, b) => a.localeCompare(b));
  }, [currentRuleTables, tableOptions]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setSelectedTables(currentRuleTables);
  }, [currentRuleTables, open]);

  useEffect(() => {
    if (open) {
      return;
    }
    setFormError("");
    setSelectedTables([]);
    setSubjectType("role");
    setSubjectId("member");
    setEffect("allow");
  }, [open]);

  const selectedTableSet = useMemo(() => new Set(selectedTables), [selectedTables]);
  const allTablesChecked =
    displayTableOptions.length > 0 &&
    displayTableOptions.every((tableName) => selectedTableSet.has(tableName));
  const errorMessage = formError || error;

  const toggleTable = (tableName: string): void => {
    setFormError("");
    clearError();
    setSelectedTables((previous) =>
      previous.includes(tableName)
        ? previous.filter((item) => item !== tableName)
        : [...previous, tableName]
    );
  };

  const submit = async (): Promise<void> => {
    if (!workspaceId || !datasourceId || selectedTables.length === 0) {
      setFormError("请至少勾选一个表。");
      return;
    }

    setFormError("");
    clearError();

    try {
      await replaceAcl({
        subjectType,
        subjectId: subjectId.trim(),
        effect,
        tableNames: selectedTables
      });
    } catch {
      // Error state is managed inside useWorkspaceTableAcl.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>表权限编辑器</DialogTitle>
          <DialogDescription>
            工作空间「{workspaceName}」数据源表 ACL（默认拒绝）。
          </DialogDescription>
        </DialogHeader>

        {loadingBindings ? (
          <StateBlock variant="loading">正在加载数据源绑定...</StateBlock>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              数据源
              <NativeSelect
                value={datasourceId}
                onChange={(event) => {
                  clearError();
                  setFormError("");
                  setDatasourceId(event.target.value);
                }}
              >
                {bindings.map((item) => (
                  <NativeSelectOption key={item.datasourceId} value={item.datasourceId}>
                    {item.datasourceName ?? item.datasourceId}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            <label className="grid gap-1 text-sm">
              主体类型
              <NativeSelect
                value={subjectType}
                onChange={(event) => {
                  clearError();
                  setSubjectType(event.target.value === "user" ? "user" : "role");
                }}
              >
                <NativeSelectOption value="role">角色</NativeSelectOption>
                <NativeSelectOption value="user">用户</NativeSelectOption>
              </NativeSelect>
            </label>
            <label className="grid gap-1 text-sm">
              主体标识
              <Input
                value={subjectId}
                onChange={(event) => {
                  clearError();
                  setSubjectId(event.target.value);
                }}
                placeholder={subjectType === "role" ? "member / admin" : "user id"}
              />
            </label>
            <label className="grid gap-1 text-sm">
              效果
              <NativeSelect
                value={effect}
                onChange={(event) => {
                  clearError();
                  setEffect(event.target.value === "deny" ? "deny" : "allow");
                }}
              >
                <NativeSelectOption value="allow">allow</NativeSelectOption>
                <NativeSelectOption value="deny">deny</NativeSelectOption>
              </NativeSelect>
            </label>
          </div>
        )}

        <div className="space-y-2 rounded-lg border border-[var(--border-default)] p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">可选表（从数据源读取，勾选后授权）</p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                type="button"
                disabled={displayTableOptions.length === 0}
                onClick={() =>
                  setSelectedTables(
                    allTablesChecked ? [] : [...displayTableOptions]
                  )
                }
              >
                {allTablesChecked ? "取消全选" : "全选"}
              </Button>
            </div>
          </div>

          {loadingTables ? (
            <StateBlock variant="loading">正在读取数据表...</StateBlock>
          ) : displayTableOptions.length === 0 ? (
            <StateBlock variant="idle">当前数据源未读取到可配置表。</StateBlock>
          ) : (
            <div className="max-h-[220px] space-y-2 overflow-auto pr-1">
              {displayTableOptions.map((tableName) => (
                <label
                  key={tableName}
                  className="flex items-center gap-2 rounded-md border border-[var(--border-default)] px-2 py-1.5 text-sm"
                >
                  <Checkbox
                    checked={selectedTableSet.has(tableName)}
                    onCheckedChange={() => toggleTable(tableName)}
                  />
                  <span className="font-mono text-xs">{tableName}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="max-h-[220px] overflow-auto rounded-lg border border-[var(--border-default)] p-3">
          <p className="mb-2 text-sm font-medium">当前规则</p>
          <ul className="space-y-1 text-xs text-[var(--text-muted)]">
            {rules.map((rule) => (
              <li key={rule.id}>
                {rule.datasourceId} · {rule.subjectType}:{rule.subjectId} · {rule.effect} ·{" "}
                {rule.tableName}
              </li>
            ))}
            {rules.length === 0 ? <li>暂无规则</li> : null}
          </ul>
        </div>

        {errorMessage ? <StateBlock variant="error">{errorMessage}</StateBlock> : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            关闭
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={saving || loadingBindings || loadingTables || !datasourceId}
          >
            {saving ? "保存中..." : "保存规则"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
