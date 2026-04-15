import { Injectable } from "@nestjs/common";
import type { Datasource, DatasourceType } from "@text2sql/shared-types";
import { DomainError } from "../../common/domain-error";
import { AuditLogRepository } from "../data/persistence/audit-log.repository";
import { DatasourceRepository } from "../data/persistence/datasource.repository";
import { QueryExecutorRouterService } from "../data/query/query-executor-router.service";
import {
  WorkspaceDatasourcePolicyRepository,
  type DatasourcePolicyEffect,
  type DatasourcePolicySubjectType
} from "../data/persistence/workspace-datasource-policy.repository";
import { WorkspaceRepository } from "../data/persistence/workspace.repository";

type Actor = {
  id: string;
  role: "admin" | "user";
  workspaceRoles?: Record<string, "admin" | "member">;
  isSystemAdmin?: boolean;
};

@Injectable()
export class WorkspaceDatasourceService {
  constructor(
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly datasourceRepository: DatasourceRepository,
    private readonly queryExecutorRouter: QueryExecutorRouterService,
    private readonly policyRepository: WorkspaceDatasourcePolicyRepository,
    private readonly auditLogRepository: AuditLogRepository
  ) {}

  async listBindings(actor: Actor, workspaceId: string): Promise<{
    workspaceId: string;
    items: Array<{
      id: string;
      workspaceId: string;
      datasourceId: string;
      datasourceName?: string;
      datasourceType?: string;
      datasourceStatus?: string;
      createdAt: string;
      updatedAt: string;
    }>;
  }> {
    const normalizedWorkspaceId = workspaceId.trim();
    await this.assertManagePermission(actor, normalizedWorkspaceId);

    const [bindings, datasources] = await Promise.all([
      this.policyRepository.listWorkspaceDatasourceBindings(normalizedWorkspaceId),
      this.datasourceRepository.listDatasources({
        includeDeleted: true
      })
    ]);

    const datasourceMap = new Map(datasources.map((item) => [item.id, item]));
    return {
      workspaceId: normalizedWorkspaceId,
      items: bindings.map((binding) => {
        const datasource = datasourceMap.get(binding.datasourceId);
        return {
          ...binding,
          datasourceName: datasource?.name,
          datasourceType: datasource?.type,
          datasourceStatus: datasource?.status
        };
      })
    };
  }

  async bindDatasources(
    actor: Actor,
    workspaceId: string,
    datasourceIds: string[]
  ): Promise<{
    workspaceId: string;
    successItems: string[];
    failedItems: Array<{ item: string; code: string; message: string }>;
  }> {
    const normalizedWorkspaceId = workspaceId.trim();
    await this.assertManagePermission(actor, normalizedWorkspaceId);
    const normalizedDatasourceIds = this.normalizeIds(datasourceIds);
    const successItems: string[] = [];
    const failedItems: Array<{ item: string; code: string; message: string }> = [];

    for (const datasourceId of normalizedDatasourceIds) {
      const datasource = await this.datasourceRepository.getDatasourceById(datasourceId, {
        includeDeleted: true
      });
      if (!datasource || datasource.status === "deleted") {
        failedItems.push({
          item: datasourceId,
          code: "DATASOURCE_NOT_FOUND",
          message: "数据源不存在或已删除。"
        });
        continue;
      }
      await this.policyRepository.upsertWorkspaceDatasourceBindings([
        {
          workspaceId: normalizedWorkspaceId,
          datasourceId
        }
      ]);
      successItems.push(datasourceId);
    }

    await this.auditLogRepository.appendEvent({
      phase: "governance",
      eventType: "workspace.datasource.binding.updated",
      eventCode: "BINDING_ADD_BATCH",
      severity: failedItems.length > 0 ? "warning" : "info",
      message: "工作空间绑定数据源变更",
      metadata: {
        workspaceId: normalizedWorkspaceId,
        successItems,
        failedItems,
        actorId: actor.id
      }
    });

    return {
      workspaceId: normalizedWorkspaceId,
      successItems,
      failedItems
    };
  }

  async unbindDatasources(
    actor: Actor,
    workspaceId: string,
    datasourceIds: string[]
  ): Promise<{
    workspaceId: string;
    successItems: string[];
    failedItems: Array<{ item: string; code: string; message: string }>;
  }> {
    const normalizedWorkspaceId = workspaceId.trim();
    await this.assertManagePermission(actor, normalizedWorkspaceId);
    const normalizedDatasourceIds = this.normalizeIds(datasourceIds);
    const failedItems: Array<{ item: string; code: string; message: string }> = [];

    const existing = new Set(
      (await this.policyRepository.listWorkspaceDatasourceIds(normalizedWorkspaceId)).map(
        (id) => id
      )
    );
    const toDelete = normalizedDatasourceIds.filter((id) => existing.has(id));
    const missing = normalizedDatasourceIds.filter((id) => !existing.has(id));
    for (const item of missing) {
      failedItems.push({
        item,
        code: "BINDING_NOT_FOUND",
        message: "当前工作空间未绑定该数据源。"
      });
    }

    if (toDelete.length > 0) {
      await this.policyRepository.deleteWorkspaceDatasourceBindings(
        normalizedWorkspaceId,
        toDelete
      );
    }

    await this.auditLogRepository.appendEvent({
      phase: "governance",
      eventType: "workspace.datasource.binding.updated",
      eventCode: "BINDING_REMOVE_BATCH",
      severity: failedItems.length > 0 ? "warning" : "info",
      message: "工作空间解绑数据源变更",
      metadata: {
        workspaceId: normalizedWorkspaceId,
        successItems: toDelete,
        failedItems,
        actorId: actor.id
      }
    });

    return {
      workspaceId: normalizedWorkspaceId,
      successItems: toDelete,
      failedItems
    };
  }

  async listTableAcl(
    actor: Actor,
    workspaceId: string,
    datasourceId: string
  ): Promise<{
    workspaceId: string;
    datasourceId: string;
    items: Array<{
      id: string;
      workspaceId: string;
      datasourceId: string;
      tableName: string;
      subjectType: string;
      subjectId: string;
      effect: string;
      createdAt: string;
      updatedAt: string;
    }>;
  }> {
    const normalizedWorkspaceId = workspaceId.trim();
    const normalizedDatasourceId = datasourceId.trim();
    await this.assertManagePermission(actor, normalizedWorkspaceId);
    await this.assertDatasourceBound(normalizedWorkspaceId, normalizedDatasourceId);

    const rules = await this.policyRepository.listTablePolicyRules({
      workspaceId: normalizedWorkspaceId,
      datasourceId: normalizedDatasourceId
    });
    return {
      workspaceId: normalizedWorkspaceId,
      datasourceId: normalizedDatasourceId,
      items: rules
    };
  }

  async listDatasourceTables(
    actor: Actor,
    workspaceId: string,
    datasourceId: string
  ): Promise<{
    workspaceId: string;
    datasourceId: string;
    items: string[];
  }> {
    const normalizedWorkspaceId = workspaceId.trim();
    const normalizedDatasourceId = datasourceId.trim();
    await this.assertManagePermission(actor, normalizedWorkspaceId);
    await this.assertDatasourceBound(normalizedWorkspaceId, normalizedDatasourceId);

    const datasource = await this.datasourceRepository.getDatasourceById(
      normalizedDatasourceId,
      {
        includeDeleted: true
      }
    );
    if (!datasource || datasource.status === "deleted") {
      throw new DomainError("DATASOURCE_NOT_FOUND", "数据源不存在或已删除。", 404, {
        datasourceId: normalizedDatasourceId
      });
    }

    const queryResult = await this.queryExecutorRouter.execute({
      datasource,
      sql: this.buildTableDiscoverySql(datasource.type),
      limit: 500
    });
    const tableSet = new Set<string>();
    for (const row of queryResult.rows) {
      const tableName = this.readTableName(row);
      if (!tableName) {
        continue;
      }
      tableSet.add(tableName.toLowerCase());
    }

    return {
      workspaceId: normalizedWorkspaceId,
      datasourceId: normalizedDatasourceId,
      items: Array.from(tableSet).sort((a, b) => a.localeCompare(b))
    };
  }

  async replaceTableAcl(
    actor: Actor,
    input: {
      workspaceId: string;
      datasourceId: string;
      subjectType: DatasourcePolicySubjectType;
      subjectId: string;
      effect: DatasourcePolicyEffect;
      tableNames: string[];
      reason?: string;
    }
  ): Promise<{
    workspaceId: string;
    datasourceId: string;
    subjectType: DatasourcePolicySubjectType;
    subjectId: string;
    effect: DatasourcePolicyEffect;
    addedTables: string[];
    removedTables: string[];
    retainedTables: string[];
  }> {
    const workspaceId = input.workspaceId.trim();
    const datasourceId = input.datasourceId.trim();
    await this.assertManagePermission(actor, workspaceId);
    await this.assertDatasourceBound(workspaceId, datasourceId);

    const result = await this.policyRepository.replaceTablePolicyRules({
      workspaceId,
      datasourceId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      effect: input.effect,
      tableNames: input.tableNames
    });

    await this.auditLogRepository.appendEvent({
      phase: "governance",
      eventType: "workspace.datasource.acl.updated",
      eventCode: "ACL_REPLACE_BATCH",
      message: "工作空间数据源表级授权变更",
      metadata: {
        workspaceId,
        datasourceId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        effect: input.effect,
        reason: input.reason,
        ...result,
        actorId: actor.id
      }
    });

    return {
      workspaceId,
      datasourceId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      effect: input.effect,
      ...result
    };
  }

  async removeTableAcl(
    actor: Actor,
    input: {
      workspaceId: string;
      datasourceId: string;
      subjectType: DatasourcePolicySubjectType;
      subjectId: string;
      tableNames: string[];
      effect?: DatasourcePolicyEffect;
    }
  ): Promise<{
    workspaceId: string;
    datasourceId: string;
    removedCount: number;
  }> {
    const workspaceId = input.workspaceId.trim();
    const datasourceId = input.datasourceId.trim();
    await this.assertManagePermission(actor, workspaceId);
    await this.assertDatasourceBound(workspaceId, datasourceId);

    const removedCount = await this.policyRepository.deleteTablePolicyRules({
      workspaceId,
      datasourceId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      tableNames: input.tableNames,
      effect: input.effect
    });

    await this.auditLogRepository.appendEvent({
      phase: "governance",
      eventType: "workspace.datasource.acl.updated",
      eventCode: "ACL_REMOVE_BATCH",
      message: "工作空间数据源表级授权回收",
      metadata: {
        workspaceId,
        datasourceId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        effect: input.effect ?? null,
        tableNames: input.tableNames,
        removedCount,
        actorId: actor.id
      }
    });

    return {
      workspaceId,
      datasourceId,
      removedCount
    };
  }

  private async assertDatasourceBound(
    workspaceId: string,
    datasourceId: string
  ): Promise<void> {
    const bound = await this.policyRepository.isDatasourceBound(workspaceId, datasourceId);
    if (!bound) {
      throw new DomainError(
        "WORKSPACE_DATASOURCE_NOT_BOUND",
        "当前工作空间未绑定该数据源。",
        400,
        {
          workspaceId,
          datasourceId
        }
      );
    }
  }

  private async assertManagePermission(actor: Actor, workspaceId: string): Promise<void> {
    const normalizedWorkspaceId = workspaceId.trim();
    if (!normalizedWorkspaceId) {
      throw new DomainError("VALIDATION_ERROR", "workspaceId 不能为空。", 400, {
        field: "workspaceId"
      });
    }
    const workspace = await this.workspaceRepository.getWorkspaceById(normalizedWorkspaceId);
    if (!workspace || workspace.status === "deleted") {
      throw new DomainError("WORKSPACE_NOT_FOUND", "工作空间不存在", 404, {
        workspaceId: normalizedWorkspaceId
      });
    }
    if (actor.role === "admin" || actor.isSystemAdmin) {
      return;
    }
    if (actor.workspaceRoles?.[normalizedWorkspaceId] === "admin") {
      return;
    }
    const allowed = await this.workspaceRepository.isWorkspaceAdmin(
      actor.id,
      normalizedWorkspaceId
    );
    if (!allowed) {
      throw new DomainError("FORBIDDEN", "仅系统管理员或工作空间管理员可执行该操作。", 403, {
        workspaceId: normalizedWorkspaceId,
        actorId: actor.id
      });
    }
  }

  private normalizeIds(ids: string[]): string[] {
    const deduped = new Set<string>();
    for (const id of ids) {
      const normalized = id.trim();
      if (!normalized) {
        continue;
      }
      deduped.add(normalized);
    }
    if (deduped.size === 0) {
      throw new DomainError("VALIDATION_ERROR", "datasourceIds 不能为空。", 400, {
        field: "datasourceIds"
      });
    }
    return Array.from(deduped);
  }

  private buildTableDiscoverySql(type: DatasourceType): string {
    if (type === "mysql") {
      return `
SELECT table_name AS tableName
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_type = 'BASE TABLE'
ORDER BY table_name
      `.trim();
    }
    if (type === "postgresql") {
      return `
SELECT table_name AS tableName
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name
      `.trim();
    }
    return `
SELECT name AS tableName
FROM sqlite_master
WHERE type = 'table'
  AND name NOT LIKE 'sqlite_%'
ORDER BY name
    `.trim();
  }

  private readTableName(row: Record<string, unknown>): string | null {
    const candidateKeys = ["tableName", "table_name", "name", "TABLE_NAME"];
    for (const key of candidateKeys) {
      const value = row[key];
      if (typeof value !== "string") {
        continue;
      }
      const normalized = value.trim();
      if (normalized) {
        return normalized;
      }
    }
    return null;
  }
}
