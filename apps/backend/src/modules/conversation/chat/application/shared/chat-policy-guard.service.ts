import { Injectable } from "@nestjs/common";
import type { Session } from "@text2sql/shared-types";
import { DomainError } from "../../../../../common/domain-error";
import type { AccessContext } from "../../../../governance/access/datasource-access-policy.service";
import { PolicyEvaluatorService } from "../../../../governance/access/policy-evaluator.service";
import { WorkspaceDatasourcePolicyRepository } from "../../../../platform/data/persistence/index";

export interface ChatPolicyActorInput {
  id?: string;
  role?: string;
  isSystemAdmin?: boolean;
  requestedWorkspaceId?: string;
  accessContext?: {
    actorId?: string;
    workspaceId?: string | null;
    roleSet?: string[];
  };
}

export interface ChatSqlAccessContext {
  actorId: string;
  workspaceId: string;
  roleSet: string[];
  allowedTables: string[];
  allowedColumnsByTable: Record<string, string[]>;
  rowFiltersByTable: Record<string, string>;
  evaluatorMode: "workspace_table_permissions";
}

@Injectable()
export class ChatPolicyGuardService {
  constructor(
    private readonly policyEvaluatorService: PolicyEvaluatorService,
    private readonly workspaceDatasourcePolicyRepository: WorkspaceDatasourcePolicyRepository
  ) {}

  async assertDatasourceVisibleForWorkspace(input: {
    datasourceId: string;
    workspaceId?: string;
    actor?: ChatPolicyActorInput;
  }): Promise<void> {
    const normalizedDatasourceId = input.datasourceId.trim();
    const normalizedWorkspaceId = input.workspaceId?.trim() || undefined;
    if (!normalizedWorkspaceId) {
      return;
    }

    const accessContext = await this.policyEvaluatorService.resolveAccessContext({
      actor: input.actor ?? {
        id: undefined,
        role: "user",
        requestedWorkspaceId: normalizedWorkspaceId
      },
      workspaceId: normalizedWorkspaceId
    });
    const visible = await this.policyEvaluatorService.listVisibleDatasources({
      context: accessContext
    });
    if (visible.ids.includes(normalizedDatasourceId)) {
      return;
    }

    throw new DomainError(
      "DATASOURCE_ACCESS_DENIED",
      "当前工作空间未绑定该数据源或无访问权限。",
      403,
      {
        workspaceId: normalizedWorkspaceId,
        datasourceId: normalizedDatasourceId,
        actorId: accessContext.actorId
      }
    );
  }

  async assertSessionWritableByPolicy(session: Session): Promise<void> {
    const workspaceId = session.workspaceId?.trim();
    if (!workspaceId) {
      return;
    }
    const stillBound = await this.workspaceDatasourcePolicyRepository.isDatasourceBound(
      workspaceId,
      session.datasource
    );
    if (stillBound) {
      return;
    }

    throw new DomainError(
      "SESSION_READONLY_BY_POLICY",
      "该会话已转为只读历史（数据源绑定或权限已变更），不可继续发送消息。",
      409,
      {
        sessionId: session.id,
        workspaceId,
        datasourceId: session.datasource
      }
    );
  }

  async resolveSqlAccessContext(
    session: Session,
    actor?: ChatPolicyActorInput
  ): Promise<ChatSqlAccessContext | undefined> {
    const workspaceId = session.workspaceId?.trim();
    const actorId = actor?.id?.trim() || session.createdByUserId?.trim();
    if (!workspaceId || !actorId) {
      return undefined;
    }

    const context = await this.resolveAccessContext({
      actor: {
        ...(actor ?? {}),
        id: actorId,
        role: actor?.role ?? "user",
        requestedWorkspaceId: actor?.requestedWorkspaceId ?? workspaceId
      },
      workspaceId
    });
    const readable = await this.policyEvaluatorService.resolveReadableTables({
      context,
      datasourceId: session.datasource
    });
    return {
      actorId: context.actorId,
      workspaceId: context.workspaceId,
      roleSet: [...context.roleSet],
      allowedTables: [...readable.readableTables],
      allowedColumnsByTable: { ...readable.allowedColumnsByTable },
      rowFiltersByTable: { ...readable.rowFiltersByTable },
      evaluatorMode: readable.mode
    };
  }

  resolveAccessContext(input: {
    actor: ChatPolicyActorInput;
    workspaceId: string;
  }): Promise<AccessContext> {
    return this.policyEvaluatorService.resolveAccessContext({
      actor: input.actor,
      workspaceId: input.workspaceId
    });
  }
}
