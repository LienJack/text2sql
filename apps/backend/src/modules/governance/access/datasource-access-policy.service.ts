import { Injectable } from "@nestjs/common";
import type { Datasource, WorkspaceMemberRole } from "@text2sql/shared-types";
import { DomainError } from "../../../common/domain-error";
import {
  DatasourceRepository,
  WorkspaceDatasourcePolicyRepository,
  WorkspaceRepository
} from "../../platform/data/persistence/index";

export type AccessRole =
  | "system_admin"
  | "workspace_admin"
  | "workspace_member"
  | "admin"
  | "member";

export type AccessContext = {
  actorId: string;
  workspaceId: string;
  roleSet: AccessRole[];
};

export type TableAccessDecision = "workspace_allow" | "default_deny";

export type ReadableTableResolution = {
  datasourceId: string;
  readableTables: string[];
  decisions: Record<string, TableAccessDecision>;
};

export type LegacyReadableTableResolution = ReadableTableResolution & {
  policySource: "workspace_table_permissions";
  allowedColumnsByTable: Record<string, string[]>;
  rowFiltersByTable: Record<string, string>;
};

type ActorLike = {
  id?: string;
  role?: string;
  isSystemAdmin?: boolean;
  requestedWorkspaceId?: string;
  accessContext?: {
    actorId?: string;
    workspaceId?: string | null;
    roleSet?: string[];
  };
};

@Injectable()
export class DatasourceAccessPolicyService {
  constructor(
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly datasourceRepository: DatasourceRepository,
    private readonly policyRepository: WorkspaceDatasourcePolicyRepository
  ) {}

  async resolveAccessContext(input: {
    actor: ActorLike;
    workspaceId?: string;
  }): Promise<AccessContext> {
    const actorId = this.resolveActorId(input.actor);
    const workspaceId = this.resolveWorkspaceId(input.actor, input.workspaceId);
    const workspace = await this.workspaceRepository.getWorkspaceById(workspaceId);
    if (!workspace) {
      throw new DomainError(
        "WORKSPACE_CONTEXT_INVALID",
        "工作空间上下文无效或不存在。",
        403,
        {
          actorId,
          workspaceId
        }
      );
    }

    const roleSet = new Set<AccessRole>();
    const systemAdmin = this.isSystemAdmin(input.actor);
    if (systemAdmin) {
      roleSet.add("system_admin");
      roleSet.add("admin");
    }

    const memberRole = await this.resolveWorkspaceMembershipRole(actorId, workspaceId);
    if (memberRole === "admin") {
      roleSet.add("workspace_admin");
      roleSet.add("workspace_member");
      roleSet.add("admin");
      roleSet.add("member");
    } else if (memberRole === "member") {
      roleSet.add("workspace_member");
      roleSet.add("member");
    } else if (!systemAdmin) {
      throw new DomainError(
        "WORKSPACE_ACCESS_DENIED",
        "当前 actor 不属于该工作空间。",
        403,
        {
          actorId,
          workspaceId
        }
      );
    }

    return {
      actorId,
      workspaceId,
      roleSet: Array.from(roleSet)
    };
  }

  async listVisibleDatasources(input: {
    context: AccessContext;
  }): Promise<{
    ids: string[];
    datasources: Datasource[];
  }> {
    const bindingIds = await this.policyRepository.listWorkspaceDatasourceIds(
      input.context.workspaceId
    );
    if (!bindingIds.length) {
      return {
        ids: [],
        datasources: []
      };
    }

    const allDatasources = await this.datasourceRepository.listDatasources({
      includeDeleted: false
    });
    const datasourceMap = new Map(allDatasources.map((item) => [item.id, item]));
    const visible = bindingIds
      .map((datasourceId) => datasourceMap.get(datasourceId))
      .filter((item): item is Datasource => Boolean(item));

    return {
      ids: visible.map((item) => item.id),
      datasources: visible
    };
  }

  async resolveReadableTables(input: {
    context: AccessContext;
    datasourceId: string;
    candidateTables?: string[];
  }): Promise<ReadableTableResolution> {
    const datasourceId = this.normalizeDatasourceId(input.datasourceId);
    await this.assertDatasourceVisible(input.context, datasourceId);

    const state = await this.policyRepository.getWorkspaceDatasourceTablePermissionSet({
      workspaceId: input.context.workspaceId,
      datasourceId
    });
    const allowedTableSet = new Set(this.normalizeTableNames(state.tableNames));
    const candidateTables =
      input.candidateTables && input.candidateTables.length > 0
        ? this.normalizeTableNames(input.candidateTables)
        : Array.from(allowedTableSet);

    const readableTables: string[] = [];
    const decisions: Record<string, TableAccessDecision> = {};
    for (const tableName of candidateTables) {
      const allowed = allowedTableSet.has(tableName);
      decisions[tableName] = allowed ? "workspace_allow" : "default_deny";
      if (allowed) {
        readableTables.push(tableName);
      }
    }

    return {
      datasourceId,
      readableTables,
      decisions
    };
  }

  async resolveLegacyReadableTables(input: {
    context: AccessContext;
    datasourceId: string;
    candidateTables?: string[];
  }): Promise<LegacyReadableTableResolution> {
    const resolution = await this.resolveReadableTables(input);
    return {
      ...resolution,
      policySource: "workspace_table_permissions",
      allowedColumnsByTable: {},
      rowFiltersByTable: {}
    };
  }

  private async assertDatasourceVisible(
    context: AccessContext,
    datasourceId: string
  ): Promise<void> {
    const bound = await this.policyRepository.isDatasourceBound(
      context.workspaceId,
      datasourceId
    );
    if (!bound) {
      throw new DomainError(
        "DATASOURCE_ACCESS_DENIED",
        "当前工作空间未绑定该数据源或 actor 无访问权限。",
        403,
        {
          workspaceId: context.workspaceId,
          datasourceId,
          actorId: context.actorId
        }
      );
    }
  }

  private resolveActorId(actor: ActorLike): string {
    const actorId = actor.id?.trim() || actor.accessContext?.actorId?.trim();
    if (!actorId) {
      throw new DomainError("ACTOR_CONTEXT_REQUIRED", "缺少 actor 上下文。", 401);
    }
    return actorId;
  }

  private resolveWorkspaceId(actor: ActorLike, workspaceId?: string): string {
    const resolved =
      workspaceId?.trim() ||
      actor.accessContext?.workspaceId?.trim() ||
      actor.requestedWorkspaceId?.trim();
    if (!resolved) {
      throw new DomainError(
        "WORKSPACE_CONTEXT_REQUIRED",
        "缺少可验证的 workspace 上下文。",
        400
      );
    }
    return resolved;
  }

  private isSystemAdmin(actor: ActorLike): boolean {
    if (actor.isSystemAdmin) {
      return true;
    }
    return actor.role?.trim().toLowerCase() === "admin";
  }

  private async resolveWorkspaceMembershipRole(
    actorId: string,
    workspaceId: string
  ): Promise<WorkspaceMemberRole | undefined> {
    const result = await this.workspaceRepository.listWorkspaceMembers({
      workspaceId,
      page: 1,
      pageSize: 500
    });
    const exactMatch = result.items.find((item) => item.userId === actorId);
    if (!exactMatch) {
      return undefined;
    }
    return exactMatch.role;
  }

  private normalizeDatasourceId(datasourceId: string): string {
    const normalized = datasourceId.trim();
    if (!normalized) {
      throw new DomainError("VALIDATION_ERROR", "datasourceId 不能为空。", 400, {
        field: "datasourceId"
      });
    }
    return normalized;
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
    return Array.from(deduped);
  }
}
