"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";

export const MODELING_FLOW_NODE_TYPE = "modelingFlowNode";

export type ModelingFlowNodeData = {
  kind: "model" | "view";
  title: string;
  subtitle: string;
  columnCount?: number;
  sections?: {
    columns: string[];
    calculatedFields: string[];
    relationships: string[];
  };
};

export function ModelingFlowNode({
  id,
  data,
  selected,
  dragging
}: NodeProps<Node<ModelingFlowNodeData>>) {
  const nodeData = data as ModelingFlowNodeData;
  const sectionItems = nodeData.sections;
  const sectionList =
    nodeData.kind === "model" && sectionItems
      ? [
          {
            key: "columns",
            title: "Columns",
            items: sectionItems.columns
          },
          {
            key: "calculatedFields",
            title: "Calculated Fields",
            items: sectionItems.calculatedFields
          },
          {
            key: "relationships",
            title: "Relationships",
            items: sectionItems.relationships
          }
        ]
      : [];

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
      {sectionList.length > 0 ? (
        <div className="mt-2 space-y-2">
          {sectionList.map((section) => {
            const previewItems = section.items.slice(0, 2);
            const remainingCount = Math.max(0, section.items.length - previewItems.length);
            return (
              <section
                key={section.key}
                className="rounded border border-[var(--border-default)]/80 bg-[var(--surface-muted)]/60 px-2 py-1"
                data-testid={`modeling-flow-node-section-${section.key}`}
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                  {section.title}
                </p>
                <p
                  className="mt-0.5 truncate text-[11px] text-[var(--text-secondary)]"
                  data-testid={`modeling-flow-node-section-${section.key}-items`}
                >
                  {previewItems.length > 0 ? previewItems.join(", ") : "—"}
                  {remainingCount > 0 ? ` +${remainingCount}` : ""}
                </p>
              </section>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
