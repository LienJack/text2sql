import { Injectable } from "@nestjs/common";
import { DomainError } from "../../../../common/domain-error";
import type { ModelingGraphPayload, ModelingGraphRelationship } from "./modeling-graph.types";

const nonEmpty = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

@Injectable()
export class ModelingGraphValidator {
  validate(payload: ModelingGraphPayload): ModelingGraphPayload {
    if (!payload || typeof payload !== "object") {
      throw new DomainError("WORKSPACE_MODELING_GRAPH_INVALID", "modeling graph payload 非法。", 400);
    }
    if (!Array.isArray(payload.models)) {
      throw new DomainError("WORKSPACE_MODELING_GRAPH_INVALID", "models 必须是数组。", 400, {
        field: "models"
      });
    }
    if (!Array.isArray(payload.relationships)) {
      throw new DomainError("WORKSPACE_MODELING_GRAPH_INVALID", "relationships 必须是数组。", 400, {
        field: "relationships"
      });
    }
    if (!Array.isArray(payload.calculatedFields)) {
      throw new DomainError(
        "WORKSPACE_MODELING_GRAPH_INVALID",
        "calculatedFields 必须是数组。",
        400,
        {
          field: "calculatedFields"
        }
      );
    }
    if (!Array.isArray(payload.views)) {
      throw new DomainError("WORKSPACE_MODELING_GRAPH_INVALID", "views 必须是数组。", 400, {
        field: "views"
      });
    }
    if (!Array.isArray(payload.schemaChanges)) {
      throw new DomainError(
        "WORKSPACE_MODELING_GRAPH_INVALID",
        "schemaChanges 必须是数组。",
        400,
        {
          field: "schemaChanges"
        }
      );
    }
    this.assertNoDuplicateIds(payload.models.map((item) => item.id), "models");
    this.assertNoDuplicateIds(payload.relationships.map((item) => item.id), "relationships");
    this.assertNoDuplicateIds(payload.views.map((item) => item.id), "views");
    this.assertNoDuplicateIds(payload.calculatedFields.map((item) => item.id), "calculatedFields");
    for (const relationship of payload.relationships) {
      this.assertRelationship(relationship);
    }
    return payload;
  }

  private assertNoDuplicateIds(values: Array<string | undefined>, field: string): void {
    const deduped = new Set<string>();
    for (const value of values) {
      const id = nonEmpty(value);
      if (!id) {
        throw new DomainError("WORKSPACE_MODELING_GRAPH_INVALID", `${field} 包含空 id。`, 400, {
          field
        });
      }
      if (deduped.has(id)) {
        throw new DomainError("WORKSPACE_MODELING_GRAPH_INVALID", `${field} 存在重复 id。`, 400, {
          field,
          id
        });
      }
      deduped.add(id);
    }
  }

  private assertRelationship(relationship: ModelingGraphRelationship): void {
    if (relationship.bridge.operator !== "eq") {
      throw new DomainError(
        "WORKSPACE_MODELING_GRAPH_INVALID",
        "relationship bridge operator 仅支持 eq。",
        400,
        {
          relationshipId: relationship.id
        }
      );
    }
    const leftDataset = nonEmpty(relationship.bridge.left.dataset);
    const leftTable = nonEmpty(relationship.bridge.left.table);
    const leftColumn = nonEmpty(relationship.bridge.left.column);
    const rightDataset = nonEmpty(relationship.bridge.right.dataset);
    const rightTable = nonEmpty(relationship.bridge.right.table);
    const rightColumn = nonEmpty(relationship.bridge.right.column);
    if (
      !leftDataset ||
      !leftTable ||
      !leftColumn ||
      !rightDataset ||
      !rightTable ||
      !rightColumn
    ) {
      throw new DomainError(
        "WORKSPACE_MODELING_GRAPH_INVALID",
        "relationship bridge 端点字段不能为空。",
        400,
        {
          relationshipId: relationship.id
        }
      );
    }
  }
}
