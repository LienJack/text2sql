"use client";

import { ChevronDown, ChevronRight, Database, FolderTree } from "lucide-react";
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
}) {
  const [modelExpanded, setModelExpanded] = useState(true);
  const [viewExpanded, setViewExpanded] = useState(true);

  const modelNodes = useMemo(
    () =>
      props.models.map((model) => ({
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
                    <Button
                      key={nodeKey(item.node)}
                      type="button"
                      variant={selected ? "default" : "ghost"}
                      className="h-auto w-full justify-start px-2 py-2 text-left"
                      aria-label={`选择 model ${item.title}`}
                      onClick={() => {
                        props.onSelectNode(item.node);
                      }}
                    >
                      <span className="flex flex-col items-start">
                        <span className="text-sm">{item.title}</span>
                        <span className="text-xs opacity-80">{item.subtitle}</span>
                      </span>
                    </Button>
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
                    <Button
                      key={nodeKey(item.node)}
                      type="button"
                      variant={selected ? "default" : "ghost"}
                      className="h-auto w-full justify-start px-2 py-2 text-left"
                      aria-label={`选择 view ${item.title}`}
                      onClick={() => {
                        props.onSelectNode(item.node);
                      }}
                    >
                      <span className="flex flex-col items-start">
                        <span className="text-sm">{item.title}</span>
                        <span className="text-xs opacity-80">{item.subtitle}</span>
                      </span>
                    </Button>
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
