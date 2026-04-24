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
import { LocateFixed, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelingGraphPayload } from "@text2sql/shared-types";
import { computeElkLayout } from "@/components/settings/modeling/layout/elk-layout";
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
import { Button } from "@/components/ui/button";
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
const AUTO_LAYOUT_TIMEOUT_MS = 2000;

type ModelingFlowNodePosition = {
  x: number;
  y: number;
};

type ModelingFlowPositionPatch = {
  models: Record<string, ModelingFlowNodePosition>;
  views: Record<string, ModelingFlowNodePosition>;
};

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

function isFinitePosition(value: unknown): value is ModelingFlowNodePosition {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.x === "number" &&
    Number.isFinite(record.x) &&
    typeof record.y === "number" &&
    Number.isFinite(record.y)
  );
}

function collectPersistedPositionByFlowNodeId(
  graphPayload: ModelingGraphPayload
): Map<string, ModelingFlowNodePosition> {
  const positionByNodeId = new Map<string, ModelingFlowNodePosition>();
  for (const model of graphPayload.models) {
    if (!isFinitePosition(model.position)) {
      continue;
    }
    positionByNodeId.set(toFlowNodeId({ kind: "model", id: model.id }), model.position);
  }
  for (const view of graphPayload.views) {
    if (!isFinitePosition(view.position)) {
      continue;
    }
    positionByNodeId.set(toFlowNodeId({ kind: "view", id: view.id }), view.position);
  }
  return positionByNodeId;
}

function collectPositionPatchFromFlowNodes(
  flowNodes: Array<Node<ModelingFlowNodeData>>
): ModelingFlowPositionPatch {
  const patch: ModelingFlowPositionPatch = {
    models: {},
    views: {}
  };
  for (const node of flowNodes) {
    const parsedNode = fromFlowNodeId(node.id);
    if (!parsedNode || !isFinitePosition(node.position)) {
      continue;
    }
    if (parsedNode.kind === "model") {
      patch.models[parsedNode.id] = node.position;
      continue;
    }
    patch.views[parsedNode.id] = node.position;
  }
  return patch;
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

function estimateLayoutNodeSize(node: Node<ModelingFlowNodeData>): { width: number; height: number } {
  if (node.data.kind === "view") {
    return {
      width: 240,
      height: 90
    };
  }
  const sectionCount = node.data.sections
    ? [node.data.sections.columns, node.data.sections.calculatedFields, node.data.sections.relationships]
        .filter((items) => items.length > 0).length
    : 0;
  return {
    width: 260,
    height: 120 + sectionCount * 44
  };
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
  const calculatedFields = Array.isArray(graphPayload.calculatedFields)
    ? graphPayload.calculatedFields
    : [];

  const sortedModels = [...models].sort((left, right) =>
    resolveModelLabel(left).localeCompare(resolveModelLabel(right), "zh-CN")
  );
  const sortedViews = [...views].sort((left, right) =>
    resolveViewLabel(left).localeCompare(resolveViewLabel(right), "zh-CN")
  );

  const modelNodeIdByTable = new Map<string, string>();
  const calculatedFieldNamesByModelId = new Map<string, string[]>();
  const relationshipIdsByTable = new Map<string, string[]>();

  for (const field of calculatedFields) {
    const modelId = field.modelId?.trim();
    const fieldName = field.name?.trim();
    if (!modelId || !fieldName) {
      continue;
    }
    const existing = calculatedFieldNamesByModelId.get(modelId) ?? [];
    existing.push(fieldName);
    calculatedFieldNamesByModelId.set(modelId, existing);
  }

  for (const relationship of relationships) {
    const relationshipId = relationship.id?.trim();
    if (!relationshipId) {
      continue;
    }
    const leftTable = relationship.bridge?.left?.table;
    const rightTable = relationship.bridge?.right?.table;
    for (const tableName of [leftTable, rightTable]) {
      const tableKey = typeof tableName === "string" ? normalizeTableKey(tableName) : "";
      if (!tableKey) {
        continue;
      }
      const existing = relationshipIdsByTable.get(tableKey) ?? [];
      existing.push(relationshipId);
      relationshipIdsByTable.set(tableKey, existing);
    }
  }

  const modelNodes: Array<Node<ModelingFlowNodeData>> = sortedModels.map((model, index) => {
    const nodeId = toFlowNodeId({
      kind: "model",
      id: model.id
    });
    const tableKey = normalizeTableKey(model.tableName);
    if (tableKey && !modelNodeIdByTable.has(tableKey)) {
      modelNodeIdByTable.set(tableKey, nodeId);
    }
    const fallbackColumns = Array.isArray(model.columns)
      ? model.columns.map((column) => column.name).filter(Boolean)
      : [];
    const fallbackCalculatedFields = calculatedFieldNamesByModelId.get(model.id) ?? [];
    const fallbackRelationships = relationshipIdsByTable.get(tableKey) ?? [];
    const sections = {
      columns:
        Array.isArray(model.nodeSections?.columns) && model.nodeSections.columns.length > 0
          ? model.nodeSections.columns
          : fallbackColumns,
      calculatedFields:
        Array.isArray(model.nodeSections?.calculatedFields) &&
        model.nodeSections.calculatedFields.length > 0
          ? model.nodeSections.calculatedFields
          : fallbackCalculatedFields,
      relationships:
        Array.isArray(model.nodeSections?.relationships) &&
        model.nodeSections.relationships.length > 0
          ? model.nodeSections.relationships
          : fallbackRelationships
    };
    const fallbackPosition = {
      x: (index % FLOW_COLUMNS) * FLOW_NODE_X_GAP,
      y: Math.floor(index / FLOW_COLUMNS) * FLOW_NODE_Y_GAP
    };
    return {
      id: nodeId,
      type: MODELING_FLOW_NODE_TYPE,
      data: {
        kind: "model",
        title: resolveModelLabel(model),
        subtitle: model.tableName,
        columnCount: sections.columns.length,
        sections
      },
      position: isFinitePosition(model.position) ? model.position : fallbackPosition
    };
  });

  const modelRows = Math.max(1, Math.ceil(Math.max(modelNodes.length, 1) / FLOW_COLUMNS));

  const viewNodes: Array<Node<ModelingFlowNodeData>> = sortedViews.map((view, index) => {
    const nodeId = toFlowNodeId({
      kind: "view",
      id: view.id
    });
    const fallbackPosition = {
      x: (index % FLOW_COLUMNS) * FLOW_NODE_X_GAP,
      y: modelRows * FLOW_NODE_Y_GAP + 90 + Math.floor(index / FLOW_COLUMNS) * FLOW_NODE_Y_GAP
    };
    return {
      id: nodeId,
      type: MODELING_FLOW_NODE_TYPE,
      data: {
        kind: "view",
        title: resolveViewLabel(view),
        subtitle: view.name
      },
      position: isFinitePosition(view.position) ? view.position : fallbackPosition
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
  onNodePositionsChange?: (patch: ModelingFlowPositionPatch) => void;
}) {
  const {
    graphPayload,
    selectedNode,
    busy,
    autoLayoutKey,
    onSelectNode,
    onNodePositionsChange
  } = props;

  const [flowInstance, setFlowInstance] = useState<
    ReactFlowInstance<Node<ModelingFlowNodeData>, Edge<ModelingFlowEdgeData>> | null
  >(null);
  const [didAutoFit, setDidAutoFit] = useState(false);
  const [flowNodes, setFlowNodes] = useState<Array<Node<ModelingFlowNodeData>>>([]);
  const [flowEdges, setFlowEdges] = useState<Array<Edge<ModelingFlowEdgeData>>>([]);
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [layoutMessage, setLayoutMessage] = useState("");
  const [layoutMessageVariant, setLayoutMessageVariant] = useState<"success" | "error">("success");
  const selectionFocusKeyRef = useRef("");
  const latestLayoutRunIdRef = useRef(0);

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
  const persistedPositionByNodeId = useMemo(
    () => collectPersistedPositionByFlowNodeId(graphPayload),
    [graphPayload]
  );
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
        position:
          persistedPositionByNodeId.get(node.id) ?? previousPositionById.get(node.id) ?? node.position
      }));
    });
    setFlowEdges(graph.edges);
  }, [graph, persistedPositionByNodeId]);

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
    latestLayoutRunIdRef.current += 1;
    setLayoutBusy(false);
    setLayoutMessage("");
  }, [autoLayoutKey]);

  useEffect(() => {
    if (!layoutMessage || layoutMessageVariant !== "success") {
      return;
    }
    const timerId = window.setTimeout(() => {
      setLayoutMessage("");
    }, 2400);
    return () => {
      window.clearTimeout(timerId);
    };
  }, [layoutMessage, layoutMessageVariant]);

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

  const handleAutoLayout = useCallback(async () => {
    if (busy || layoutBusy || flowNodes.length < 2) {
      return;
    }
    const currentRunId = latestLayoutRunIdRef.current + 1;
    latestLayoutRunIdRef.current = currentRunId;
    setLayoutBusy(true);
    setLayoutMessage("");

    const layoutResult = await computeElkLayout(
      {
        nodes: flowNodes.map((node) => {
          const size = estimateLayoutNodeSize(node);
          return {
            id: node.id,
            width: size.width,
            height: size.height,
            position: node.position
          };
        }),
        edges: flowEdges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target
        }))
      },
      {
        timeoutMs: AUTO_LAYOUT_TIMEOUT_MS
      }
    );

    if (currentRunId !== latestLayoutRunIdRef.current) {
      return;
    }

    if (!layoutResult.ok) {
      setLayoutBusy(false);
      setLayoutMessageVariant("error");
      if (layoutResult.reason === "timeout") {
        setLayoutMessage("Auto Layout 超时，已保留当前画布位置。");
      } else {
        setLayoutMessage("Auto Layout 执行失败，已保留当前画布位置。");
      }
      return;
    }

    setFlowNodes((previousNodes) => {
      const nextNodes = previousNodes.map((node) => {
        const nextPosition = layoutResult.positions[node.id];
        if (!nextPosition) {
          return node;
        }
        return {
          ...node,
          position: nextPosition
        };
      });
      onNodePositionsChange?.(collectPositionPatchFromFlowNodes(nextNodes));
      return nextNodes;
    });
    setLayoutBusy(false);
    setLayoutMessageVariant("success");
    setLayoutMessage(`Auto Layout 完成（${layoutResult.elapsedMs}ms）。`);

    if (flowInstance) {
      window.requestAnimationFrame(() => {
        flowInstance.fitView({
          padding: 0.22,
          duration: 260
        });
      });
    }
  }, [busy, flowEdges, flowInstance, flowNodes, layoutBusy, onNodePositionsChange]);

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
      const hasPositionChange = changes.some((change) => change.type === "position");
      setFlowNodes((previousNodes) => {
        const nextNodes = applyNodeChanges(changes, previousNodes);
        if (hasPositionChange) {
          onNodePositionsChange?.(collectPositionPatchFromFlowNodes(nextNodes));
        }
        return nextNodes;
      });
    },
    [onNodePositionsChange]
  );

  const handleEdgesChange = useCallback(
    (changes: Array<EdgeChange<Edge<ModelingFlowEdgeData>>>) => {
      setFlowEdges((previousEdges) => applyEdgeChanges(changes, previousEdges));
    },
    []
  );

  const canRenderReactFlow =
    typeof window !== "undefined" && typeof window.ResizeObserver !== "undefined";
  const controlBusy = Boolean(busy || layoutBusy);

  return (
    <section className="space-y-3" data-testid="modeling-flow-canvas">
      {graph.invalidRelationshipCount > 0 ? (
        <StateBlock variant="error">
          检测到 {graph.invalidRelationshipCount} 条 relationship 无法完整映射到 model 节点，已在画布中以异常连线标注，请检查导入表与 graph 数据一致性。
        </StateBlock>
      ) : null}

      <div className="relative h-[620px] overflow-hidden rounded-lg border border-[var(--border-default)] bg-white/95 xl:h-[700px]">
        {flowNodes.length > 0 && !graph.graphBuildError ? (
          <div className="pointer-events-none absolute right-3 top-3 z-10">
            <div className="pointer-events-auto flex items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-white/95 p-1 shadow-sm">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 px-2"
                onClick={() => {
                  void handleAutoLayout();
                }}
                disabled={controlBusy || flowNodes.length < 2}
                aria-label="自动布局画布"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${layoutBusy ? "animate-spin" : ""}`} />
                Auto Layout
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 px-2"
                onClick={handleFitView}
                disabled={controlBusy}
                aria-label="画布适配视图"
              >
                <LocateFixed className="h-3.5 w-3.5" />
                Fit
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 px-2"
                onClick={() => {
                  onSelectNode(null);
                }}
                disabled={controlBusy || !selectedNode}
                aria-label="清除当前选中"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Clear
              </Button>
            </div>
          </div>
        ) : null}
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

      {layoutMessage ? <StateBlock variant={layoutMessageVariant}>{layoutMessage}</StateBlock> : null}

      {flowEdges.length === 0 && flowNodes.length > 0 ? (
        <StateBlock variant="idle">当前无 relationships 连线，可继续在 Relationship Editor 中补充。</StateBlock>
      ) : null}
    </section>
  );
}
