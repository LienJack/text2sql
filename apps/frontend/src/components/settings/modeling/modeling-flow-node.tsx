"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";

export const MODELING_FLOW_NODE_TYPE = "modelingFlowNode";

export type ModelingFlowNodeData = {
  kind: "model" | "view";
  title: string;
  subtitle: string;
  columnCount?: number;
};

export function ModelingFlowNode({ data, selected }: NodeProps) {
  const nodeData = data as ModelingFlowNodeData;

  return (
    <div
      className={cn(
        "min-w-[220px] rounded-lg border bg-white px-3 py-2 shadow-sm transition-colors",
        selected
          ? "border-[var(--action-primary)] ring-1 ring-[var(--action-primary)]/35"
          : "border-[var(--border-default)]"
      )}
      data-node-kind={nodeData.kind}
      data-testid="modeling-flow-node"
    >
      <Handle
        type="target"
        position={Position.Left}
        className="h-2 w-2 border-0 bg-[var(--action-primary)]"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="h-2 w-2 border-0 bg-[var(--action-primary)]"
      />
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{nodeData.title}</p>
        <span className="rounded border border-[var(--border-default)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--text-secondary)]">
          {nodeData.kind}
        </span>
      </div>
      <p className="truncate text-xs text-[var(--text-secondary)]">{nodeData.subtitle}</p>
      {typeof nodeData.columnCount === "number" ? (
        <p className="mt-1 text-[11px] text-[var(--text-secondary)]">列数 {nodeData.columnCount}</p>
      ) : null}
    </div>
  );
}
