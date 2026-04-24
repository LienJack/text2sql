import { DomainError } from "../../../common/domain-error";

export type RelationshipOperator = "eq";

export interface RelationshipBridgeEndpoint {
  dataset: string;
  table: string;
  column: string;
}

export interface RelationshipBridgeDefinition {
  left: RelationshipBridgeEndpoint;
  right: RelationshipBridgeEndpoint;
  operator: RelationshipOperator;
  confidence: number;
}

export interface RelationshipGraphEdgeDefinition {
  id: string;
  name?: string;
  bridge: RelationshipBridgeDefinition;
  metadata?: Record<string, unknown>;
}

export interface WorkspaceRelationshipDraft {
  workspaceId: string;
  datasourceId: string;
  policyVersion: number;
  revision: number;
  graphHash: string;
  edges: RelationshipGraphEdgeDefinition[];
  updatedAt: string;
  updatedByActorId?: string;
}

const normalizeRequired = (value: string, field: string): string => {
  const normalized = value.trim();
  if (!normalized) {
    throw new DomainError("VALIDATION_ERROR", `${field} 不能为空。`, 400, {
      field
    });
  }
  return normalized;
};

const normalizeEndpoint = (
  value: RelationshipBridgeEndpoint,
  path: string
): RelationshipBridgeEndpoint => {
  return {
    dataset: normalizeRequired(value.dataset, `${path}.dataset`),
    table: normalizeRequired(value.table, `${path}.table`).toLowerCase(),
    column: normalizeRequired(value.column, `${path}.column`).toLowerCase()
  };
};

const normalizeConfidence = (confidence: number): number => {
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "confidence 必须在 0 到 1 之间。",
      400,
      {
        field: "confidence"
      }
    );
  }
  return Number(confidence.toFixed(4));
};

export const normalizeRelationshipGraphEdge = (
  edge: RelationshipGraphEdgeDefinition,
  index: number
): RelationshipGraphEdgeDefinition => {
  const id = normalizeRequired(edge.id, `edges[${index}].id`);
  const name = edge.name?.trim();
  if (edge.bridge.operator !== "eq") {
    throw new DomainError("VALIDATION_ERROR", "bridge.operator 仅支持 eq。", 400, {
      field: `edges[${index}].bridge.operator`,
      value: edge.bridge.operator
    });
  }
  return {
    id,
    name: name || undefined,
    bridge: {
      left: normalizeEndpoint(edge.bridge.left, `edges[${index}].bridge.left`),
      right: normalizeEndpoint(edge.bridge.right, `edges[${index}].bridge.right`),
      operator: "eq",
      confidence: normalizeConfidence(edge.bridge.confidence)
    },
    metadata: edge.metadata
  };
};
