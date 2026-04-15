import { Injectable } from "@nestjs/common";
import { DomainError } from "../../../common/domain-error";
import { ChatRepository } from "../../data/persistence/chat.repository";
import { AuditLogRepository } from "../../data/persistence/audit-log.repository";
import { QueryExecutorRouterService } from "../../data/query/query-executor-router.service";
import type { SqlTableAccessContext } from "../../data/query/sql-table-access-guard.service";
import { DatasourceService } from "../../datasource/datasource.service";
import { DatasourceAccessPolicyService, type AccessContext } from "../../auth/datasource-access-policy.service";

@Injectable()
export class ExecuteSqlNode {
  constructor(
    private readonly datasourceService: DatasourceService,
    private readonly queryExecutorRouter: QueryExecutorRouterService,
    private readonly chatRepository: ChatRepository,
    private readonly datasourceAccessPolicyService: DatasourceAccessPolicyService,
    private readonly auditLogRepository: AuditLogRepository
  ) {}

  async run(input: {
    sql: string;
    datasourceId: string;
    sessionId: string;
    accessContext?: SqlTableAccessContext;
  }): Promise<{
    rows: Array<Record<string, unknown>>;
    columns: string[];
  }> {
    const datasource = await this.datasourceService.getDatasourceById(
      input.datasourceId
    );
    if (!datasource) {
      throw new DomainError("DATASOURCE_NOT_FOUND", "会话绑定的数据源不存在", 404, {
        datasourceId: input.datasourceId
      });
    }

    if (datasource.status !== "available") {
      throw new DomainError(
        "DATASOURCE_UNAVAILABLE",
        "当前会话绑定的数据源不可用，请先重新选择数据源。",
        409,
        {
          datasourceId: input.datasourceId,
          status: datasource.status
        }
      );
    }

    const accessContext = await this.resolveAccessContext(input);
    const allowedTables =
      accessContext && accessContext.roleSet
        ? await this.resolveAllowedTables(accessContext, input.datasourceId)
        : undefined;

    try {
      return await this.queryExecutorRouter.execute({
        datasource,
        sql: input.sql,
        acl: accessContext
          ? {
              accessContext,
              allowedTables
            }
          : undefined
      });
    } catch (error) {
      if (this.isAclGuardError(error) && accessContext) {
        await this.writeAclDeniedAudit({
          error,
          sql: input.sql,
          datasourceId: input.datasourceId,
          sessionId: input.sessionId,
          accessContext
        });
      }
      throw error;
    }
  }

  private async resolveAccessContext(input: {
    sessionId: string;
    accessContext?: SqlTableAccessContext;
  }): Promise<SqlTableAccessContext | undefined> {
    if (input.accessContext?.actorId?.trim() && input.accessContext.workspaceId?.trim()) {
      return {
        ...input.accessContext,
        actorId: input.accessContext.actorId.trim(),
        workspaceId: input.accessContext.workspaceId.trim()
      };
    }

    const session = await this.chatRepository.getSessionById(input.sessionId);
    const actorId = session?.createdByUserId?.trim();
    const workspaceId = session?.workspaceId?.trim();
    if (!actorId || !workspaceId) {
      return undefined;
    }
    const resolved = await this.datasourceAccessPolicyService.resolveAccessContext({
      actor: {
        id: actorId,
        role: "user",
        requestedWorkspaceId: workspaceId
      },
      workspaceId
    });
    return {
      actorId: resolved.actorId,
      workspaceId: resolved.workspaceId,
      roleSet: [...resolved.roleSet]
    };
  }

  private async resolveAllowedTables(
    context: SqlTableAccessContext,
    datasourceId: string
  ): Promise<string[]> {
    const readable = await this.datasourceAccessPolicyService.resolveReadableTables({
      context: {
        actorId: context.actorId,
        workspaceId: context.workspaceId,
        roleSet: context.roleSet
      } as AccessContext,
      datasourceId
    });
    return readable.readableTables;
  }

  private isAclGuardError(error: unknown): error is DomainError {
    return (
      error instanceof DomainError &&
      (error.code === "ACL_FORBIDDEN" || error.code === "ACL_PARSE_REJECTED")
    );
  }

  private async writeAclDeniedAudit(input: {
    error: DomainError;
    sql: string;
    datasourceId: string;
    sessionId: string;
    accessContext: SqlTableAccessContext;
  }): Promise<void> {
    try {
      await this.auditLogRepository.appendEvent({
        phase: "governance",
        eventType: "workspace.datasource.acl.denied",
        eventCode: input.error.code,
        severity: "warning",
        message: input.error.message,
        runId: input.sessionId,
        sessionId: input.sessionId,
        metadata: {
          datasourceId: input.datasourceId,
          workspaceId: input.accessContext.workspaceId,
          actorId: input.accessContext.actorId,
          sql: input.sql,
          details: input.error.details ?? null
        }
      });
    } catch (auditError) {
      throw new DomainError(
        "ACL_AUDIT_WRITE_FAILED",
        "授权拒绝审计写入失败，已拒绝执行。",
        503,
        {
          datasourceId: input.datasourceId,
          workspaceId: input.accessContext.workspaceId,
          actorId: input.accessContext.actorId,
          reason:
            auditError instanceof Error ? auditError.message : String(auditError)
        }
      );
    }
  }
}
