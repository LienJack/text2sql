"use client";

import { useMemo, useState } from "react";
import type { ModelingSetupTableOption } from "@/lib/admin-api-client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { StateBlock } from "@/components/ui/state-block";

export interface SetupModelsStepProps {
  tables: ModelingSetupTableOption[];
  selectedTableNames: string[];
  loading?: boolean;
  disabled?: boolean;
  onSelectionChange: (nextSelectedTableNames: string[]) => void;
}

function dedupeSorted(value: string[]): string[] {
  return Array.from(new Set(value.map((item) => item.trim().toLowerCase()).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right)
  );
}

export function SetupModelsStep({
  tables,
  selectedTableNames,
  loading = false,
  disabled = false,
  onSelectionChange
}: SetupModelsStepProps) {
  const [query, setQuery] = useState("");
  const normalizedSelected = useMemo(() => dedupeSorted(selectedTableNames), [selectedTableNames]);

  const filteredTables = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return tables;
    }
    return tables.filter((item) => {
      const searchable = `${item.tableName} ${item.schemaName ?? ""}`.toLowerCase();
      return searchable.includes(keyword);
    });
  }, [query, tables]);

  const selectedCount = normalizedSelected.length;
  const allVisibleSelected =
    filteredTables.length > 0 &&
    filteredTables.every((item) => normalizedSelected.includes(item.tableName));

  const toggleTable = (tableName: string, checked: boolean) => {
    const next = checked
      ? [...normalizedSelected, tableName]
      : normalizedSelected.filter((item) => item !== tableName);
    onSelectionChange(dedupeSorted(next));
  };

  if (loading) {
    return <StateBlock variant="loading">正在加载可选数据表...</StateBlock>;
  }

  if (tables.length === 0) {
    return (
      <StateBlock variant="idle">
        当前数据源没有可用数据表，请返回上一步检查连接或稍后重试。
      </StateBlock>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-medium text-[var(--text-primary)]">选择要纳入建模的表</p>
        <p className="text-xs text-[var(--text-tertiary)]">
          已选 {selectedCount} / {tables.length} 张表，后续会基于选择结果生成关系建议。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="按表名搜索"
          className="h-9 max-w-xs"
          disabled={disabled}
          aria-label="搜索可选数据表"
        />
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || filteredTables.length === 0}
          onClick={() => {
            const visibleTableNames = filteredTables.map((item) => item.tableName);
            onSelectionChange(
              allVisibleSelected
                ? normalizedSelected.filter((item) => !visibleTableNames.includes(item))
                : dedupeSorted([...normalizedSelected, ...visibleTableNames])
            );
          }}
        >
          {allVisibleSelected ? "取消当前筛选" : "全选当前筛选"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || normalizedSelected.length === 0}
          onClick={() => onSelectionChange([])}
        >
          清空选择
        </Button>
      </div>

      <div className="max-h-[44vh] space-y-2 overflow-auto rounded-xl border border-[var(--border-default)] bg-[var(--surface-sidebar)] p-3">
        {filteredTables.map((item) => {
          const inputId = `setup-table-${item.id}`;
          const checked = normalizedSelected.includes(item.tableName);
          return (
            <label
              key={item.id}
              htmlFor={inputId}
              className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-panel)] px-3 py-2.5 transition-colors hover:border-[var(--border-brand)]"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Checkbox
                  id={inputId}
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={(nextChecked) => toggleTable(item.tableName, Boolean(nextChecked))}
                  aria-label={`选择数据表 ${item.tableName}`}
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--text-primary)]">{item.tableName}</p>
                  {item.schemaName ? (
                    <p className="text-xs text-[var(--text-tertiary)]">schema: {item.schemaName}</p>
                  ) : null}
                </div>
              </div>
              {typeof item.rowCount === "number" ? (
                <span className="rounded-full border border-[var(--border-default)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
                  {item.rowCount.toLocaleString()} rows
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
    </div>
  );
}

