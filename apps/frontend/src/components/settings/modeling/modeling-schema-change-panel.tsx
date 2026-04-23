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
  const deletedItems = items.filter(
    (item) => item.kind === "deleted_table" || item.kind === "deleted_column"
  );
  const modifiedItems = items.filter((item) => item.kind === "modified_column_type");
  const otherItems = items.filter((item) => item.kind === "other");
  const resolvedCount = items.filter((item) => item.status === "resolved").length;

  const renderGroup = (title: string, groupItems: ModelingSchemaChangeItem[]) => {
    if (groupItems.length === 0) {
      return null;
    }
    return (
      <div className="space-y-2 rounded-md border border-[var(--border-default)] bg-white p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          {title} ({groupItems.length})
        </p>
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
                  disabled={busy || item.status === "resolved"}
                  onClick={() => {
                    void onResolve(item.id);
                  }}
                >
                  Resolve
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
          Deleted: {deletedItems.length} · Modified: {modifiedItems.length} · Other:{" "}
          {otherItems.length}
        </p>
      </div>

      {items.length === 0 ? (
        <StateBlock variant="idle">暂无 schema change 项，点击 Detect 开始扫描。</StateBlock>
      ) : (
        <div className="space-y-3">
          {renderGroup("Deleted", deletedItems)}
          {renderGroup("Modified", modifiedItems)}
          {renderGroup("Other", otherItems)}
        </div>
      )}
    </section>
  );
}
