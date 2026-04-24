"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  CalendarClock,
  EllipsisVertical,
  Hash,
  KeyRound,
  Type as TypeIcon,
  Boxes
} from "lucide-react";
import { cn } from "@/lib/utils";

export const MODELING_FLOW_NODE_TYPE = "modelingFlowNode";
export const MODELING_FLOW_NODE_FALLBACK_SOURCE_HANDLE_ID = "modeling-node-source";
export const MODELING_FLOW_NODE_FALLBACK_TARGET_HANDLE_ID = "modeling-node-target";
export const MODELING_FLOW_NODE_FALLBACK_SOURCE_LEFT_HANDLE_ID = "modeling-node-source-left";
export const MODELING_FLOW_NODE_FALLBACK_TARGET_RIGHT_HANDLE_ID = "modeling-node-target-right";

export function resolveModelingFlowFallbackHandleId(
  kind: "source" | "target",
  side: "left" | "right"
): string {
  if (kind === "source") {
    return side === "left"
      ? MODELING_FLOW_NODE_FALLBACK_SOURCE_LEFT_HANDLE_ID
      : MODELING_FLOW_NODE_FALLBACK_SOURCE_HANDLE_ID;
  }
  return side === "right"
    ? MODELING_FLOW_NODE_FALLBACK_TARGET_RIGHT_HANDLE_ID
    : MODELING_FLOW_NODE_FALLBACK_TARGET_HANDLE_ID;
}

export type ModelingFlowRelationshipDisplayMeta = {
  primaryText: string;
  secondaryText?: string;
  title?: string;
};

export type ModelingFlowColumnDisplayMeta = {
  dataType?: string;
  isPrimaryKey?: boolean;
};

export type ModelingFlowNodeAction =
  | { type: "addCalculatedField" }
  | { type: "addRelationship" }
  | { type: "editRelationship"; relationshipId: string };

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
  columnDisplayMeta?: ModelingFlowColumnDisplayMeta[];
  relationshipDisplayMeta?: ModelingFlowRelationshipDisplayMeta[];
  relationshipActionIds?: Array<string | null>;
  actionsDisabled?: boolean;
  onNodeAction?: (action: ModelingFlowNodeAction) => void;
};

type ModelingFlowNodeSectionKey = "columns" | "calculatedFields" | "relationships";

type ModelingFlowNodeSection = {
  key: ModelingFlowNodeSectionKey;
  title: string;
  items: string[];
  policy: "summary" | "full";
};

const MODELING_FLOW_NODE_SECTIONS: Array<{
  key: ModelingFlowNodeSectionKey;
  title: string;
  policy: "summary" | "full";
}> = [
  {
    key: "columns",
    title: "Columns",
    policy: "full"
  },
  {
    key: "calculatedFields",
    title: "Calculated Fields",
    policy: "full"
  },
  {
    key: "relationships",
    title: "Relationships",
    policy: "full"
  }
];

function normalizeHandleToken(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "unknown";
}

export function createModelingFlowFieldHandleId(
  columnName: string,
  side: "left" | "right"
): string {
  return `modeling-field-${side}-${normalizeHandleToken(columnName)}`;
}

export function createModelingFlowRelationshipHandleId(
  relationshipId: string,
  side: "left" | "right"
): string {
  return `modeling-relationship-${side}-${normalizeHandleToken(relationshipId)}`;
}

function resolveColumnTypeIcon(dataType?: string): typeof TypeIcon {
  const normalizedDataType = dataType?.trim().toLowerCase() ?? "";
  if (
    normalizedDataType.includes("int") ||
    normalizedDataType.includes("number") ||
    normalizedDataType.includes("decimal") ||
    normalizedDataType.includes("float") ||
    normalizedDataType.includes("double") ||
    normalizedDataType.includes("real")
  ) {
    return Hash;
  }
  if (
    normalizedDataType.includes("date") ||
    normalizedDataType.includes("time") ||
    normalizedDataType.includes("timestamp")
  ) {
    return CalendarClock;
  }
  return TypeIcon;
}

export function ModelingFlowNode({
  id,
  data,
  selected,
  dragging
}: NodeProps<Node<ModelingFlowNodeData>>) {
  const nodeData = data as ModelingFlowNodeData;
  const actionScopeLabel = nodeData.title.trim() || nodeData.subtitle.trim() || id;
  const nodeActionDisabled = Boolean(nodeData.actionsDisabled || !nodeData.onNodeAction);
  const sectionItems = nodeData.sections;
  const sectionList: ModelingFlowNodeSection[] =
    nodeData.kind === "model" && sectionItems
      ? MODELING_FLOW_NODE_SECTIONS.map((section) => ({
          key: section.key,
          title: section.title,
          policy: section.policy,
          items: sectionItems[section.key]
        }))
      : [];
  const emitNodeAction = (action: ModelingFlowNodeAction): void => {
    if (nodeActionDisabled) {
      return;
    }
    nodeData.onNodeAction?.(action);
  };

  return (
    <div
      className={cn(
        "min-w-[214px] max-w-[234px] cursor-grab overflow-hidden rounded-[10px] border bg-white shadow-[0_3px_12px_rgba(15,23,42,0.08)] transition-[border-color,box-shadow] active:cursor-grabbing",
        selected
          ? "border-[var(--action-primary)] ring-1 ring-[var(--action-primary)]/25"
          : "border-[var(--border-default)]",
        dragging ? "shadow-[0_8px_24px_rgba(37,99,235,0.2)] ring-1 ring-[var(--action-primary)]/20" : ""
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
        id={MODELING_FLOW_NODE_FALLBACK_TARGET_HANDLE_ID}
        className="h-2 w-2 border border-[var(--action-primary)] bg-white opacity-0"
      />
      <Handle
        type="source"
        position={Position.Left}
        id={MODELING_FLOW_NODE_FALLBACK_SOURCE_LEFT_HANDLE_ID}
        className="h-2 w-2 border border-[var(--action-primary)] bg-white opacity-0"
      />
      <Handle
        type="source"
        position={Position.Right}
        id={MODELING_FLOW_NODE_FALLBACK_SOURCE_HANDLE_ID}
        className="h-2 w-2 border border-[var(--action-primary)] bg-white opacity-0"
      />
      <Handle
        type="target"
        position={Position.Right}
        id={MODELING_FLOW_NODE_FALLBACK_TARGET_RIGHT_HANDLE_ID}
        className="h-2 w-2 border border-[var(--action-primary)] bg-white opacity-0"
      />
      <div className="flex items-center justify-between gap-1.5 bg-[var(--action-primary)] px-2 py-[5px] text-white">
        <p className="inline-flex min-w-0 items-center gap-1.5 text-[15px] font-semibold">
          <Boxes className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{nodeData.title}</span>
        </p>
        <button
          type="button"
          className="inline-flex h-5 w-5 items-center justify-center rounded text-white/85 hover:bg-white/15 hover:text-white"
          aria-label={`${actionScopeLabel} 节点菜单`}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
          }}
          onKeyUp={(event) => {
            event.stopPropagation();
          }}
        >
          <EllipsisVertical className="h-4 w-4" />
        </button>
      </div>

      <div className="py-0">
        {sectionList.length > 0 ? (
          <div>
            {sectionList.map((section) => {
              return (
                <section
                  key={section.key}
                  className="border-t border-[var(--border-default)]/80 first:border-t-0"
                  data-testid={`modeling-flow-node-section-${section.key}`}
                >
                  <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                    <p className="text-[13px] font-medium text-[var(--text-secondary)]">
                      {section.title}
                    </p>
                    {section.key === "calculatedFields" ? (
                      <button
                        type="button"
                        className={cn(
                          "inline-flex h-[15px] w-[15px] items-center justify-center rounded-sm border border-[var(--border-strong)] text-[10px] leading-none text-[var(--text-secondary)]",
                          nodeActionDisabled
                            ? "cursor-not-allowed opacity-55"
                            : "hover:border-[var(--action-primary)] hover:text-[var(--action-primary)]"
                        )}
                        aria-label={`为 ${actionScopeLabel} 新增 Calculated Field`}
                        data-testid="modeling-flow-node-action-add-calculated-field"
                        disabled={nodeActionDisabled}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                        }}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                        }}
                        onKeyUp={(event) => {
                          event.stopPropagation();
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          emitNodeAction({ type: "addCalculatedField" });
                        }}
                      >
                        +
                      </button>
                    ) : null}
                    {section.key === "relationships" ? (
                      <button
                        type="button"
                        className={cn(
                          "inline-flex h-[15px] w-[15px] items-center justify-center rounded-sm border border-[var(--border-strong)] text-[10px] leading-none text-[var(--text-secondary)]",
                          nodeActionDisabled
                            ? "cursor-not-allowed opacity-55"
                            : "hover:border-[var(--action-primary)] hover:text-[var(--action-primary)]"
                        )}
                        aria-label={`为 ${actionScopeLabel} 新增 Relationship`}
                        data-testid="modeling-flow-node-action-add-relationship"
                        disabled={nodeActionDisabled}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                        }}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                        }}
                        onKeyUp={(event) => {
                          event.stopPropagation();
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          emitNodeAction({ type: "addRelationship" });
                        }}
                      >
                        +
                      </button>
                    ) : null}
                  </div>

                  {section.items.length > 0 ? (
                    <ul
                      className="space-y-0 pb-1"
                      data-testid={`modeling-flow-node-section-${section.key}-items`}
                    >
                      {section.items.map((item, index) => {
                        const relationshipMeta =
                          section.key === "relationships"
                            ? nodeData.relationshipDisplayMeta?.[index]
                            : undefined;
                        const relationshipActionId =
                          section.key === "relationships"
                            ? nodeData.relationshipActionIds?.[index]
                            : null;
                        const hasRelationshipActionEntry =
                          section.key === "relationships" && Boolean(relationshipActionId);
                        const canEditRelationship = hasRelationshipActionEntry && !nodeActionDisabled;
                        const primaryText = relationshipMeta?.primaryText?.trim() || item;
                        const title =
                          relationshipMeta?.title?.trim() ||
                          (relationshipMeta?.secondaryText?.trim()
                            ? `${primaryText} · ${relationshipMeta.secondaryText.trim()}`
                            : primaryText);
                        if (section.key === "columns") {
                          const columnMeta = nodeData.columnDisplayMeta?.[index];
                          const ColumnTypeIcon = resolveColumnTypeIcon(columnMeta?.dataType);
                          return (
                            <li
                              key={`${section.key}-${item}-${index}`}
                              className="group relative flex items-center gap-1.5 px-2 py-1 text-[15px] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
                              title={item}
                            >
                              <Handle
                                id={createModelingFlowFieldHandleId(item, "left")}
                                type="target"
                                position={Position.Left}
                                className="h-2 w-2 -translate-x-1/2 border border-[var(--action-primary)] bg-white opacity-0"
                              />
                              <Handle
                                id={createModelingFlowFieldHandleId(item, "left")}
                                type="source"
                                position={Position.Left}
                                className="h-2 w-2 -translate-x-1/2 border border-[var(--action-primary)] bg-white opacity-0"
                              />
                              <Handle
                                id={createModelingFlowFieldHandleId(item, "right")}
                                type="source"
                                position={Position.Right}
                                className="h-2 w-2 translate-x-1/2 border border-[var(--action-primary)] bg-white opacity-0"
                              />
                              <Handle
                                id={createModelingFlowFieldHandleId(item, "right")}
                                type="target"
                                position={Position.Right}
                                className="h-2 w-2 translate-x-1/2 border border-[var(--action-primary)] bg-white opacity-0"
                              />
                              <ColumnTypeIcon className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
                              <span className="truncate">{item}</span>
                              {columnMeta?.isPrimaryKey ? (
                                <KeyRound className="ml-auto h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
                              ) : null}
                            </li>
                          );
                        }
                        return (
                          <li
                            key={`${section.key}-${item}-${index}`}
                            className="relative truncate px-2 py-1 text-[15px] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
                            title={title}
                          >
                            {hasRelationshipActionEntry ? (
                              <>
                                <Handle
                                  id={createModelingFlowRelationshipHandleId(
                                    relationshipActionId as string,
                                    "left"
                                  )}
                                  type="target"
                                  position={Position.Left}
                                  className="h-2 w-2 -translate-x-1/2 border border-[var(--action-primary)] bg-white opacity-0"
                                />
                                <Handle
                                  id={createModelingFlowRelationshipHandleId(
                                    relationshipActionId as string,
                                    "left"
                                  )}
                                  type="source"
                                  position={Position.Left}
                                  className="h-2 w-2 -translate-x-1/2 border border-[var(--action-primary)] bg-white opacity-0"
                                />
                                <Handle
                                  id={createModelingFlowRelationshipHandleId(
                                    relationshipActionId as string,
                                    "right"
                                  )}
                                  type="source"
                                  position={Position.Right}
                                  className="h-2 w-2 translate-x-1/2 border border-[var(--action-primary)] bg-white opacity-0"
                                />
                                <Handle
                                  id={createModelingFlowRelationshipHandleId(
                                    relationshipActionId as string,
                                    "right"
                                  )}
                                  type="target"
                                  position={Position.Right}
                                  className="h-2 w-2 translate-x-1/2 border border-[var(--action-primary)] bg-white opacity-0"
                                />
                              </>
                            ) : null}
                            {hasRelationshipActionEntry ? (
                              <button
                                type="button"
                                className={cn(
                                  "inline-flex w-full items-center gap-1.5 truncate text-left",
                                  canEditRelationship
                                    ? "text-[var(--text-primary)] hover:text-[var(--action-primary)]"
                                    : "cursor-not-allowed opacity-55"
                                )}
                                aria-label={`编辑 ${actionScopeLabel} 的 Relationship ${primaryText}`}
                                data-testid={`modeling-flow-node-action-edit-relationship-${relationshipActionId}`}
                                disabled={!canEditRelationship}
                                onPointerDown={(event) => {
                                  event.stopPropagation();
                                }}
                                onKeyDown={(event) => {
                                  event.stopPropagation();
                                }}
                                onKeyUp={(event) => {
                                  event.stopPropagation();
                                }}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  emitNodeAction({
                                    type: "editRelationship",
                                    relationshipId: relationshipActionId as string
                                  });
                                }}
                              >
                                <Boxes className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
                                <span className="truncate">{primaryText}</span>
                                <EllipsisVertical className="ml-auto h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
                              </button>
                            ) : (
                              <span className="inline-flex items-center gap-1.5">
                                <Boxes className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
                                <span className="truncate">{primaryText}</span>
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p
                      className="px-2.5 pb-1 text-[15px] text-[var(--text-secondary)]"
                      data-testid={`modeling-flow-node-section-${section.key}-items`}
                    >
                      —
                    </p>
                  )}
                </section>
              );
            })}
          </div>
        ) : nodeData.kind === "view" ? (
          <div className="px-2.5 py-2 text-[15px] text-[var(--text-secondary)]">{nodeData.subtitle}</div>
        ) : null}
      </div>
    </div>
  );
}
