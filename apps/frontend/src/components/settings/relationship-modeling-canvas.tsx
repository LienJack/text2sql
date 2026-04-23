"use client";

import "@xyflow/react/dist/style.css";
import { Background, Controls, MiniMap, ReactFlow } from "@xyflow/react";
import { Plus, Trash2 } from "lucide-react";
import type { WorkspaceRelationshipEdge } from "@/lib/admin-api-client";
import { Button } from "@/components/ui/button";
import { StateBlock } from "@/components/ui/state-block";

const buildFlow = (edges: WorkspaceRelationshipEdge[]) => {
  const tableKeys = new Set<string>();
  for (const edge of edges) {
    tableKeys.add(`${edge.bridge.left.dataset}.${edge.bridge.left.table}`);
    tableKeys.add(`${edge.bridge.right.dataset}.${edge.bridge.right.table}`);
  }

  const nodes = Array.from(tableKeys).map((key, index) => ({
    id: key,
    data: { label: key },
    position: {
      x: (index % 3) * 240,
      y: Math.floor(index / 3) * 120
    }
  }));

  const flowEdges = edges.map((edge) => ({
    id: edge.id,
    source: `${edge.bridge.left.dataset}.${edge.bridge.left.table}`,
    target: `${edge.bridge.right.dataset}.${edge.bridge.right.table}`,
    label: `${edge.bridge.left.column} = ${edge.bridge.right.column} (${edge.bridge.confidence.toFixed(2)})`
  }));

  return { nodes, edges: flowEdges };
};

export function RelationshipModelingCanvas(props: {
  edges: WorkspaceRelationshipEdge[];
  onCreateEdge: () => void;
  onEditEdge: (edge: WorkspaceRelationshipEdge) => void;
  onRemoveEdge: (edgeId: string) => void;
}) {
  const flow = buildFlow(props.edges);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">Relationship Modeling Canvas</p>
          <p className="text-xs text-[var(--text-secondary)]">
            React Flow 可视化仅展示当前 draft；编辑通过下方关系边列表进行。
          </p>
        </div>
        <Button
          onClick={props.onCreateEdge}
          className="gap-1.5"
          aria-label="新增关系边"
        >
          <Plus className="h-4 w-4" />
          新增关系边
        </Button>
      </div>

      <div className="h-[360px] overflow-hidden rounded-lg border border-[var(--border-default)] bg-white">
        {flow.nodes.length > 0 ? (
          <ReactFlow nodes={flow.nodes} edges={flow.edges} fitView>
            <Background />
            <MiniMap zoomable pannable />
            <Controls />
          </ReactFlow>
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <StateBlock variant="idle">暂无关系边，先点击“新增关系边”。</StateBlock>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {props.edges.length === 0 ? (
          <StateBlock variant="idle">尚未定义关系边。</StateBlock>
        ) : (
          props.edges.map((edge) => (
            <div
              key={edge.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border-default)] bg-white p-3"
            >
              <button
                type="button"
                className="text-left"
                onClick={() => props.onEditEdge(edge)}
                aria-label={`编辑关系边 ${edge.id}`}
              >
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {edge.name ?? edge.id}
                </p>
                <p className="text-xs text-[var(--text-secondary)]">
                  {`${edge.bridge.left.dataset}.${edge.bridge.left.table}.${edge.bridge.left.column} = ${edge.bridge.right.dataset}.${edge.bridge.right.table}.${edge.bridge.right.column}`}
                </p>
              </button>
              <Button
                variant="ghost"
                size="sm"
                className="text-red-600 hover:text-red-700"
                onClick={() => props.onRemoveEdge(edge.id)}
                aria-label={`删除关系边 ${edge.id}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
