"use client";

import { useMemo } from "react";
import type { ModelingSetupRelationshipSuggestion } from "@/lib/admin-api-client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { StateBlock } from "@/components/ui/state-block";

export interface SetupRelationshipsStepProps {
  suggestions: ModelingSetupRelationshipSuggestion[];
  selectedSuggestionIds: string[];
  disabled?: boolean;
  onSelectionChange: (nextSelectedSuggestionIds: string[]) => void;
}

function dedupe(value: string[]): string[] {
  return Array.from(new Set(value.map((item) => item.trim()).filter(Boolean)));
}

function resolveCardinalityBadge(
  cardinality: ModelingSetupRelationshipSuggestion["cardinality"]
): "1:N" | "1:1" {
  if (cardinality === "one-to-one") {
    return "1:1";
  }
  return "1:N";
}

function resolveDirectionText(
  cardinality: ModelingSetupRelationshipSuggestion["cardinality"]
): "N -> 1" | "1 -> N" | "1 -> 1" {
  if (cardinality === "one-to-many") {
    return "1 -> N";
  }
  if (cardinality === "one-to-one") {
    return "1 -> 1";
  }
  return "N -> 1";
}

function resolveSourceLabel(reason?: string): string {
  if (reason === "foreign_key_constraint") {
    return "FK";
  }
  if (reason === "fk_naming_suffix") {
    return "命名推断";
  }
  if (reason?.trim()) {
    return reason.trim();
  }
  return "推断";
}

export function SetupRelationshipsStep({
  suggestions,
  selectedSuggestionIds,
  disabled = false,
  onSelectionChange
}: SetupRelationshipsStepProps) {
  const normalizedSelected = useMemo(() => dedupe(selectedSuggestionIds), [selectedSuggestionIds]);
  const selectedCount = normalizedSelected.length;

  const toggleSuggestion = (suggestionId: string, checked: boolean) => {
    const next = checked
      ? [...normalizedSelected, suggestionId]
      : normalizedSelected.filter((item) => item !== suggestionId);
    onSelectionChange(dedupe(next));
  };

  if (suggestions.length === 0) {
    return (
      <div className="space-y-4">
        <StateBlock variant="idle">
          暂无可推荐的关系，直接继续即可进入建模页面进行手动补充。
        </StateBlock>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-medium text-[var(--text-primary)]">确认关系建议</p>
        <p className="text-xs text-[var(--text-tertiary)]">
          已选 {selectedCount} / {suggestions.length} 条建议关系，未选中的关系不会写入初始草稿。
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onSelectionChange(suggestions.map((item) => item.id))}
        >
          全选
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || normalizedSelected.length === 0}
          onClick={() => onSelectionChange([])}
        >
          全不选
        </Button>
      </div>

      <div className="max-h-[44vh] space-y-2 overflow-auto rounded-xl border border-[var(--border-default)] bg-[var(--surface-sidebar)] p-3">
        {suggestions.map((item) => {
          const inputId = `setup-relationship-${item.id}`;
          const checked = normalizedSelected.includes(item.id);
          return (
            <label
              key={item.id}
              htmlFor={inputId}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-panel)] px-3 py-3 transition-colors hover:border-[var(--border-brand)]"
            >
              <Checkbox
                id={inputId}
                checked={checked}
                disabled={disabled}
                onCheckedChange={(nextChecked) => toggleSuggestion(item.id, Boolean(nextChecked))}
                aria-label={`选择关系建议 ${item.name}`}
              />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{item.name}</p>
                  <span className="rounded-full border border-[var(--border-default)] bg-[var(--surface-subtle)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
                    {resolveCardinalityBadge(item.cardinality)}
                  </span>
                  <span className="rounded-full border border-[var(--border-default)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">
                    {resolveSourceLabel(item.reason)}
                  </span>
                </div>
                <p className="text-xs text-[var(--text-secondary)]">
                  Bridge: {item.left.dataset}.{item.left.table}.{item.left.column} ={" "}
                  {item.right.dataset}.{item.right.table}.{item.right.column}
                </p>
                <p className="text-xs text-[var(--text-tertiary)]">
                  方向 {resolveDirectionText(item.cardinality)}
                </p>
              </div>
              <span className="rounded-full border border-[var(--border-default)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
                置信度 {(item.confidence * 100).toFixed(0)}%
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
