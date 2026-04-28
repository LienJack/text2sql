import { Injectable, Optional } from "@nestjs/common";
import type { SemanticPlanV1 } from "@text2sql/shared-types";
import { DomainError } from "../../../../common/domain-error";
import {
  AuditLogRepository,
  ChatRepository
} from "../../../platform/data/persistence/index";
import {
  QueryExecutorRouterService,
  type SqlTableAccessContext
} from "../../../platform/data/query/index";
import { DatasourceService } from "../../../governance/datasource/datasource.service";
import type { AccessContext } from "../../../governance/access/datasource-access-policy.service";
import { PolicyEvaluatorService } from "../../../governance/access/policy-evaluator.service";
import { SqlCorrectionService } from "../../adapters/sql-correction.service";
import { SqlValidationService } from "../../adapters/sql-validation.service";

@Injectable()
export class ExecuteSqlNode {
  constructor(
    private readonly datasourceService: DatasourceService,
    private readonly queryExecutorRouter: QueryExecutorRouterService,
    private readonly chatRepository: ChatRepository,
    private readonly policyEvaluatorService: PolicyEvaluatorService,
    private readonly auditLogRepository: AuditLogRepository,
    private readonly sqlCorrectionService: SqlCorrectionService,
    @Optional()
    private readonly sqlValidationService?: SqlValidationService
  ) {}

  async run(input: {
    sql: string;
    datasourceId: string;
    sessionId: string;
    requestId?: string;
    accessContext?: SqlTableAccessContext;
    semanticPlan?: SemanticPlanV1;
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
    const policyResult =
      accessContext && accessContext.roleSet
        ? await this.resolvePolicy(accessContext, input.datasourceId)
        : undefined;
    const effectiveAccessContext = accessContext
      ? {
          ...accessContext,
          evaluatorMode: policyResult?.mode ?? accessContext.evaluatorMode,
          allowedColumnsByTable: policyResult?.allowedColumnsByTable ?? {},
          rowFiltersByTable: policyResult?.rowFiltersByTable ?? {}
        }
      : undefined;

    if (this.sqlValidationService) {
      const validation = await this.sqlValidationService.validate({
        sql: input.sql,
        datasourceId: input.datasourceId,
        datasourceType: datasource.type,
        semanticPlan: input.semanticPlan,
        accessContext: effectiveAccessContext,
        allowedTables: policyResult?.readableTables
      });
      if (validation.status === "failed" && validation.failure) {
        if (validation.failure.correctable) {
          throw new DomainError(
            "SQL_CORRECTABLE_EXECUTION_FAILED",
            validation.failure.message,
            422,
            {
              correctable: true,
              validationOutcome: "correctable",
              correctionReason: validation.failure.code,
              maxAttempts: this.sqlCorrectionService.maxAttempts,
              validationFailure: validation.failure,
              validationArtifact: validation
            }
          );
        }
        throw new DomainError(
          "SQL_TERMINAL_VALIDATION_FAILED",
          validation.failure.message,
          422,
          {
            correctable: false,
            validationOutcome: "terminal",
            governanceFailClosed:
              validation.failure.category === "governance" ||
              validation.failure.code === "SQL_READ_ONLY_VIOLATION",
            validationFailure: validation.failure,
            validationArtifact: validation
          }
        );
      }
    }

    try {
      return await this.queryExecutorRouter.execute({
        datasource,
        sql: input.sql,
        tablePermissions: effectiveAccessContext
          ? {
              accessContext: effectiveAccessContext,
              allowedTables: policyResult?.readableTables
            }
          : undefined
      });
    } catch (error) {
      if (this.isTablePermissionsGuardError(error) && effectiveAccessContext) {
        await this.writeTablePermissionsDeniedAudit({
          error,
          sql: input.sql,
          datasourceId: input.datasourceId,
          sessionId: input.sessionId,
          requestId: input.requestId,
          accessContext: effectiveAccessContext
        });
      }
      if (
        error instanceof DomainError &&
        (error.code === "SQL_TERMINAL_VALIDATION_FAILED" ||
          error.code === "SQL_CORRECTABLE_EXECUTION_FAILED")
      ) {
        throw error;
      }
      const correctionDecision = this.sqlCorrectionService.decide(error);
      if (correctionDecision.correctable) {
        throw new DomainError(
          "SQL_CORRECTABLE_EXECUTION_FAILED",
          error instanceof Error ? error.message : String(error),
          422,
          {
            correctable: true,
            correctionReason: correctionDecision.reason,
            maxAttempts: correctionDecision.maxAttempts
          }
        );
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
    const resolved = await this.policyEvaluatorService.resolveAccessContext({
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

  private async resolvePolicy(
    context: SqlTableAccessContext,
    datasourceId: string
  ): Promise<{
    mode: "workspace_table_permissions";
    readableTables: string[];
    allowedColumnsByTable: Record<string, string[]>;
    rowFiltersByTable: Record<string, string>;
  }> {
    const resolved = await this.policyEvaluatorService.resolveReadableTables({
      context: {
        actorId: context.actorId,
        workspaceId: context.workspaceId,
        roleSet: context.roleSet
      } as AccessContext,
      datasourceId
    });
    return {
      mode: resolved.mode,
      readableTables: resolved.readableTables,
      allowedColumnsByTable: resolved.allowedColumnsByTable,
      rowFiltersByTable: resolved.rowFiltersByTable
    };
  }

  private isTablePermissionsGuardError(error: unknown): error is DomainError {
    return (
      error instanceof DomainError &&
      (error.code === "TABLE_PERMISSIONS_FORBIDDEN" ||
        error.code === "TABLE_PERMISSIONS_PARSE_REJECTED")
    );
  }

  private async writeTablePermissionsDeniedAudit(input: {
    error: DomainError;
    sql: string;
    datasourceId: string;
    sessionId: string;
    requestId?: string;
    accessContext: SqlTableAccessContext;
  }): Promise<void> {
    try {
      await this.auditLogRepository.appendEvent({
        phase: "governance",
        eventType: "workspace.datasource.table-permissions.denied",
        eventCode: input.error.code,
        severity: "warning",
        message: input.error.message,
        runId: input.sessionId,
        sessionId: input.sessionId,
        metadata: {
          datasourceId: input.datasourceId,
          workspaceId: input.accessContext.workspaceId,
          actorId: input.accessContext.actorId,
          requestId: input.requestId ?? null,
          sql: input.sql,
          details: input.error.details ?? null
        }
      });
    } catch (auditError) {
      throw new DomainError(
        "TABLE_PERMISSIONS_AUDIT_WRITE_FAILED",
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
