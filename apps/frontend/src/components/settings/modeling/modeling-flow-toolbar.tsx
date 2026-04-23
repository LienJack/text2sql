"use client";

import { LocateFixed, RefreshCw, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ModelingSidebarNode } from "@/components/settings/modeling/modeling-sidebar-tree";

export function ModelingFlowToolbar(props: {
  nodeCount: number;
  edgeCount: number;
  hasInvalidEdges: boolean;
  selectedNode: ModelingSidebarNode | null;
  busy?: boolean;
  onFitView?: () => void;
  onClearSelection?: () => void;
}) {
  const { nodeCount, edgeCount, hasInvalidEdges, selectedNode, busy, onFitView, onClearSelection } =
    props;
  const selectedSummary = selectedNode
    ? `${selectedNode.kind} · ${selectedNode.id}`
    : "当前未选中节点";

  return (
    <div
      className="rounded-lg border border-[var(--border-default)] bg-white/95 px-3 py-2"
      data-testid="modeling-flow-toolbar"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="inline-flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
            <Workflow className="h-4 w-4" />
            Flowchart Canvas
          </p>
          <p className="truncate text-xs text-[var(--text-secondary)]">当前选中：{selectedSummary}</p>
        </div>
        <div
          className="flex flex-wrap items-center gap-1.5"
          data-testid="modeling-flow-toolbar-actions"
        >
          <span className="rounded-full border border-[var(--border-default)] bg-[var(--surface-muted)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
            N {nodeCount}
          </span>
          <span className="rounded-full border border-[var(--border-default)] bg-[var(--surface-muted)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
            E {edgeCount}
          </span>
          {hasInvalidEdges ? (
            <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-700">
              存在未映射关系
            </span>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={onFitView}
            disabled={busy || !onFitView}
            aria-label="画布适配视图"
          >
            <LocateFixed className="h-4 w-4" />
            Fit
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={onClearSelection}
            disabled={busy || !selectedNode || !onClearSelection}
            aria-label="清除当前选中"
          >
            <RefreshCw className="h-4 w-4" />
            Clear
          </Button>
        </div>
      </div>
      {hasInvalidEdges ? (
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          存在关系缺口，建议优先在 Relationship Editor 修复后再部署。
        </p>
      ) : (
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          Nodes {nodeCount} · Edges {edgeCount}
        </p>
      )}
    </div>
  );
}
