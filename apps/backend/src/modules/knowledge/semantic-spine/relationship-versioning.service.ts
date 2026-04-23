import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { DomainError } from "../../../common/domain-error";
import {
  type RelationshipGraphEdgeDefinition,
  type WorkspaceRelationshipDraft,
  normalizeRelationshipGraphEdge
} from "./relationship-bridge.types";

type RelationshipVersionState = {
  drafts: WorkspaceRelationshipDraft[];
  activeRevision?: number;
};

type DraftKey = string;

@Injectable()
export class RelationshipVersioningService {
  private readonly versionsByScope = new Map<DraftKey, RelationshipVersionState>();

  replaceDraft(input: {
    workspaceId: string;
    datasourceId: string;
    policyVersion: number;
    edges: RelationshipGraphEdgeDefinition[];
    actorId?: string;
  }): WorkspaceRelationshipDraft {
    const workspaceId = this.normalizeId(input.workspaceId, "workspaceId");
    const datasourceId = this.normalizeId(input.datasourceId, "datasourceId");
    if (!Number.isInteger(input.policyVersion) || input.policyVersion < 0) {
      throw new DomainError("VALIDATION_ERROR", "policyVersion 非法。", 400, {
        field: "policyVersion"
      });
    }

    const normalizedEdges = input.edges.map((edge, index) =>
      normalizeRelationshipGraphEdge(edge, index)
    );
    const key = this.toKey(workspaceId, datasourceId);
    const state = this.ensureState(key);
    const revision = (state.drafts.at(-1)?.revision ?? 0) + 1;
    const graphHash = this.computeGraphHash(normalizedEdges);
    const draft: WorkspaceRelationshipDraft = {
      workspaceId,
      datasourceId,
      policyVersion: input.policyVersion,
      revision,
      graphHash,
      edges: normalizedEdges,
      updatedAt: new Date().toISOString(),
      updatedByActorId: input.actorId?.trim() || undefined
    };
    state.drafts.push(draft);
    return this.cloneDraft(draft);
  }

  getDraft(input: {
    workspaceId: string;
    datasourceId: string;
  }): WorkspaceRelationshipDraft | undefined {
    const workspaceId = this.normalizeId(input.workspaceId, "workspaceId");
    const datasourceId = this.normalizeId(input.datasourceId, "datasourceId");
    const state = this.versionsByScope.get(this.toKey(workspaceId, datasourceId));
    return state?.drafts.length ? this.cloneDraft(state.drafts.at(-1)!) : undefined;
  }

  activateDraft(input: {
    workspaceId: string;
    datasourceId: string;
    revision: number;
  }): WorkspaceRelationshipDraft {
    const workspaceId = this.normalizeId(input.workspaceId, "workspaceId");
    const datasourceId = this.normalizeId(input.datasourceId, "datasourceId");
    const key = this.toKey(workspaceId, datasourceId);
    const state = this.ensureState(key);
    const matched = state.drafts.find((item) => item.revision === input.revision);
    if (!matched) {
      throw new DomainError(
        "WORKSPACE_RELATIONSHIP_DRAFT_NOT_FOUND",
        "未找到指定 revision 的 relationship draft。",
        404,
        {
          workspaceId,
          datasourceId,
          revision: input.revision
        }
      );
    }
    state.activeRevision = matched.revision;
    return this.cloneDraft(matched);
  }

  rollbackActive(input: {
    workspaceId: string;
    datasourceId: string;
    targetRevision: number;
  }): WorkspaceRelationshipDraft {
    const workspaceId = this.normalizeId(input.workspaceId, "workspaceId");
    const datasourceId = this.normalizeId(input.datasourceId, "datasourceId");
    const key = this.toKey(workspaceId, datasourceId);
    const state = this.ensureState(key);
    const matched = state.drafts.find((item) => item.revision === input.targetRevision);
    if (!matched) {
      throw new DomainError(
        "WORKSPACE_RELATIONSHIP_REVISION_NOT_FOUND",
        "未找到回滚目标 revision。",
        404,
        {
          workspaceId,
          datasourceId,
          targetRevision: input.targetRevision
        }
      );
    }
    state.activeRevision = matched.revision;
    return this.cloneDraft(matched);
  }

  getActiveDraft(input: {
    workspaceId: string;
    datasourceId: string;
  }): WorkspaceRelationshipDraft | undefined {
    const workspaceId = this.normalizeId(input.workspaceId, "workspaceId");
    const datasourceId = this.normalizeId(input.datasourceId, "datasourceId");
    const state = this.versionsByScope.get(this.toKey(workspaceId, datasourceId));
    if (!state || state.activeRevision === undefined) {
      return undefined;
    }
    const matched = state.drafts.find((item) => item.revision === state.activeRevision);
    return matched ? this.cloneDraft(matched) : undefined;
  }

  private toKey(workspaceId: string, datasourceId: string): DraftKey {
    return `${workspaceId}::${datasourceId}`;
  }

  private ensureState(key: DraftKey): RelationshipVersionState {
    const existed = this.versionsByScope.get(key);
    if (existed) {
      return existed;
    }
    const created: RelationshipVersionState = {
      drafts: []
    };
    this.versionsByScope.set(key, created);
    return created;
  }

  private normalizeId(value: string, field: string): string {
    const normalized = value.trim();
    if (!normalized) {
      throw new DomainError("VALIDATION_ERROR", `${field} 不能为空。`, 400, {
        field
      });
    }
    return normalized;
  }

  private computeGraphHash(edges: RelationshipGraphEdgeDefinition[]): string {
    const normalized = edges
      .map((edge) => ({
        ...edge,
        metadata: edge.metadata ?? null
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
    return createHash("sha256")
      .update(JSON.stringify(normalized))
      .digest("hex");
  }

  private cloneDraft(draft: WorkspaceRelationshipDraft): WorkspaceRelationshipDraft {
    return JSON.parse(JSON.stringify(draft)) as WorkspaceRelationshipDraft;
  }
}
