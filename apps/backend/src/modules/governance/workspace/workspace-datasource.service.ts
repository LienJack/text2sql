import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Datasource, DatasourceType } from "@text2sql/shared-types";
import { DomainError } from "../../../common/domain-error";
import { AuditLogRepository } from "../../data/persistence/audit-log.repository";
import { DatasourceRepository } from "../../data/persistence/datasource.repository";
import { QueryExecutorRouterService } from "../../data/query/query-executor-router.service";
import { WorkspaceDatasourcePolicyRepository } from "../../data/persistence/workspace-datasource-policy.repository";
import { WorkspaceRepository } from "../../data/persistence/workspace.repository";

type Actor = {
  id: string;
  role: "admin" | "user";
  workspaceRoles?: Record<string, "admin" | "member">;
  isSystemAdmin?: boolean;
};

type ReplaceTablePermissionIdempotencyRecord = {
  payloadHash: string;
  response: {
    workspaceId: string;
    datasourceId: string;
    policyVersion: number;
    tableNames: string[];
    impactSummary: {
      beforeCount: number;
      afterCount: number;
      addedCount: number;
      removedCount: number;
      retainedCount: number;
      addedTables: string[];
      removedTables: string[];
    };
    idempotencyKey: string;
    replayed: boolean;
  };
  expiresAt: number;
};

const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class WorkspaceDatasourceService {
  private readonly replaceTablePermissionIdempotencyStore = new Map<
    string,
    ReplaceTablePermissionIdempotencyRecord
  >();

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
    await this.assertDatasourceBound({
      workspaceId: normalizedWorkspaceId,
      datasourceId: normalizedDatasourceId,
      actorId: actor.id,
      operation: "listDatasourceTables"
    });

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

  async listDatasourceTablePermissions(
    actor: Actor,
    workspaceId: string,
    datasourceId: string,
    options?: {
      keyword?: string;
    }
  ): Promise<{
    workspaceId: string;
    datasourceId: string;
    policyVersion: number;
    tableNames: string[];
  }> {
    const normalizedWorkspaceId = workspaceId.trim();
    const normalizedDatasourceId = datasourceId.trim();
    await this.assertManagePermission(actor, normalizedWorkspaceId);
    await this.assertDatasourceBound({
      workspaceId: normalizedWorkspaceId,
      datasourceId: normalizedDatasourceId,
      actorId: actor.id,
      operation: "listDatasourceTablePermissions"
    });
    await this.assertDatasourceExists(normalizedDatasourceId);

    const state = await this.policyRepository.getWorkspaceDatasourceTablePermissionSet({
      workspaceId: normalizedWorkspaceId,
      datasourceId: normalizedDatasourceId
    });

    const keyword = options?.keyword?.trim().toLowerCase();
    const tableNames = keyword
      ? state.tableNames.filter((tableName) => tableName.includes(keyword))
      : state.tableNames;

    return {
      workspaceId: normalizedWorkspaceId,
      datasourceId: normalizedDatasourceId,
      policyVersion: state.policyVersion,
      tableNames
    };
  }

  async replaceDatasourceTablePermissions(
    actor: Actor,
    workspaceId: string,
    datasourceId: string,
    body: {
      policyVersion: number;
      tableNames: string[];
    },
    idempotencyKeyRaw: string | undefined,
    requestId?: string
  ): Promise<{
    workspaceId: string;
    datasourceId: string;
    policyVersion: number;
    tableNames: string[];
    impactSummary: {
      beforeCount: number;
      afterCount: number;
      addedCount: number;
      removedCount: number;
      retainedCount: number;
      addedTables: string[];
      removedTables: string[];
    };
    idempotencyKey: string;
    replayed: boolean;
  }> {
    const normalizedWorkspaceId = workspaceId.trim();
    const normalizedDatasourceId = datasourceId.trim();
    await this.assertManagePermission(actor, normalizedWorkspaceId);
    await this.assertDatasourceBound({
      workspaceId: normalizedWorkspaceId,
      datasourceId: normalizedDatasourceId,
      actorId: actor.id,
      requestId,
      operation: "replaceDatasourceTablePermissions"
    });
    await this.assertDatasourceExists(normalizedDatasourceId);

    const idempotencyKey = this.normalizeRequiredIdempotencyKey(idempotencyKeyRaw);
    const normalizedTableNames = this.normalizeTableNames(body.tableNames);
    const payloadHash = this.hashReplacePayload({
      policyVersion: body.policyVersion,
      tableNames: normalizedTableNames
    });
    const idempotencyScope = this.buildTablePermissionIdempotencyScope({
      actorId: actor.id,
      workspaceId: normalizedWorkspaceId,
      datasourceId: normalizedDatasourceId,
      method: "PUT",
      idempotencyKey
    });

    this.pruneReplaceIdempotencyStore();
    const replayed = this.readReplaceIdempotencyRecord({
      scope: idempotencyScope,
      payloadHash
    });
    if (replayed) {
      return replayed;
    }

    const current = await this.policyRepository.getWorkspaceDatasourceTablePermissionSet({
      workspaceId: normalizedWorkspaceId,
      datasourceId: normalizedDatasourceId
    });
    if (body.policyVersion !== current.policyVersion) {
      throw new DomainError(
        "POLICY_VERSION_CONFLICT",
        "策略版本已更新，请刷新后重试。",
        409,
        {
          workspaceId: normalizedWorkspaceId,
          datasourceId: normalizedDatasourceId,
          expectedPolicyVersion: body.policyVersion,
          actualPolicyVersion: current.policyVersion
        }
      );
    }

    const replaced =
      await this.policyRepository.replaceWorkspaceDatasourceTablePermissions({
        workspaceId: normalizedWorkspaceId,
        datasourceId: normalizedDatasourceId,
        tableNames: normalizedTableNames,
        expectedPolicyVersion: body.policyVersion
      });

    const response = {
      workspaceId: normalizedWorkspaceId,
      datasourceId: normalizedDatasourceId,
      policyVersion: replaced.policyVersion,
      tableNames: replaced.tableNames,
      impactSummary: {
        beforeCount: replaced.beforeCount,
        afterCount: replaced.afterCount,
        addedCount: replaced.addedTables.length,
        removedCount: replaced.removedTables.length,
        retainedCount: replaced.retainedTables.length,
        addedTables: replaced.addedTables,
        removedTables: replaced.removedTables
      },
      idempotencyKey,
      replayed: false
    };

    this.replaceTablePermissionIdempotencyStore.set(idempotencyScope, {
      payloadHash,
      response,
      expiresAt: Date.now() + IDEMPOTENCY_TTL_MS
    });

    await this.auditLogRepository.appendEvent({
      phase: "governance",
      eventType: "workspace.datasource.table-permissions.updated",
      eventCode: "TABLE_PERMISSIONS_REPLACED",
      message: "工作空间数据源表权限已替换",
      metadata: {
        workspaceId: normalizedWorkspaceId,
        datasourceId: normalizedDatasourceId,
        actorId: actor.id,
        requestId: requestId ?? null,
        idempotencyKey,
        replayed: false,
        beforeCount: response.impactSummary.beforeCount,
        afterCount: response.impactSummary.afterCount,
        addedCount: response.impactSummary.addedCount,
        removedCount: response.impactSummary.removedCount,
        retainedCount: response.impactSummary.retainedCount,
        addedTables: response.impactSummary.addedTables,
        removedTables: response.impactSummary.removedTables,
        policyVersionBefore: body.policyVersion,
        policyVersionAfter: response.policyVersion
      }
    });

    return response;
  }

  private async assertDatasourceBound(input: {
    workspaceId: string;
    datasourceId: string;
    actorId: string;
    requestId?: string;
    operation: string;
  }): Promise<void> {
    const bound = await this.policyRepository.isDatasourceBound(
      input.workspaceId,
      input.datasourceId
    );
    if (!bound) {
      await this.auditLogRepository.appendEvent({
        phase: "governance",
        eventType: "workspace.datasource.binding.rejected",
        eventCode: "WORKSPACE_DATASOURCE_NOT_BOUND",
        severity: "warning",
        message: "检测到未绑定的数据源访问尝试",
        metadata: {
          workspaceId: input.workspaceId,
          datasourceId: input.datasourceId,
          actorId: input.actorId,
          operation: input.operation,
          requestId: input.requestId ?? null
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

  private normalizeTableNames(tableNames: string[]): string[] {
    const deduped = new Set<string>();
    for (const tableName of tableNames) {
      const normalized = tableName.trim().toLowerCase();
      if (!normalized) {
        continue;
      }
      deduped.add(normalized);
    }
    return Array.from(deduped).sort((left, right) => left.localeCompare(right));
  }

  private normalizeRequiredIdempotencyKey(value?: string): string {
    const normalized = value?.trim();
    if (!normalized) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "replace 表权限时必须提供 x-idempotency-key。",
        400,
        {
          field: "x-idempotency-key"
        }
      );
    }
    if (normalized.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new DomainError(
        "VALIDATION_ERROR",
        `x-idempotency-key 长度不能超过 ${MAX_IDEMPOTENCY_KEY_LENGTH}`,
        400,
        {
          field: "x-idempotency-key"
        }
      );
    }
    return normalized;
  }

  private hashReplacePayload(input: {
    policyVersion: number;
    tableNames: string[];
  }): string {
    return createHash("sha256")
      .update(
        JSON.stringify({
          policyVersion: input.policyVersion,
          tableNames: input.tableNames
        })
      )
      .digest("hex");
  }

  private buildTablePermissionIdempotencyScope(input: {
    actorId: string;
    workspaceId: string;
    datasourceId: string;
    method: "PUT";
    idempotencyKey: string;
  }): string {
    return [
      input.actorId.trim(),
      input.workspaceId.trim(),
      input.datasourceId.trim(),
      input.method,
      input.idempotencyKey
    ].join("::");
  }

  private readReplaceIdempotencyRecord(input: {
    scope: string;
    payloadHash: string;
  }): {
    workspaceId: string;
    datasourceId: string;
    policyVersion: number;
    tableNames: string[];
    impactSummary: {
      beforeCount: number;
      afterCount: number;
      addedCount: number;
      removedCount: number;
      retainedCount: number;
      addedTables: string[];
      removedTables: string[];
    };
    idempotencyKey: string;
    replayed: boolean;
  } | null {
    const record = this.replaceTablePermissionIdempotencyStore.get(input.scope);
    if (!record) {
      return null;
    }
    if (record.expiresAt <= Date.now()) {
      this.replaceTablePermissionIdempotencyStore.delete(input.scope);
      return null;
    }
    if (record.payloadHash !== input.payloadHash) {
      throw new DomainError(
        "IDEMPOTENCY_REPLAY_CONFLICT",
        "相同 x-idempotency-key 不能提交不同内容。",
        409,
        {
          scope: input.scope
        }
      );
    }
    return {
      ...record.response,
      replayed: true
    };
  }

  private pruneReplaceIdempotencyStore(): void {
    const now = Date.now();
    for (const [scope, record] of this.replaceTablePermissionIdempotencyStore.entries()) {
      if (record.expiresAt <= now) {
        this.replaceTablePermissionIdempotencyStore.delete(scope);
      }
    }
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
