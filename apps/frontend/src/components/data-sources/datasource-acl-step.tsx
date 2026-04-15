"use client";

import { useEffect, useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { StateBlock } from "@/components/ui/state-block";
import { useWorkspaceTableAcl } from "@/components/settings/use-workspace-table-acl";

type AclSubjectType = "role" | "user";
type AclEffect = "allow" | "deny";

interface DatasourceAclStepProps {
  open: boolean;
  workspaceId: string;
  datasourceId?: string;
  mode: "create" | "edit";
  subjectType: AclSubjectType;
  subjectId: string;
  effect: AclEffect;
  tableNames: string[];
  disabled?: boolean;
  onSubjectTypeChange: (value: AclSubjectType) => void;
  onSubjectIdChange: (value: string) => void;
  onEffectChange: (value: AclEffect) => void;
  onTableNamesChange: (tableNames: string[]) => void;
}

function normalizeTableNames(tableNames: string[]): string[] {
  const deduped = new Set<string>();
  for (const tableName of tableNames) {
    const normalized = tableName.trim().toLowerCase();
    if (normalized) {
      deduped.add(normalized);
    }
  }
  return Array.from(deduped);
}

function parseTableInput(value: string): string[] {
  return normalizeTableNames(value.split(/[\n,]/g));
}

export function DatasourceAclStep({
  open,
  workspaceId,
  datasourceId,
  mode,
  subjectType,
  subjectId,
  effect,
  tableNames,
  disabled,
  onSubjectTypeChange,
  onSubjectIdChange,
  onEffectChange,
  onTableNamesChange
}: DatasourceAclStepProps) {
  const canLoadExistingAcl =
    open && mode === "edit" && Boolean(workspaceId) && Boolean(datasourceId);
  const { tableOptions, rules, loadingTables, loadingRules, error } = useWorkspaceTableAcl({
    open: canLoadExistingAcl,
    workspaceId,
    initialDatasourceId: datasourceId
  });
  const [manualTablesText, setManualTablesText] = useState(tableNames.join(", "));
  const [touchedByUser, setTouchedByUser] = useState(false);

  const normalizedSubjectId = useMemo(() => subjectId.trim().toLowerCase(), [subjectId]);
  const existingRuleTables = useMemo(
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
  const checkboxTableOptions = useMemo(() => {
    const deduped = new Set<string>();
    for (const tableName of tableOptions) {
      const normalized = tableName.trim().toLowerCase();
      if (normalized) {
        deduped.add(normalized);
      }
    }
    for (const tableName of existingRuleTables) {
      const normalized = tableName.trim().toLowerCase();
      if (normalized) {
        deduped.add(normalized);
      }
    }
    return Array.from(deduped).sort((left, right) => left.localeCompare(right));
  }, [existingRuleTables, tableOptions]);
  const selectedTableSet = useMemo(() => new Set(tableNames), [tableNames]);

  useEffect(() => {
    setManualTablesText(tableNames.join(", "));
  }, [tableNames]);

  useEffect(() => {
    if (!canLoadExistingAcl || touchedByUser) {
      return;
    }
    if (existingRuleTables.length > 0) {
      onTableNamesChange(normalizeTableNames(existingRuleTables));
    }
  }, [canLoadExistingAcl, existingRuleTables, onTableNamesChange, touchedByUser]);

  const allSelected =
    checkboxTableOptions.length > 0 &&
    checkboxTableOptions.every((item) => selectedTableSet.has(item));

  const toggleTable = (tableName: string): void => {
    setTouchedByUser(true);
    if (selectedTableSet.has(tableName)) {
      onTableNamesChange(tableNames.filter((item) => item !== tableName));
      return;
    }
    onTableNamesChange(normalizeTableNames([...tableNames, tableName]));
  };

  return (
    <div className="space-y-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-subtle)] p-4">
      <div className="grid gap-3 md:grid-cols-3">
        <label className="grid gap-1">
          <Label className="text-xs text-[var(--text-tertiary)]">主体类型</Label>
          <NativeSelect
            value={subjectType}
            disabled={disabled}
            onChange={(event) => onSubjectTypeChange(event.target.value === "user" ? "user" : "role")}
          >
            <NativeSelectOption value="role">角色</NativeSelectOption>
            <NativeSelectOption value="user">用户</NativeSelectOption>
          </NativeSelect>
        </label>
        <label className="grid gap-1">
          <Label className="text-xs text-[var(--text-tertiary)]">主体标识</Label>
          <Input
            value={subjectId}
            disabled={disabled}
            placeholder={subjectType === "role" ? "member / admin" : "user id"}
            onChange={(event) => onSubjectIdChange(event.target.value)}
          />
        </label>
        <label className="grid gap-1">
          <Label className="text-xs text-[var(--text-tertiary)]">效果</Label>
          <NativeSelect
            value={effect}
            disabled={disabled}
            onChange={(event) => onEffectChange(event.target.value === "deny" ? "deny" : "allow")}
          >
            <NativeSelectOption value="allow">allow</NativeSelectOption>
            <NativeSelectOption value="deny">deny</NativeSelectOption>
          </NativeSelect>
        </label>
      </div>

      {canLoadExistingAcl && checkboxTableOptions.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-[var(--text-primary)]">可选数据表</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => {
                setTouchedByUser(true);
                onTableNamesChange(allSelected ? [] : [...checkboxTableOptions]);
              }}
            >
              {allSelected ? "取消全选" : "全选"}
            </Button>
          </div>
          {loadingRules || loadingTables ? (
            <StateBlock variant="loading">正在加载表与 ACL 规则...</StateBlock>
          ) : (
            <div className="max-h-[220px] space-y-2 overflow-auto rounded-md border border-[var(--border-default)] p-3">
              {checkboxTableOptions.map((tableName) => (
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
      ) : (
        <label className="grid gap-1">
          <Label className="text-sm font-medium text-[var(--text-primary)]">
            ACL 数据表（逗号/换行分隔）
          </Label>
          <textarea
            value={manualTablesText}
            disabled={disabled}
            rows={5}
            className="rounded-md border border-[var(--border-default)] bg-[var(--surface-panel)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none ring-offset-background focus-visible:border-[var(--ring)]"
            placeholder="orders, users"
            onChange={(event) => {
              setTouchedByUser(true);
              setManualTablesText(event.target.value);
              onTableNamesChange(parseTableInput(event.target.value));
            }}
          />
          <p className="text-xs text-[var(--text-tertiary)]">
            {canLoadExistingAcl
              ? "当前 workspace 下无法自动读取数据表，改为手动输入。"
              : "新建数据源阶段暂未自动探测表列表，请手动填写需要授权的表。"}
          </p>
        </label>
      )}

      {error ? <StateBlock variant="error">{error}</StateBlock> : null}
    </div>
  );
}

