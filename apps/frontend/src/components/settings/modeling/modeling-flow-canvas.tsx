"use client";

import "@xyflow/react/dist/style.css";
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type EdgeChange,
  type Edge,
  type EdgeTypes,
  type NodeChange,
  type Node,
  type NodeTypes,
  type ReactFlowInstance
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelingGraphPayload } from "@text2sql/shared-types";
import type { ModelingSidebarNode } from "@/components/settings/modeling/modeling-sidebar-tree";
import {
  MODELING_FLOW_EDGE_TYPE,
  ModelingFlowEdge,
  type ModelingFlowEdgeData
} from "@/components/settings/modeling/modeling-flow-edge";
import {
  MODELING_FLOW_NODE_TYPE,
  ModelingFlowNode,
  type ModelingFlowNodeData
} from "@/components/settings/modeling/modeling-flow-node";
import { ModelingFlowToolbar } from "@/components/settings/modeling/modeling-flow-toolbar";
import { StateBlock } from "@/components/ui/state-block";

const NODE_TYPES: NodeTypes = {
  [MODELING_FLOW_NODE_TYPE]: ModelingFlowNode
};

const EDGE_TYPES: EdgeTypes = {
  [MODELING_FLOW_EDGE_TYPE]: ModelingFlowEdge
};

const FLOW_COLUMNS = 3;
const FLOW_NODE_X_GAP = 280;
const FLOW_NODE_Y_GAP = 170;

function resolveModelLabel(model: ModelingGraphPayload["models"][number]): string {
  return model.displayName?.trim() || model.modelName?.trim() || model.tableName;
}

function resolveViewLabel(view: ModelingGraphPayload["views"][number]): string {
  return view.displayName?.trim() || view.name;
}

function toFlowNodeId(node: Extract<ModelingSidebarNode, { kind: "model" | "view" }>): string {
  return `${node.kind}:${node.id}`;
}

function fromFlowNodeId(nodeId: string): ModelingSidebarNode | null {
  if (nodeId.startsWith("model:")) {
    return {
      kind: "model",
      id: nodeId.slice("model:".length)
    };
  }
  if (nodeId.startsWith("view:")) {
    return {
      kind: "view",
      id: nodeId.slice("view:".length)
    };
  }
  return null;
}

function normalizeTableKey(tableName: string): string {
  return tableName.trim().toLowerCase();
}

function resolveRelationshipLabel(
  relationship: ModelingGraphPayload["relationships"][number]
): string {
  const bridge = relationship.bridge;
  const leftTable = bridge?.left?.table ?? "unknown_left_table";
  const leftColumn = bridge?.left?.column ?? "unknown_left_column";
  const rightTable = bridge?.right?.table ?? "unknown_right_table";
  const rightColumn = bridge?.right?.column ?? "unknown_right_column";
  return `${leftTable}.${leftColumn} = ${rightTable}.${rightColumn}`;
}

function buildGraph(
  graphPayload: ModelingGraphPayload
): {
  nodes: Array<Node<ModelingFlowNodeData>>;
  edges: Array<Edge<ModelingFlowEdgeData>>;
  invalidRelationshipCount: number;
} {
  const models = Array.isArray(graphPayload.models) ? graphPayload.models : [];
  const views = Array.isArray(graphPayload.views) ? graphPayload.views : [];
  const relationships = Array.isArray(graphPayload.relationships)
    ? graphPayload.relationships
    : [];

  const sortedModels = [...models].sort((left, right) =>
    resolveModelLabel(left).localeCompare(resolveModelLabel(right), "zh-CN")
  );
  const sortedViews = [...views].sort((left, right) =>
    resolveViewLabel(left).localeCompare(resolveViewLabel(right), "zh-CN")
  );

  const modelNodeIdByTable = new Map<string, string>();

  const modelNodes: Array<Node<ModelingFlowNodeData>> = sortedModels.map((model, index) => {
    const nodeId = toFlowNodeId({
      kind: "model",
      id: model.id
    });
    const tableKey = normalizeTableKey(model.tableName);
    if (tableKey && !modelNodeIdByTable.has(tableKey)) {
      modelNodeIdByTable.set(tableKey, nodeId);
    }
    return {
      id: nodeId,
      type: MODELING_FLOW_NODE_TYPE,
      data: {
        kind: "model",
        title: resolveModelLabel(model),
        subtitle: model.tableName,
        columnCount: Array.isArray(model.columns) ? model.columns.length : 0
      },
      position: {
        x: (index % FLOW_COLUMNS) * FLOW_NODE_X_GAP,
        y: Math.floor(index / FLOW_COLUMNS) * FLOW_NODE_Y_GAP
      }
    };
  });

  const modelRows = Math.max(1, Math.ceil(Math.max(modelNodes.length, 1) / FLOW_COLUMNS));

  const viewNodes: Array<Node<ModelingFlowNodeData>> = sortedViews.map((view, index) => {
    const nodeId = toFlowNodeId({
      kind: "view",
      id: view.id
    });
    return {
      id: nodeId,
      type: MODELING_FLOW_NODE_TYPE,
      data: {
        kind: "view",
        title: resolveViewLabel(view),
        subtitle: view.name
      },
      position: {
        x: (index % FLOW_COLUMNS) * FLOW_NODE_X_GAP,
        y: modelRows * FLOW_NODE_Y_GAP + 90 + Math.floor(index / FLOW_COLUMNS) * FLOW_NODE_Y_GAP
      }
    };
  });

  let invalidRelationshipCount = 0;

  const edges: Array<Edge<ModelingFlowEdgeData>> = relationships.flatMap((relationship, index) => {
    const bridge = relationship.bridge;
    const leftEndpoint = bridge?.left;
    const rightEndpoint = bridge?.right;

    if (!leftEndpoint || !rightEndpoint || !leftEndpoint.table || !rightEndpoint.table) {
      invalidRelationshipCount += 1;
      return [];
    }

    const sourceNodeId = modelNodeIdByTable.get(normalizeTableKey(leftEndpoint.table));
    const targetNodeId = modelNodeIdByTable.get(normalizeTableKey(rightEndpoint.table));
    const relationshipId = relationship.id || `relationship:${index}`;
    const confidence = Number.isFinite(relationship.confidence)
      ? relationship.confidence
      : bridge.confidence;
    const relationshipLabel = resolveRelationshipLabel(relationship);
    const normalizedConfidence = Number.isFinite(confidence) ? confidence : 0;
    const relationshipType =
      relationship.type === "many-to-one" ||
      relationship.type === "one-to-many" ||
      relationship.type === "one-to-one"
        ? relationship.type
        : relationship.cardinality === "many-to-one" ||
            relationship.cardinality === "one-to-many" ||
            relationship.cardinality === "one-to-one"
          ? relationship.cardinality
          : undefined;

    if (!sourceNodeId || !targetNodeId) {
      invalidRelationshipCount += 1;
      const fallbackNodeId = sourceNodeId ?? targetNodeId ?? modelNodes[0]?.id;
      if (!fallbackNodeId) {
        return [];
      }
      const edgeData: ModelingFlowEdgeData = {
        label: relationshipLabel,
        source: relationship.source,
        confidence: normalizedConfidence,
        type: relationshipType,
        cardinality: relationshipType,
        invalid: true
      };
      return [
        {
          id: relationshipId,
          source: sourceNodeId ?? fallbackNodeId,
          target: targetNodeId ?? fallbackNodeId,
          type: MODELING_FLOW_EDGE_TYPE,
          data: edgeData
        }
      ];
    }

    const edgeData: ModelingFlowEdgeData = {
      label: relationshipLabel,
      source: relationship.source,
      confidence: normalizedConfidence,
      type: relationshipType,
      cardinality: relationshipType,
      invalid: false
    };
    return [
      {
        id: relationshipId,
        source: sourceNodeId,
        target: targetNodeId,
        type: MODELING_FLOW_EDGE_TYPE,
        animated: relationship.source === "inferred",
        data: edgeData
      }
    ];
  });

  return {
    nodes: [...modelNodes, ...viewNodes],
    edges,
    invalidRelationshipCount
  };
}

export function ModelingFlowCanvas(props: {
  graphPayload: ModelingGraphPayload;
  selectedNode: ModelingSidebarNode | null;
  busy?: boolean;
  autoLayoutKey: string;
  onSelectNode: (node: ModelingSidebarNode | null) => void;
}) {
  const { graphPayload, selectedNode, busy, autoLayoutKey, onSelectNode } = props;

  const [flowInstance, setFlowInstance] = useState<
    ReactFlowInstance<Node<ModelingFlowNodeData>, Edge<ModelingFlowEdgeData>> | null
  >(null);
  const [didAutoFit, setDidAutoFit] = useState(false);
  const [flowNodes, setFlowNodes] = useState<Array<Node<ModelingFlowNodeData>>>([]);
  const [flowEdges, setFlowEdges] = useState<Array<Edge<ModelingFlowEdgeData>>>([]);
  const selectionFocusKeyRef = useRef("");

  const graph = useMemo(() => {
    try {
      return {
        ...buildGraph(graphPayload),
        graphBuildError: ""
      };
    } catch (error) {
      return {
        nodes: [],
        edges: [],
        invalidRelationshipCount: 0,
        graphBuildError:
          error instanceof Error ? error.message : "graph payload 映射失败，请检查数据结构。"
      };
    }
  }, [graphPayload]);
  const selectedFlowNodeId =
    selectedNode?.kind === "model" || selectedNode?.kind === "view"
      ? toFlowNodeId(selectedNode)
      : "";
  const selectedRelationshipId = selectedNode?.kind === "relationship" ? selectedNode.id : "";

  useEffect(() => {
    setFlowNodes((previousNodes) => {
      const previousPositionById = new Map(
        previousNodes.map((node) => [node.id, node.position] as const)
      );
      return graph.nodes.map((node) => ({
        ...node,
        position: previousPositionById.get(node.id) ?? node.position
      }));
    });
    setFlowEdges(graph.edges);
  }, [graph]);

  useEffect(() => {
    setFlowNodes((previousNodes) =>
      previousNodes.map((node) => {
        const isSelected = node.id === selectedFlowNodeId;
        if (node.selected === isSelected) {
          return node;
        }
        return {
          ...node,
          selected: isSelected
        };
      })
    );
    setFlowEdges((previousEdges) =>
      previousEdges.map((edge) => {
        const isSelected = edge.id === selectedRelationshipId;
        if (edge.selected === isSelected) {
          return edge;
        }
        return {
          ...edge,
          selected: isSelected
        };
      })
    );
  }, [selectedFlowNodeId, selectedRelationshipId]);

  useEffect(() => {
    setDidAutoFit(false);
    selectionFocusKeyRef.current = "";
  }, [autoLayoutKey]);

  useEffect(() => {
    if (didAutoFit || !flowInstance || flowNodes.length === 0 || busy) {
      return;
    }
    const rafId = window.requestAnimationFrame(() => {
      flowInstance.fitView({
        padding: 0.2,
        duration: 260
      });
      setDidAutoFit(true);
    });
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [busy, didAutoFit, flowInstance, flowNodes.length]);

  useEffect(() => {
    if (!flowInstance || busy) {
      return;
    }
    if (!selectedFlowNodeId) {
      selectionFocusKeyRef.current = "";
      return;
    }
    const selectionKey = selectedFlowNodeId;
    if (selectionFocusKeyRef.current === selectionKey) {
      return;
    }
    flowInstance.fitView({
      nodes: [{ id: selectedFlowNodeId }],
      padding: 0.3,
      maxZoom: 1.15,
      duration: 220
    });
    selectionFocusKeyRef.current = selectionKey;
  }, [busy, flowInstance, selectedFlowNodeId]);

  const handleFitView = useCallback(() => {
    flowInstance?.fitView({
      padding: 0.2,
      duration: 260
    });
  }, [flowInstance]);

  const handleNodeClick = useCallback(
    (_event: unknown, node: Node<ModelingFlowNodeData>) => {
      const nextNode = fromFlowNodeId(node.id);
      if (!nextNode) {
        return;
      }
      onSelectNode(nextNode);
    },
    [onSelectNode]
  );

  const handleEdgeClick = useCallback(
    (_event: unknown, edge: Edge<ModelingFlowEdgeData>) => {
      onSelectNode({
        kind: "relationship",
        id: edge.id
      });
    },
    [onSelectNode]
  );

  const handleNodesChange = useCallback(
    (changes: Array<NodeChange<Node<ModelingFlowNodeData>>>) => {
      setFlowNodes((previousNodes) => applyNodeChanges(changes, previousNodes));
    },
    []
  );

  const handleEdgesChange = useCallback(
    (changes: Array<EdgeChange<Edge<ModelingFlowEdgeData>>>) => {
      setFlowEdges((previousEdges) => applyEdgeChanges(changes, previousEdges));
    },
    []
  );

  const canRenderReactFlow =
    typeof window !== "undefined" && typeof window.ResizeObserver !== "undefined";

  return (
    <section className="space-y-3" data-testid="modeling-flow-canvas">
      <ModelingFlowToolbar
        nodeCount={flowNodes.length}
        edgeCount={flowEdges.length}
        hasInvalidEdges={graph.invalidRelationshipCount > 0}
        selectedNode={selectedNode}
        busy={busy}
        onFitView={handleFitView}
        onClearSelection={() => {
          onSelectNode(null);
        }}
      />

      {graph.invalidRelationshipCount > 0 ? (
        <StateBlock variant="error">
          检测到 {graph.invalidRelationshipCount} 条 relationship 无法完整映射到 model 节点，已在画布中以异常连线标注，请检查导入表与 graph 数据一致性。
        </StateBlock>
      ) : null}

      <div className="h-[500px] overflow-hidden rounded-lg border border-[var(--border-default)] bg-white/95">
        {busy ? (
          <div className="flex h-full items-center justify-center p-6">
            <StateBlock variant="loading">正在加载 modeling graph…</StateBlock>
          </div>
        ) : graph.graphBuildError ? (
          <div className="flex h-full items-center justify-center p-6">
            <StateBlock variant="error">
              graph 映射出现异常，已阻止画布崩溃。请检查模型/关系数据后重试（{graph.graphBuildError}）。
            </StateBlock>
          </div>
        ) : flowNodes.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6">
            <StateBlock variant="idle">
              暂无可渲染节点。请先在数据源 setup 中导入表，或在建模页创建 model/view 资产。
            </StateBlock>
          </div>
        ) : canRenderReactFlow ? (
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onNodeClick={handleNodeClick}
            onEdgeClick={handleEdgeClick}
            onPaneClick={() => {
              onSelectNode(null);
            }}
            onInit={(instance) => {
              setFlowInstance(instance);
            }}
            onlyRenderVisibleElements
            minZoom={0.2}
            maxZoom={1.8}
          >
            <Background />
            <MiniMap pannable zoomable />
            <Controls />
          </ReactFlow>
        ) : (
          <div className="space-y-2 p-3" data-testid="modeling-flow-fallback">
            <StateBlock variant="idle">
              当前环境不支持 Flow 渲染器，已切换为简化列表视图（仅用于低能力运行环境）。
            </StateBlock>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {flowNodes.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  className="rounded-md border border-[var(--border-default)] bg-white px-3 py-2 text-left"
                  onClick={() => {
                    const nextNode = fromFlowNodeId(node.id);
                    if (nextNode) {
                      onSelectNode(nextNode);
                    }
                  }}
                >
                  <p className="text-sm font-medium text-[var(--text-primary)]">{node.data.title}</p>
                  <p className="text-xs text-[var(--text-secondary)]">{node.data.subtitle}</p>
                </button>
              ))}
            </div>
            {flowEdges.length > 0 ? (
              <div className="space-y-1 rounded-md border border-[var(--border-default)] bg-white p-3">
                <p className="text-xs font-medium text-[var(--text-primary)]">Relationships</p>
                {flowEdges.map((edge) => (
                  <button
                    key={edge.id}
                    type="button"
                    className="block w-full rounded px-1 py-1 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-muted)]"
                    onClick={() => {
                      onSelectNode({ kind: "relationship", id: edge.id });
                    }}
                  >
                    {edge.data?.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {flowEdges.length === 0 && flowNodes.length > 0 ? (
        <StateBlock variant="idle">当前无 relationships 连线，可继续在 Relationship Editor 中补充。</StateBlock>
      ) : null}
    </section>
  );
}
