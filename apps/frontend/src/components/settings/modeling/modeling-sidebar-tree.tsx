"use client";

import { ChevronDown, ChevronRight, Database, FolderTree, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { ModelingGraphModel, ModelingGraphView } from "@text2sql/shared-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StateBlock } from "@/components/ui/state-block";

export type ModelingSidebarNode =
  | {
      kind: "model";
      id: string;
    }
  | {
      kind: "view";
      id: string;
    }
  | {
      kind: "relationship";
      id: string;
    };

function nodeKey(node: ModelingSidebarNode): string {
  return `${node.kind}:${node.id}`;
}

function isNodeSelected(
  selected: ModelingSidebarNode | null,
  candidate: ModelingSidebarNode
): boolean {
  if (!selected) {
    return false;
  }
  return selected.kind === candidate.kind && selected.id === candidate.id;
}

function resolveModelLabel(model: ModelingGraphModel): string {
  return model.displayName?.trim() || model.modelName?.trim() || model.tableName;
}

function resolveViewLabel(view: ModelingGraphView): string {
  return view.displayName?.trim() || view.name;
}

export function ModelingSidebarTree(props: {
  models: ModelingGraphModel[];
  views: ModelingGraphView[];
  selectedNode: ModelingSidebarNode | null;
  onSelectNode: (node: ModelingSidebarNode) => void;
  onCreateModel?: () => void;
  onDeleteModel?: (modelId: string) => void;
  onDeleteView?: (viewId: string) => void;
}) {
  const [modelExpanded, setModelExpanded] = useState(true);
  const [viewExpanded, setViewExpanded] = useState(true);

  const modelNodes = useMemo(
    () =>
      props.models.map((model) => ({
        model,
        node: { kind: "model", id: model.id } as const,
        title: resolveModelLabel(model),
        subtitle: model.tableName
      })),
    [props.models]
  );

  const viewNodes = useMemo(
    () =>
      props.views.map((view) => ({
        node: { kind: "view", id: view.id } as const,
        title: resolveViewLabel(view),
        subtitle: view.name
      })),
    [props.views]
  );

  return (
    <aside
      className="space-y-3 rounded-lg border border-[var(--border-default)] bg-white/90 p-3"
      data-testid="modeling-sidebar-tree"
    >
      <div>
        <p className="text-sm font-semibold text-[var(--text-primary)]">Modeling Assets</p>
        <p className="text-xs text-[var(--text-secondary)]">
          通过 Models / Views 树导航资产并进入详情编辑。
        </p>
        <div className="mt-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => {
              props.onCreateModel?.();
            }}
            aria-label="创建 model"
          >
            <Plus className="mr-1 h-4 w-4" />
            新建 Model
          </Button>
        </div>
      </div>

      <div className="space-y-2" role="tree" aria-label="建模资产树" data-testid="modeling-sidebar-tree-content">
        <div className="rounded-md border border-[var(--border-default)] bg-white">
          <button
            type="button"
            className="flex w-full items-center justify-between px-3 py-2 text-left"
            aria-label="切换 Models 树"
            aria-expanded={modelExpanded}
            onClick={() => {
              setModelExpanded((previous) => !previous);
            }}
          >
            <span className="inline-flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
              {modelExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <Database className="h-4 w-4" />
              Models
            </span>
            <Badge variant="outline">{modelNodes.length}</Badge>
          </button>
          {modelExpanded ? (
            <div className="space-y-1 border-t border-[var(--border-default)] p-2">
              {modelNodes.length === 0 ? (
                <StateBlock variant="idle">暂无 Models，先完成 setup 或手动创建。</StateBlock>
              ) : (
                modelNodes.map((item) => {
                  const selected = isNodeSelected(props.selectedNode, item.node);
                  return (
                    <div
                      key={nodeKey(item.node)}
                      className={`rounded-md border px-2 py-2 ${
                        selected
                          ? "border-[var(--action-primary)] bg-[var(--action-primary)]/5"
                          : "border-[var(--border-default)] bg-white"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          aria-label={`选择 model ${item.title}`}
                          onClick={() => {
                            props.onSelectNode(item.node);
                          }}
                        >
                          <span className="block truncate text-sm text-[var(--text-primary)]">
                            {item.title}
                          </span>
                          <span className="block truncate text-xs text-[var(--text-secondary)]">
                            {item.subtitle}
                          </span>
                        </button>
                        {props.onDeleteModel ? (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            aria-label={`删除 model ${item.title}`}
                            onClick={() => {
                              props.onDeleteModel?.(item.node.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                      {item.model.columns.length > 0 ? (
                        <div className="mt-1 space-y-1 border-t border-[var(--border-default)] pt-1">
                          {item.model.columns.map((column) => (
                            <p
                              key={`${item.model.id}:${column.name}`}
                              className="truncate pl-1 text-[11px] text-[var(--text-secondary)]"
                            >
                              {column.isPrimaryKey ? "PK " : ""}
                              {column.name}
                            </p>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          ) : null}
        </div>

        <div className="rounded-md border border-[var(--border-default)] bg-white">
          <button
            type="button"
            className="flex w-full items-center justify-between px-3 py-2 text-left"
            aria-label="切换 Views 树"
            aria-expanded={viewExpanded}
            onClick={() => {
              setViewExpanded((previous) => !previous);
            }}
          >
            <span className="inline-flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
              {viewExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <FolderTree className="h-4 w-4" />
              Views
            </span>
            <Badge variant="outline">{viewNodes.length}</Badge>
          </button>
          {viewExpanded ? (
            <div className="space-y-1 border-t border-[var(--border-default)] p-2">
              {viewNodes.length === 0 ? (
                <StateBlock variant="idle">暂无 Views，可后续由 SQL 保存为视图。</StateBlock>
              ) : (
                viewNodes.map((item) => {
                  const selected = isNodeSelected(props.selectedNode, item.node);
                  return (
                    <div
                      key={nodeKey(item.node)}
                      className={`flex items-center justify-between gap-2 rounded-md border px-2 py-2 ${
                        selected
                          ? "border-[var(--action-primary)] bg-[var(--action-primary)]/5"
                          : "border-[var(--border-default)] bg-white"
                      }`}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        aria-label={`选择 view ${item.title}`}
                        onClick={() => {
                          props.onSelectNode(item.node);
                        }}
                      >
                        <span className="block truncate text-sm text-[var(--text-primary)]">
                          {item.title}
                        </span>
                        <span className="block truncate text-xs text-[var(--text-secondary)]">
                          {item.subtitle}
                        </span>
                      </button>
                      {props.onDeleteView ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          aria-label={`删除 view ${item.title}`}
                          onClick={() => {
                            props.onDeleteView?.(item.node.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
