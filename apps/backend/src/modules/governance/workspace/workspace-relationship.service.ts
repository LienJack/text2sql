import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { DomainError } from "../../../common/domain-error";
import {
  AuditLogRepository,
  DatasourceRepository,
  WorkspaceDatasourcePolicyRepository,
  WorkspaceRepository
} from "../../platform/data/persistence";
import { RelationshipPublishGateFacade } from "../../platform/data/query";
import type { PublishWorkspaceRelationshipGraphDto } from "./dto/publish-workspace-relationship-graph.dto";
import type { ReplaceWorkspaceRelationshipGraphDto } from "./dto/replace-workspace-relationship-graph.dto";

type Actor = {
  id: string;
  role: "admin" | "user";
  workspaceRoles?: Record<string, "admin" | "member">;
  isSystemAdmin?: boolean;
};

type RelationshipEdgeRecord = {
  id: string;
  name?: string;
  bridge: {
    left: {
      dataset: string;
      table: string;
      column: string;
    };
    right: {
      dataset: string;
      table: string;
      column: string;
    };
    operator: "eq";
    confidence: number;
  };
};

type RelationshipDraftRecord = {
  workspaceId: string;
  datasourceId: string;
  policyVersion: number;
  revision: number;
  graphHash: string;
  edges: RelationshipEdgeRecord[];
  updatedAt: string;
  updatedByActorId: string;
};

type RelationshipScopeState = {
  drafts: RelationshipDraftRecord[];
  activeRevision?: number;
};

const normalizeId = (value: string, field: string): string => {
  const normalized = value.trim();
  if (!normalized) {
    throw new DomainError("VALIDATION_ERROR", `${field} 不能为空。`, 400, {
      field
    });
  }
  return normalized;
};

@Injectable()
export class WorkspaceRelationshipService {
  private readonly state = new Map<string, RelationshipScopeState>();

  constructor(
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly datasourceRepository: DatasourceRepository,
    private readonly policyRepository: WorkspaceDatasourcePolicyRepository,
    private readonly auditLogRepository: AuditLogRepository,
    private readonly publishGateFacade: RelationshipPublishGateFacade
  ) {}

  async getDraft(
    actor: Actor,
    workspaceIdRaw: string,
    datasourceIdRaw: string
  ): Promise<{
    workspaceId: string;
    datasourceId: string;
    draft: RelationshipDraftRecord | null;
    activeRevision?: number;
  }> {
    const workspaceId = normalizeId(workspaceIdRaw, "workspaceId");
    const datasourceId = normalizeId(datasourceIdRaw, "datasourceId");
    await this.assertManagePermission(actor, workspaceId);
    await this.assertDatasourceBound({
      workspaceId,
      datasourceId,
      actorId: actor.id,
      operation: "getDraft"
    });
    await this.assertDatasourceExists(datasourceId);

    const scopeState = this.state.get(this.scopeKey(workspaceId, datasourceId));
    return {
      workspaceId,
      datasourceId,
      draft: scopeState?.drafts.at(-1) ? this.cloneDraft(scopeState.drafts.at(-1)!) : null,
      activeRevision: scopeState?.activeRevision
    };
  }

  async replaceDraft(
    actor: Actor,
    workspaceIdRaw: string,
    datasourceIdRaw: string,
    body: ReplaceWorkspaceRelationshipGraphDto
  ): Promise<{
    workspaceId: string;
    datasourceId: string;
    draft: RelationshipDraftRecord;
  }> {
    const workspaceId = normalizeId(workspaceIdRaw, "workspaceId");
    const datasourceId = normalizeId(datasourceIdRaw, "datasourceId");
    await this.assertManagePermission(actor, workspaceId);
    await this.assertDatasourceBound({
      workspaceId,
      datasourceId,
      actorId: actor.id,
      operation: "replaceDraft"
    });
    await this.assertDatasourceExists(datasourceId);

    const tablePermissionSet = await this.policyRepository.getWorkspaceDatasourceTablePermissionSet({
      workspaceId,
      datasourceId
    });
    if (tablePermissionSet.policyVersion !== body.policyVersion) {
      throw new DomainError(
        "WORKSPACE_DATASOURCE_POLICY_VERSION_CONFLICT",
        "policyVersion 已过期，请刷新后重试。",
        409,
        {
          workspaceId,
          datasourceId,
          expectedPolicyVersion: tablePermissionSet.policyVersion,
          providedPolicyVersion: body.policyVersion
        }
      );
    }

    const normalizedEdges = this.normalizeEdges(body.edges);
    this.assertEdgeTablesAllowed(normalizedEdges, tablePermissionSet.tableNames);

    const state = this.ensureScopeState(workspaceId, datasourceId);
    const revision = (state.drafts.at(-1)?.revision ?? 0) + 1;
    const now = new Date().toISOString();
    const draft: RelationshipDraftRecord = {
      workspaceId,
      datasourceId,
      policyVersion: body.policyVersion,
      revision,
      graphHash: this.computeGraphHash(normalizedEdges),
      edges: normalizedEdges,
      updatedAt: now,
      updatedByActorId: actor.id
    };
    state.drafts.push(draft);

    await this.auditLogRepository.appendEvent({
      phase: "governance",
      eventType: "workspace.relationship.draft.updated",
      eventCode: "WORKSPACE_RELATIONSHIP_DRAFT_REPLACED",
      severity: "info",
      message: "工作空间关系图 draft 已更新",
      metadata: {
        workspaceId,
        datasourceId,
        revision,
        edgeCount: normalizedEdges.length,
        actorId: actor.id
      }
    });

    return {
      workspaceId,
      datasourceId,
      draft: this.cloneDraft(draft)
    };
  }

  async publishPrecheck(
    actor: Actor,
    workspaceIdRaw: string,
    datasourceIdRaw: string,
    body: PublishWorkspaceRelationshipGraphDto
  ): Promise<{
    workspaceId: string;
    datasourceId: string;
    draftRevision: number;
    publish_precheck_passed: boolean;
    blockingReasons: string[];
    policyVersion: number;
  }> {
    const workspaceId = normalizeId(workspaceIdRaw, "workspaceId");
    const datasourceId = normalizeId(datasourceIdRaw, "datasourceId");
    await this.assertManagePermission(actor, workspaceId);
    await this.assertDatasourceBound({
      workspaceId,
      datasourceId,
      actorId: actor.id,
      operation: "publishPrecheck"
    });
    await this.assertDatasourceExists(datasourceId);

    const tablePermissionSet = await this.policyRepository.getWorkspaceDatasourceTablePermissionSet({
      workspaceId,
      datasourceId
    });

    const blockingReasons: string[] = [];
    if (tablePermissionSet.policyVersion !== body.policyVersion) {
      blockingReasons.push("policy_version_conflict");
    }

    const state = this.state.get(this.scopeKey(workspaceId, datasourceId));
    const draft = state?.drafts.find((item) => item.revision === body.draftRevision);
    if (!draft) {
      blockingReasons.push("draft_revision_not_found");
    } else {
      const tableViolations = this.findTableViolations(draft.edges, tablePermissionSet.tableNames);
      if (tableViolations.length > 0) {
        blockingReasons.push("table_permissions_mismatch");
      }
    }

    return {
      workspaceId,
      datasourceId,
      draftRevision: body.draftRevision,
      publish_precheck_passed: blockingReasons.length === 0,
      blockingReasons,
      policyVersion: tablePermissionSet.policyVersion
    };
  }

  async publishDraft(
    actor: Actor,
    workspaceIdRaw: string,
    datasourceIdRaw: string,
    body: PublishWorkspaceRelationshipGraphDto
  ): Promise<{
    workspaceId: string;
    datasourceId: string;
    activeRevision: number;
    graphHash: string;
    publishGatePass: boolean;
    blockingReasons: string[];
  }> {
    const workspaceId = normalizeId(workspaceIdRaw, "workspaceId");
    const datasourceId = normalizeId(datasourceIdRaw, "datasourceId");
    const precheck = await this.publishPrecheck(actor, workspaceId, datasourceId, body);
    if (!precheck.publish_precheck_passed) {
      throw new DomainError(
        "WORKSPACE_RELATIONSHIP_PUBLISH_PRECHECK_FAILED",
        "发布预检失败。",
        409,
        {
          workspaceId,
          datasourceId,
          blockingReasons: precheck.blockingReasons
        }
      );
    }
    const state = this.ensureScopeState(workspaceId, datasourceId);
    const draft = state.drafts.find((item) => item.revision === body.draftRevision);
    if (!draft) {
      throw new DomainError(
        "WORKSPACE_RELATIONSHIP_DRAFT_NOT_FOUND",
        "未找到待发布 revision。",
        404,
        {
          workspaceId,
          datasourceId,
          draftRevision: body.draftRevision
        }
      );
    }

    const tablePermissionSet = await this.policyRepository.getWorkspaceDatasourceTablePermissionSet({
      workspaceId,
      datasourceId
    });
    const gateResult = await this.publishGateFacade.evaluate({
      datasourceId,
      edges: draft.edges,
      representativeSqlSamples: body.representativeSqlSamples ?? [],
      allowedTables: tablePermissionSet.tableNames,
      accessContext: {
        actorId: actor.id,
        workspaceId,
        roleSet: actor.role === "admin" || actor.isSystemAdmin ? ["admin"] : ["member"]
      }
    });
    if (!gateResult.pass) {
      throw new DomainError(
        "WORKSPACE_RELATIONSHIP_PUBLISH_GATE_FAILED",
        "relationship 发布门禁阻断。",
        409,
        {
          workspaceId,
          datasourceId,
          draftRevision: body.draftRevision,
          blockingReasons: gateResult.blockingReasons
        }
      );
    }

    state.activeRevision = draft.revision;
    await this.auditLogRepository.appendEvent({
      phase: "governance",
      eventType: "workspace.relationship.published",
      eventCode: "WORKSPACE_RELATIONSHIP_PUBLISHED",
      severity: "info",
      message: "工作空间关系图发布成功",
      metadata: {
        workspaceId,
        datasourceId,
        activeRevision: state.activeRevision,
        graphHash: draft.graphHash,
        actorId: actor.id
      }
    });

    return {
      workspaceId,
      datasourceId,
      activeRevision: draft.revision,
      graphHash: draft.graphHash,
      publishGatePass: true,
      blockingReasons: []
    };
  }

  async rollbackDraft(
    actor: Actor,
    workspaceIdRaw: string,
    datasourceIdRaw: string,
    body: PublishWorkspaceRelationshipGraphDto
  ): Promise<{
    workspaceId: string;
    datasourceId: string;
    activeRevision: number;
  }> {
    const workspaceId = normalizeId(workspaceIdRaw, "workspaceId");
    const datasourceId = normalizeId(datasourceIdRaw, "datasourceId");
    await this.assertManagePermission(actor, workspaceId);
    await this.assertDatasourceBound({
      workspaceId,
      datasourceId,
      actorId: actor.id,
      operation: "rollbackDraft"
    });
    await this.assertDatasourceExists(datasourceId);
    const targetRevision = body.rollbackToRevision ?? body.draftRevision;
    const state = this.ensureScopeState(workspaceId, datasourceId);
    const matched = state.drafts.find((item) => item.revision === targetRevision);
    if (!matched) {
      throw new DomainError(
        "WORKSPACE_RELATIONSHIP_REVISION_NOT_FOUND",
        "回滚目标 revision 不存在。",
        404,
        {
          workspaceId,
          datasourceId,
          targetRevision
        }
      );
    }
    state.activeRevision = matched.revision;
    await this.auditLogRepository.appendEvent({
      phase: "governance",
      eventType: "workspace.relationship.rollback",
      eventCode: "WORKSPACE_RELATIONSHIP_ROLLBACK",
      severity: "warning",
      message: "工作空间关系图已回滚",
      metadata: {
        workspaceId,
        datasourceId,
        activeRevision: matched.revision,
        actorId: actor.id
      }
    });
    return {
      workspaceId,
      datasourceId,
      activeRevision: matched.revision
    };
  }

  private normalizeEdges(edges: ReplaceWorkspaceRelationshipGraphDto["edges"]): RelationshipEdgeRecord[] {
    return edges.map((edge) => ({
      id: edge.id.trim(),
      name: edge.name?.trim() || undefined,
      bridge: {
        left: {
          dataset: edge.bridge.left.dataset.trim(),
          table: edge.bridge.left.table.trim().toLowerCase(),
          column: edge.bridge.left.column.trim().toLowerCase()
        },
        right: {
          dataset: edge.bridge.right.dataset.trim(),
          table: edge.bridge.right.table.trim().toLowerCase(),
          column: edge.bridge.right.column.trim().toLowerCase()
        },
        operator: "eq",
        confidence: Number(edge.bridge.confidence.toFixed(4))
      }
    }));
  }

  private findTableViolations(edges: RelationshipEdgeRecord[], allowedTables: string[]): string[] {
    const allowed = new Set(allowedTables.map((item) => item.toLowerCase()));
    const violations: string[] = [];
    for (const edge of edges) {
      if (!allowed.has(edge.bridge.left.table)) {
        violations.push(edge.bridge.left.table);
      }
      if (!allowed.has(edge.bridge.right.table)) {
        violations.push(edge.bridge.right.table);
      }
    }
    return Array.from(new Set(violations));
  }

  private assertEdgeTablesAllowed(edges: RelationshipEdgeRecord[], allowedTables: string[]): void {
    const violations = this.findTableViolations(edges, allowedTables);
    if (violations.length === 0) {
      return;
    }
    throw new DomainError(
      "WORKSPACE_RELATIONSHIP_TABLE_PERMISSIONS_FORBIDDEN",
      "关系边包含未授权表。",
      403,
      {
        tables: violations
      }
    );
  }

  private computeGraphHash(edges: RelationshipEdgeRecord[]): string {
    const normalized = edges
      .map((edge) => ({
        ...edge,
        name: edge.name ?? null
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
    return createHash("sha256")
      .update(JSON.stringify(normalized))
      .digest("hex");
  }

  private scopeKey(workspaceId: string, datasourceId: string): string {
    return `${workspaceId}::${datasourceId}`;
  }

  private ensureScopeState(workspaceId: string, datasourceId: string): RelationshipScopeState {
    const key = this.scopeKey(workspaceId, datasourceId);
    const existed = this.state.get(key);
    if (existed) {
      return existed;
    }
    const created: RelationshipScopeState = {
      drafts: []
    };
    this.state.set(key, created);
    return created;
  }

  private cloneDraft(draft: RelationshipDraftRecord): RelationshipDraftRecord {
    return JSON.parse(JSON.stringify(draft)) as RelationshipDraftRecord;
  }

  private async assertDatasourceBound(input: {
    workspaceId: string;
    datasourceId: string;
    actorId: string;
    operation: string;
  }): Promise<void> {
    const bound = await this.policyRepository.isDatasourceBound(
      input.workspaceId,
      input.datasourceId
    );
    if (bound) {
      return;
    }
    await this.auditLogRepository.appendEvent({
      phase: "governance",
      eventType: "workspace.relationship.rejected",
      eventCode: "WORKSPACE_DATASOURCE_NOT_BOUND",
      severity: "warning",
      message: "检测到 relationship API 未绑定数据源访问",
      metadata: {
        workspaceId: input.workspaceId,
        datasourceId: input.datasourceId,
        actorId: input.actorId,
        operation: input.operation
      }
    });
    throw new DomainError(
      "WORKSPACE_DATASOURCE_NOT_BOUND",
      "当前工作空间未绑定该数据源。",
      400,
      {
        workspaceId: input.workspaceId,
        datasourceId: input.datasourceId
      }
    );
  }

  private async assertDatasourceExists(datasourceId: string): Promise<void> {
    const datasource = await this.datasourceRepository.getDatasourceById(datasourceId, {
      includeDeleted: true
    });
    if (!datasource || datasource.status === "deleted") {
      throw new DomainError("DATASOURCE_NOT_FOUND", "数据源不存在或已删除。", 404, {
        datasourceId
      });
    }
  }

  private async assertManagePermission(actor: Actor, workspaceId: string): Promise<void> {
    const workspace = await this.workspaceRepository.getWorkspaceById(workspaceId);
    if (!workspace || workspace.status === "deleted") {
      throw new DomainError("WORKSPACE_NOT_FOUND", "工作空间不存在", 404, {
        workspaceId
      });
    }
    if (actor.role === "admin" || actor.isSystemAdmin) {
      return;
    }
    if (actor.workspaceRoles?.[workspaceId] === "admin") {
      return;
    }
    const allowed = await this.workspaceRepository.isWorkspaceAdmin(actor.id, workspaceId);
    if (!allowed) {
      throw new DomainError("FORBIDDEN", "仅系统管理员或工作空间管理员可执行该操作。", 403, {
        workspaceId,
        actorId: actor.id
      });
    }
  }
}
