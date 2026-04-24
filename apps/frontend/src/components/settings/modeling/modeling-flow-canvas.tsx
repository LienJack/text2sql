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
  type ModelingFlowNodeAction,
  type ModelingFlowColumnDisplayMeta,
  type ModelingFlowNodeData,
  type ModelingFlowRelationshipDisplayMeta,
  createModelingFlowFieldHandleId,
  createModelingFlowRelationshipHandleId,
  resolveModelingFlowFallbackHandleId
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
const MODELING_NODE_MAX_COLUMN_PREVIEW = 5;

type ModelingFlowNodePosition = {
  x: number;
  y: number;
};

type ModelingFlowPositionPatch = {
  models: Record<string, ModelingFlowNodePosition>;
  views: Record<string, ModelingFlowNodePosition>;
};

type ModelingFlowHandleSide = "left" | "right";

type ModelingFlowHandleBySide = {
  left: string;
  right: string;
};

type ModelingFlowEdgeHandleSides = {
  source: ModelingFlowHandleSide;
  target: ModelingFlowHandleSide;
};

export type ModelingFlowNodeActionEvent = {
  modelId: string;
  action: ModelingFlowNodeAction;
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

function normalizeColumnKey(columnName: string): string {
  return columnName.trim().toLowerCase();
}

function normalizeNodeSectionEntries(items: unknown): string[] {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function resolveNodeSectionEntries(preferredItems: unknown, fallbackItems: string[]): string[] {
  if (Array.isArray(preferredItems)) {
    return normalizeNodeSectionEntries(preferredItems);
  }
  return fallbackItems;
}

function prioritizeModelColumnsForPreview(
  preferredColumns: string[],
  fallbackColumns: string[],
  columnMetaByName: Map<string, ModelingFlowColumnDisplayMeta>,
  relationshipColumnKeys?: Set<string>
): string[] {
  const orderedColumns: string[] = [];
  const seenColumnKeys = new Set<string>();
  for (const columnName of [...preferredColumns, ...fallbackColumns]) {
    const columnKey = normalizeColumnKey(columnName);
    if (!columnKey || seenColumnKeys.has(columnKey)) {
      continue;
    }
    seenColumnKeys.add(columnKey);
    orderedColumns.push(columnName);
  }

  if (orderedColumns.length <= MODELING_NODE_MAX_COLUMN_PREVIEW) {
    return orderedColumns;
  }

  const primaryKeyColumns: string[] = [];
  const relationshipColumns: string[] = [];
  const otherColumns: string[] = [];
  for (const columnName of orderedColumns) {
    const columnKey = normalizeColumnKey(columnName);
    const columnMeta = columnMetaByName.get(columnKey);
    if (columnMeta?.isPrimaryKey) {
      primaryKeyColumns.push(columnName);
      continue;
    }
    if (relationshipColumnKeys?.has(columnKey)) {
      relationshipColumns.push(columnName);
      continue;
    }
    otherColumns.push(columnName);
  }
  return [...primaryKeyColumns, ...relationshipColumns, ...otherColumns].slice(
    0,
    MODELING_NODE_MAX_COLUMN_PREVIEW
  );
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

function resolveRelationshipCounterpartTable(
  modelTableName: string,
  relationship: ModelingGraphPayload["relationships"][number]
): string {
  const modelTableKey = normalizeTableKey(modelTableName);
  const leftTable = relationship.bridge?.left?.table?.trim() ?? "";
  const rightTable = relationship.bridge?.right?.table?.trim() ?? "";
  const leftTableKey = normalizeTableKey(leftTable);
  const rightTableKey = normalizeTableKey(rightTable);

  if (!modelTableKey) {
    return "-";
  }
  if (leftTableKey === modelTableKey && rightTableKey === modelTableKey) {
    return rightTable || leftTable || "-";
  }
  if (leftTableKey === modelTableKey) {
    return rightTable || "-";
  }
  if (rightTableKey === modelTableKey) {
    return leftTable || "-";
  }
  return "-";
}

function resolveRelationshipDisplayMeta(
  modelTableName: string,
  relationshipRef: string,
  relationshipById: Map<string, ModelingGraphPayload["relationships"][number]>
): ModelingFlowRelationshipDisplayMeta | null {
  const relationship = relationshipById.get(relationshipRef);
  if (!relationship) {
    return null;
  }
  const primaryText = resolveRelationshipCounterpartTable(modelTableName, relationship);
  const secondaryText = relationship.name?.trim() || undefined;
  return {
    primaryText,
    secondaryText,
    title: secondaryText ? `${primaryText} (${secondaryText})` : primaryText
  };
}

function relationshipTouchesModelTable(
  modelTableName: string,
  relationship: ModelingGraphPayload["relationships"][number]
): boolean {
  const modelTableKey = normalizeTableKey(modelTableName);
  if (!modelTableKey) {
    return false;
  }
  const leftTableKey = normalizeTableKey(relationship.bridge?.left?.table ?? "");
  const rightTableKey = normalizeTableKey(relationship.bridge?.right?.table ?? "");
  return leftTableKey === modelTableKey || rightTableKey === modelTableKey;
}

function resolveRelationshipActionId(params: {
  modelTableName: string;
  relationshipRef: string;
  candidateRelationshipIds: string[];
  usedRelationshipIds: Set<string>;
  relationshipById: Map<string, ModelingGraphPayload["relationships"][number]>;
  relationshipIdByName: Map<string, string>;
}): string | null {
  const {
    modelTableName,
    relationshipRef,
    candidateRelationshipIds,
    usedRelationshipIds,
    relationshipById,
    relationshipIdByName
  } = params;
  const normalizedRef = relationshipRef.trim();
  if (!normalizedRef) {
    return null;
  }
  if (relationshipById.has(normalizedRef)) {
    const relationshipByExactId = relationshipById.get(normalizedRef);
    if (
      relationshipByExactId &&
      relationshipTouchesModelTable(modelTableName, relationshipByExactId) &&
      !usedRelationshipIds.has(normalizedRef)
    ) {
      return normalizedRef;
    }
  }
  const normalizedRefKey = normalizeTableKey(normalizedRef);
  if (!normalizedRefKey) {
    return null;
  }
  for (const candidateRelationshipId of candidateRelationshipIds) {
    if (usedRelationshipIds.has(candidateRelationshipId)) {
      continue;
    }
    const candidateRelationship = relationshipById.get(candidateRelationshipId);
    if (!candidateRelationship) {
      continue;
    }
    const candidateNameKey = normalizeTableKey(candidateRelationship.name?.trim() ?? "");
    if (candidateNameKey && candidateNameKey === normalizedRefKey) {
      return candidateRelationshipId;
    }
  }
  for (const candidateRelationshipId of candidateRelationshipIds) {
    if (usedRelationshipIds.has(candidateRelationshipId)) {
      continue;
    }
    const candidateRelationship = relationshipById.get(candidateRelationshipId);
    if (!candidateRelationship) {
      continue;
    }
    const counterpartTable = resolveRelationshipCounterpartTable(modelTableName, candidateRelationship);
    if (normalizeTableKey(counterpartTable) === normalizedRefKey) {
      return candidateRelationshipId;
    }
  }
  const relationshipIdByNameRef = relationshipIdByName.get(normalizedRefKey);
  if (
    relationshipIdByNameRef &&
    candidateRelationshipIds.includes(relationshipIdByNameRef) &&
    !usedRelationshipIds.has(relationshipIdByNameRef)
  ) {
    return relationshipIdByNameRef;
  }
  return null;
}

function resolvePreferredEdgeHandleSides(
  sourcePosition: ModelingFlowNodePosition | undefined,
  targetPosition: ModelingFlowNodePosition | undefined
): ModelingFlowEdgeHandleSides {
  if (!sourcePosition || !targetPosition) {
    return {
      source: "right",
      target: "left"
    };
  }
  const xDistance = sourcePosition.x - targetPosition.x;
  if (Math.abs(xDistance) <= 1) {
    return {
      source: "left",
      target: "left"
    };
  }
  if (xDistance > 0) {
    return {
      source: "left",
      target: "right"
    };
  }
  return {
    source: "right",
    target: "left"
  };
}

function resolveRelationshipActionIdsForSection(params: {
  modelTableName: string;
  relationshipRefs: string[];
  fallbackRelationshipRefs: string[];
  relationshipById: Map<string, ModelingGraphPayload["relationships"][number]>;
  relationshipIdByName: Map<string, string>;
}): Array<string | null> {
  const {
    modelTableName,
    relationshipRefs,
    fallbackRelationshipRefs,
    relationshipById,
    relationshipIdByName
  } = params;
  const candidateFallbackIds: string[] = [];
  const seenRelationshipIds = new Set<string>();
  for (const item of fallbackRelationshipRefs.map((entry) => entry.trim())) {
    if (!item || !relationshipById.has(item) || seenRelationshipIds.has(item)) {
      continue;
    }
    seenRelationshipIds.add(item);
    candidateFallbackIds.push(item);
  }
  const usedRelationshipIds = new Set<string>();

  return relationshipRefs.map((relationshipRef) => {
    const resolvedByRef = resolveRelationshipActionId({
      modelTableName,
      relationshipRef,
      candidateRelationshipIds: candidateFallbackIds,
      usedRelationshipIds,
      relationshipById,
      relationshipIdByName
    });
    if (resolvedByRef) {
      usedRelationshipIds.add(resolvedByRef);
      return resolvedByRef;
    }

    const normalizedRelationshipRef = normalizeTableKey(relationshipRef);
    if (normalizedRelationshipRef) {
      for (const candidateRelationshipId of candidateFallbackIds) {
        if (usedRelationshipIds.has(candidateRelationshipId)) {
          continue;
        }
        const candidateRelationship = relationshipById.get(candidateRelationshipId);
        if (!candidateRelationship) {
          continue;
        }
        const counterpartTable = resolveRelationshipCounterpartTable(
          modelTableName,
          candidateRelationship
        );
        if (normalizeTableKey(counterpartTable) === normalizedRelationshipRef) {
          usedRelationshipIds.add(candidateRelationshipId);
          return candidateRelationshipId;
        }
      }
    }

    const nextUnusedFallbackRelationshipId = candidateFallbackIds.find(
      (candidateRelationshipId) => !usedRelationshipIds.has(candidateRelationshipId)
    );
    if (nextUnusedFallbackRelationshipId) {
      usedRelationshipIds.add(nextUnusedFallbackRelationshipId);
      return nextUnusedFallbackRelationshipId;
    }
    return null;
  });
}

function estimateLayoutNodeSize(node: Node<ModelingFlowNodeData>): { width: number; height: number } {
  if (node.data.kind === "view") {
    return {
      width: 240,
      height: 90
    };
  }
  const columnsCount = node.data.sections?.columns.length ?? 0;
  const calculatedFieldsCount = node.data.sections?.calculatedFields.length ?? 0;
  const relationshipsCount = node.data.sections?.relationships.length ?? 0;
  const sectionCount = [columnsCount, calculatedFieldsCount, relationshipsCount].filter(
    (count) => count > 0
  ).length;
  return {
    width: 280,
    height:
      136 +
      columnsCount * 22 +
      calculatedFieldsCount * 20 +
      relationshipsCount * 20 +
      sectionCount * 14
  };
}

type ModelingFlowHandleLookup = {
  relationshipHandleByTable: Map<string, Map<string, ModelingFlowHandleBySide>>;
  fieldHandleByTable: Map<string, Map<string, ModelingFlowHandleBySide>>;
};

function recalculateEdgeHandleSides(
  edges: Array<Edge<ModelingFlowEdgeData>>,
  nodePositionById: Map<string, ModelingFlowNodePosition>,
  handleLookup: ModelingFlowHandleLookup
): Array<Edge<ModelingFlowEdgeData>> {
  return edges.map((edge) => {
    const edgeData = edge.data;
    if (!edgeData?.from?.table || !edgeData?.to?.table) {
      return edge;
    }
    const sourcePosition = nodePositionById.get(edge.source);
    const targetPosition = nodePositionById.get(edge.target);
    const preferredSides = resolvePreferredEdgeHandleSides(sourcePosition, targetPosition);
    const sourceTableKey = normalizeTableKey(edgeData.from.table);
    const targetTableKey = normalizeTableKey(edgeData.to.table);
    const sourceColumnKey = edgeData.from.column ? normalizeColumnKey(edgeData.from.column) : "";
    const targetColumnKey = edgeData.to.column ? normalizeColumnKey(edgeData.to.column) : "";
    const nextSourceHandle =
      handleLookup.relationshipHandleByTable
        .get(sourceTableKey)
        ?.get(edge.id)?.[preferredSides.source] ??
      handleLookup.fieldHandleByTable
        .get(sourceTableKey)
        ?.get(sourceColumnKey)
        ?.[preferredSides.source] ??
      resolveModelingFlowFallbackHandleId("source", preferredSides.source);
    const nextTargetHandle =
      handleLookup.relationshipHandleByTable
        .get(targetTableKey)
        ?.get(edge.id)?.[preferredSides.target] ??
      handleLookup.fieldHandleByTable
        .get(targetTableKey)
        ?.get(targetColumnKey)
        ?.[preferredSides.target] ??
      resolveModelingFlowFallbackHandleId("target", preferredSides.target);
    if (edge.sourceHandle === nextSourceHandle && edge.targetHandle === nextTargetHandle) {
      return edge;
    }
    return {
      ...edge,
      sourceHandle: nextSourceHandle,
      targetHandle: nextTargetHandle
    };
  });
}

function buildGraph(
  graphPayload: ModelingGraphPayload,
  onNodeAction?: (event: ModelingFlowNodeActionEvent) => void
): {
  nodes: Array<Node<ModelingFlowNodeData>>;
  edges: Array<Edge<ModelingFlowEdgeData>>;
  invalidRelationshipCount: number;
  handleLookup: ModelingFlowHandleLookup;
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
  const relationshipColumnKeysByTable = new Map<string, Set<string>>();
  const relationshipById = new Map<string, ModelingGraphPayload["relationships"][number]>();
  const relationshipIdByName = new Map<string, string>();
  const relationshipHandleByTable = new Map<
    string,
    Map<string, ModelingFlowHandleBySide>
  >();
  const fieldHandleByTable = new Map<string, Map<string, ModelingFlowHandleBySide>>();

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
    if (!relationshipById.has(relationshipId)) {
      relationshipById.set(relationshipId, relationship);
    }
    const relationshipName = relationship.name?.trim();
    if (relationshipName) {
      const normalizedName = relationshipName.toLowerCase();
      if (!relationshipIdByName.has(normalizedName)) {
        relationshipIdByName.set(normalizedName, relationshipId);
      }
    }
    const leftTable = relationship.bridge?.left?.table;
    const rightTable = relationship.bridge?.right?.table;
    const leftColumn = relationship.bridge?.left?.column;
    const rightColumn = relationship.bridge?.right?.column;
    const leftTableKey = typeof leftTable === "string" ? normalizeTableKey(leftTable) : "";
    const rightTableKey = typeof rightTable === "string" ? normalizeTableKey(rightTable) : "";
    const isSelfReferential = leftTableKey && rightTableKey && leftTableKey === rightTableKey;
    const endpointTables = isSelfReferential ? [leftTable] : [leftTable, rightTable];
    for (const tableName of endpointTables) {
      const tableKey = typeof tableName === "string" ? normalizeTableKey(tableName) : "";
      if (!tableKey) {
        continue;
      }
      const existing = relationshipIdsByTable.get(tableKey) ?? [];
      existing.push(relationshipId);
      relationshipIdsByTable.set(tableKey, existing);
    }
    for (const endpoint of [
      { table: leftTable, column: leftColumn },
      { table: rightTable, column: rightColumn }
    ]) {
      const tableKey = typeof endpoint.table === "string" ? normalizeTableKey(endpoint.table) : "";
      const columnKey = typeof endpoint.column === "string" ? normalizeColumnKey(endpoint.column) : "";
      if (!tableKey || !columnKey) {
        continue;
      }
      const existingColumnKeys = relationshipColumnKeysByTable.get(tableKey) ?? new Set<string>();
      existingColumnKeys.add(columnKey);
      relationshipColumnKeysByTable.set(tableKey, existingColumnKeys);
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
    const fallbackColumns = normalizeNodeSectionEntries(
      Array.isArray(model.columns) ? model.columns.map((column) => column.name) : []
    );
    const columnMetaByName = new Map<string, ModelingFlowColumnDisplayMeta>();
    for (const column of model.columns ?? []) {
      const columnName = column.name?.trim() ?? "";
      if (!columnName) {
        continue;
      }
      const columnKey = columnName.trim().toLowerCase();
      if (!columnMetaByName.has(columnKey)) {
        columnMetaByName.set(columnKey, {
          dataType: column.dataType,
          isPrimaryKey: column.isPrimaryKey
        });
      }
    }
    const fallbackCalculatedFields = normalizeNodeSectionEntries(
      calculatedFieldNamesByModelId.get(model.id) ?? []
    );
    const fallbackRelationships = normalizeNodeSectionEntries(
      relationshipIdsByTable.get(tableKey) ?? []
    );
    const rawColumns = resolveNodeSectionEntries(model.nodeSections?.columns, fallbackColumns);
    const sections = {
      columns: prioritizeModelColumnsForPreview(
        rawColumns,
        fallbackColumns,
        columnMetaByName,
        relationshipColumnKeysByTable.get(tableKey)
      ),
      calculatedFields: resolveNodeSectionEntries(
        model.nodeSections?.calculatedFields,
        fallbackCalculatedFields
      ),
      relationships: resolveNodeSectionEntries(
        model.nodeSections?.relationships,
        fallbackRelationships
      )
    };
    const relationshipDisplayMeta = sections.relationships.map((relationshipRef) => {
      const derivedMeta = resolveRelationshipDisplayMeta(
        model.tableName,
        relationshipRef,
        relationshipById
      );
      if (derivedMeta) {
        return derivedMeta;
      }
      return {
        primaryText: relationshipRef,
        title: relationshipRef
      } satisfies ModelingFlowRelationshipDisplayMeta;
    });
    const relationshipActionIds = resolveRelationshipActionIdsForSection({
      modelTableName: model.tableName,
      relationshipRefs: sections.relationships,
      fallbackRelationshipRefs: fallbackRelationships,
      relationshipById,
      relationshipIdByName
    });
    const relationshipHandleById = new Map<string, ModelingFlowHandleBySide>();
    for (const relationshipActionId of relationshipActionIds) {
      if (!relationshipActionId) {
        continue;
      }
      if (!relationshipHandleById.has(relationshipActionId)) {
        relationshipHandleById.set(relationshipActionId, {
          left: createModelingFlowRelationshipHandleId(relationshipActionId, "left"),
          right: createModelingFlowRelationshipHandleId(relationshipActionId, "right")
        });
      }
    }
    if (tableKey) {
      const fieldHandleByColumn = new Map<string, ModelingFlowHandleBySide>();
      for (const columnName of sections.columns) {
        const columnKey = normalizeColumnKey(columnName);
        if (!columnKey || fieldHandleByColumn.has(columnKey)) {
          continue;
        }
        fieldHandleByColumn.set(columnKey, {
          left: createModelingFlowFieldHandleId(columnName, "left"),
          right: createModelingFlowFieldHandleId(columnName, "right")
        });
      }
      fieldHandleByTable.set(tableKey, fieldHandleByColumn);

      const existingHandleMap = relationshipHandleByTable.get(tableKey);
      if (existingHandleMap) {
        for (const [relationshipId, handles] of relationshipHandleById.entries()) {
          if (!existingHandleMap.has(relationshipId)) {
            existingHandleMap.set(relationshipId, handles);
          }
        }
      } else {
        relationshipHandleByTable.set(tableKey, relationshipHandleById);
      }
    }
    const columnDisplayMeta = sections.columns.map((columnName) => {
      return (
        columnMetaByName.get(columnName.trim().toLowerCase()) ?? {
          dataType: undefined,
          isPrimaryKey: false
        }
      );
    });
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
        columnCount: rawColumns.length,
        sections,
        columnDisplayMeta,
        relationshipDisplayMeta,
        relationshipActionIds,
        onNodeAction: onNodeAction
          ? (action) => {
              onNodeAction({
                modelId: model.id,
                action
              });
            }
          : undefined
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
  const nodePositionByFlowNodeId = new Map<string, ModelingFlowNodePosition>(
    modelNodes.map((node) => [node.id, node.position])
  );

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
    const preferredHandleSides = resolvePreferredEdgeHandleSides(
      sourceNodeId ? nodePositionByFlowNodeId.get(sourceNodeId) : undefined,
      targetNodeId ? nodePositionByFlowNodeId.get(targetNodeId) : undefined
    );
    const relationshipId = relationship.id || `relationship:${index}`;
    const sourceHandleId =
      relationshipHandleByTable
        .get(normalizeTableKey(leftEndpoint.table))
        ?.get(relationshipId)?.[preferredHandleSides.source] ??
      fieldHandleByTable
        .get(normalizeTableKey(leftEndpoint.table))
        ?.get(normalizeColumnKey(leftEndpoint.column))
        ?.[preferredHandleSides.source] ??
      resolveModelingFlowFallbackHandleId("source", preferredHandleSides.source);
    const targetHandleId =
      relationshipHandleByTable
        .get(normalizeTableKey(rightEndpoint.table))
        ?.get(relationshipId)?.[preferredHandleSides.target] ??
      fieldHandleByTable
        .get(normalizeTableKey(rightEndpoint.table))
        ?.get(normalizeColumnKey(rightEndpoint.column))
        ?.[preferredHandleSides.target] ??
      resolveModelingFlowFallbackHandleId("target", preferredHandleSides.target);
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
        from: {
          dataset: leftEndpoint.dataset,
          table: leftEndpoint.table,
          column: leftEndpoint.column
        },
        to: {
          dataset: rightEndpoint.dataset,
          table: rightEndpoint.table,
          column: rightEndpoint.column
        },
        description: relationship.name?.trim() || "-",
        invalid: true
      };
      return [
        {
          id: relationshipId,
          source: sourceNodeId ?? fallbackNodeId,
          target: targetNodeId ?? fallbackNodeId,
          sourceHandle: sourceHandleId,
          targetHandle: targetHandleId,
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
      from: {
        dataset: leftEndpoint.dataset,
        table: leftEndpoint.table,
        column: leftEndpoint.column
      },
      to: {
        dataset: rightEndpoint.dataset,
        table: rightEndpoint.table,
        column: rightEndpoint.column
      },
      description: relationship.name?.trim() || "-",
      invalid: false
    };
    return [
      {
        id: relationshipId,
        source: sourceNodeId,
        target: targetNodeId,
        sourceHandle: sourceHandleId,
        targetHandle: targetHandleId,
        type: MODELING_FLOW_EDGE_TYPE,
        animated: relationship.source === "inferred",
        data: edgeData
      }
    ];
  });

  return {
    nodes: [...modelNodes, ...viewNodes],
    edges,
    invalidRelationshipCount,
    handleLookup: {
      relationshipHandleByTable,
      fieldHandleByTable
    }
  };
}

export function ModelingFlowCanvas(props: {
  graphPayload: ModelingGraphPayload;
  selectedNode: ModelingSidebarNode | null;
  busy?: boolean;
  autoLayoutKey: string;
  onSelectNode: (node: ModelingSidebarNode | null) => void;
  onNodeAction?: (event: ModelingFlowNodeActionEvent) => void;
  onNodePositionsChange?: (patch: ModelingFlowPositionPatch) => void;
}) {
  const {
    graphPayload,
    selectedNode,
    busy,
    autoLayoutKey,
    onSelectNode,
    onNodeAction,
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
        ...buildGraph(graphPayload, onNodeAction),
        graphBuildError: ""
      };
    } catch (error) {
      return {
        nodes: [],
        edges: [],
        invalidRelationshipCount: 0,
        handleLookup: {
          relationshipHandleByTable: new Map(),
          fieldHandleByTable: new Map()
        } satisfies ModelingFlowHandleLookup,
        graphBuildError:
          error instanceof Error ? error.message : "graph payload 映射失败，请检查数据结构。"
      };
    }
  }, [graphPayload, onNodeAction]);
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
      const nextNodes = graph.nodes.map((node) => ({
        ...node,
        selected: node.id === selectedFlowNodeId,
        position:
          persistedPositionByNodeId.get(node.id) ?? previousPositionById.get(node.id) ?? node.position
      }));
      return nextNodes;
    });
    setFlowEdges(
      graph.edges.map((edge) => ({
        ...edge,
        selected: edge.id === selectedRelationshipId
      }))
    );
  }, [graph, persistedPositionByNodeId, selectedFlowNodeId, selectedRelationshipId]);

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
    const nextPositionById = new Map<string, ModelingFlowNodePosition>();
    for (const [nodeId, pos] of Object.entries(layoutResult.positions)) {
      nextPositionById.set(nodeId, pos);
    }
    setFlowEdges((previousEdges) =>
      recalculateEdgeHandleSides(previousEdges, nextPositionById, graph.handleLookup)
    );
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
  }, [busy, flowEdges, flowInstance, flowNodes, graph.handleLookup, layoutBusy, onNodePositionsChange]);

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
      const hasCommittedPositionChange = changes.some((change) => {
        if (change.type !== "position") {
          return false;
        }
        const positionChange = change as Extract<
          NodeChange<Node<ModelingFlowNodeData>>,
          { type: "position" }
        >;
        if (typeof positionChange.dragging === "boolean") {
          return positionChange.dragging === false;
        }
        return true;
      });
      setFlowNodes((previousNodes) => {
        const nextNodes = applyNodeChanges(changes, previousNodes);
        if (hasPositionChange && hasCommittedPositionChange) {
          onNodePositionsChange?.(collectPositionPatchFromFlowNodes(nextNodes));
          const nextPositionById = new Map<string, ModelingFlowNodePosition>(
            nextNodes.map((node) => [node.id, node.position])
          );
          setFlowEdges((previousEdges) =>
            recalculateEdgeHandleSides(previousEdges, nextPositionById, graph.handleLookup)
          );
        }
        return nextNodes;
      });
    },
    [graph.handleLookup, onNodePositionsChange]
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
