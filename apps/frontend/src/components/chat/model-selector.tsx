"use client";

import type { ModelCatalogItem } from "@text2sql/shared-types";
import { Label } from "@/components/ui/label";

interface ModelSelectorProps {
  models: ModelCatalogItem[];
  value?: string;
  disabled?: boolean;
  onChange: (modelCatalogId: string) => void;
}

export function ModelSelector({
  models,
  value,
  disabled,
  onChange
}: ModelSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="session-model-selector" className="text-xs text-slate-600">
        会话模型
      </Label>
      <select
        id="session-model-selector"
        className="h-8 min-w-[220px] rounded-md border border-input bg-background px-2 text-xs"
        value={value ?? ""}
        disabled={disabled || models.length === 0}
        onChange={(event) => onChange(event.target.value)}
      >
        {models.length === 0 ? (
          <option value="">暂无可用模型</option>
        ) : null}
        {models.map((item) => (
          <option key={item.id} value={item.id}>
            {item.displayName} ({item.provider})
          </option>
        ))}
      </select>
    </div>
  );
}
