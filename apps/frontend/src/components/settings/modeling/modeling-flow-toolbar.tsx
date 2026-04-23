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
      className="rounded-lg border border-[var(--border-default)] bg-white/90 p-3"
      data-testid="modeling-flow-toolbar"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <Workflow className="h-4 w-4" />
            Flowchart Canvas
          </p>
          <p className="text-xs text-[var(--text-secondary)]">
            Nodes {nodeCount} · Edges {edgeCount}
            {hasInvalidEdges ? " · 部分关系未映射" : ""}
          </p>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">当前选中：{selectedSummary}</p>
        </div>
        <div className="flex flex-wrap gap-2" data-testid="modeling-flow-toolbar-actions">
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
            Fit View
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
            清除选中
          </Button>
        </div>
      </div>
    </div>
  );
}
