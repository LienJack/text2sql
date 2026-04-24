"use client";

import { Button } from "@/components/ui/button";
import { StateBlock } from "@/components/ui/state-block";

export type ModelingSchemaChangeItem = {
  id: string;
  kind: "deleted_table" | "deleted_column" | "modified_column_type" | "other";
  status: "detected" | "resolved";
  summary: string;
};

export function ModelingSchemaChangePanel(props: {
  busy?: boolean;
  items: ModelingSchemaChangeItem[];
  unresolvedCount: number;
  onDetect: () => Promise<void> | void;
  onResolve: (changeId: string) => Promise<void> | void;
}) {
  const { busy, items, unresolvedCount, onDetect, onResolve } = props;
  const deletedTableItems = items.filter((item) => item.kind === "deleted_table");
  const deletedColumnItems = items.filter((item) => item.kind === "deleted_column");
  const modifiedColumnItems = items.filter((item) => item.kind === "modified_column_type");
  const otherItems = items.filter((item) => item.kind === "other");
  const resolvedCount = items.filter((item) => item.status === "resolved").length;

  const renderGroup = (input: {
    title: string;
    description: string;
    groupItems: ModelingSchemaChangeItem[];
    strategy: "auto" | "manual";
  }) => {
    const { title, description, groupItems, strategy } = input;
    if (groupItems.length === 0) {
      return null;
    }
    return (
      <div className="space-y-2 rounded-md border border-[var(--border-default)] bg-white p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          {title} ({groupItems.length})
        </p>
        <p className="text-xs text-[var(--text-secondary)]">{description}</p>
        <div className="space-y-2">
          {groupItems.map((item) => (
            <div
              key={item.id}
              className="rounded-md border border-[var(--border-default)] bg-white p-3"
            >
              <p className="text-sm text-[var(--text-primary)]">{item.summary}</p>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                {item.kind} · {item.id}
              </p>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-[var(--text-secondary)]">
                  状态：{item.status === "resolved" ? "resolved" : "detected"}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || item.status === "resolved" || strategy === "manual"}
                  onClick={() => {
                    void onResolve(item.id);
                  }}
                >
                  {item.status === "resolved"
                    ? "已处理"
                    : strategy === "manual"
                      ? "需人工处理"
                      : "Resolve"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <section className="space-y-3 rounded-lg border border-[var(--border-default)] bg-white/90 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">Schema Change</p>
          <p className="text-xs text-[var(--text-secondary)]">
            Detect / Resolve 数据库 schema drift（deleted / modified）。
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void onDetect()}>
          Detect
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-2 text-xs text-[var(--text-secondary)] sm:grid-cols-3">
        <div>
          Unresolved:{" "}
          <span className="font-medium text-[var(--text-primary)]">{unresolvedCount}</span>
        </div>
        <div>
          Resolved:{" "}
          <span className="font-medium text-[var(--text-primary)]">{resolvedCount}</span>
        </div>
        <div>
          Residual:{" "}
          <span className="font-medium text-[var(--text-primary)]">
            {unresolvedCount > 0 ? `仍有 ${unresolvedCount} 项待处理` : "已无残留阻断项"}
          </span>
        </div>
      </div>

      <div className="rounded-md border border-[var(--border-default)] bg-white p-3 text-xs text-[var(--text-secondary)]">
        <p className="font-medium text-[var(--text-primary)]">Impact Summary</p>
        <p className="mt-1">
          Deleted Tables: {deletedTableItems.length} · Deleted Columns: {deletedColumnItems.length} ·
          Modified Columns: {modifiedColumnItems.length} · Other: {otherItems.length}
        </p>
        <p className="mt-1">
          <span>Deleted ({deletedTableItems.length + deletedColumnItems.length})</span>
          <span> · </span>
          <span>Modified ({modifiedColumnItems.length})</span>
        </p>
      </div>

      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        <p className="font-medium">Deploy Gate</p>
        <p className="mt-1">
          未解决高风险项会阻断 Deploy；其中“列类型变化”需先人工重建后重新 Detect，不能直接 Resolve。
        </p>
      </div>

      {items.length === 0 ? (
        <StateBlock variant="idle">暂无 schema change 项，点击 Detect 开始扫描。</StateBlock>
      ) : (
        <div className="space-y-3">
          {renderGroup({
            title: "Table Deleted",
            description: "可执行 Resolve 自动清理受影响对象（model / relationship / CF / view）。",
            groupItems: deletedTableItems,
            strategy: "auto"
          })}
          {renderGroup({
            title: "Column Deleted",
            description: "可执行 Resolve 自动清理受影响对象（列与相关依赖）。",
            groupItems: deletedColumnItems,
            strategy: "auto"
          })}
          {renderGroup({
            title: "Column Type Changed",
            description: "需人工重建字段/模型后重新 Detect。",
            groupItems: modifiedColumnItems,
            strategy: "manual"
          })}
          {renderGroup({
            title: "Other",
            description: "请按摘要逐项排查；若支持自动处置可执行 Resolve。",
            groupItems: otherItems,
            strategy: "auto"
          })}
        </div>
      )}
    </section>
  );
}
