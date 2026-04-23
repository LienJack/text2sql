"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";

export const MODELING_FLOW_NODE_TYPE = "modelingFlowNode";

export type ModelingFlowNodeData = {
  kind: "model" | "view";
  title: string;
  subtitle: string;
  columnCount?: number;
};

export function ModelingFlowNode({
  id,
  data,
  selected,
  dragging
}: NodeProps<Node<ModelingFlowNodeData>>) {
  const nodeData = data as ModelingFlowNodeData;

  return (
    <div
      className={cn(
        "min-w-[220px] cursor-grab rounded-lg border bg-white px-3 py-2 shadow-sm transition-[border-color,box-shadow] active:cursor-grabbing",
        selected
          ? "border-[var(--action-primary)] ring-1 ring-[var(--action-primary)]/35"
          : "border-[var(--border-default)]",
        dragging ? "shadow-md ring-1 ring-[var(--action-primary)]/20" : ""
      )}
      data-node-id={id}
      data-node-kind={nodeData.kind}
      data-selected={selected ? "true" : "false"}
      data-dragging={dragging ? "true" : "false"}
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
