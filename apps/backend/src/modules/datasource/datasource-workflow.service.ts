import { Injectable } from "@nestjs/common";
import { DomainError } from "../../common/domain-error";
import { AuditLogRepository } from "../data/persistence/audit-log.repository";
import { DatasourceRepository } from "../data/persistence/datasource.repository";
import { WorkspaceDatasourceService } from "../workspace/workspace-datasource.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { DatasourceService } from "./datasource.service";
import type { UpsertDatasourceWorkflowDto } from "./dto/upsert-datasource-workflow.dto";

type Actor = {
  id: string;
  role: "admin" | "user";
  isSystemAdmin?: boolean;
  workspaceRoles?: Record<string, "admin" | "member">;
};

type DatasourceWorkflowMode = "create" | "edit";
type DatasourceWorkflowStage =
  | "received"
  | "workspace_create_started"
  | "workspace_ready"
  | "datasource_create_started"
  | "datasource_update_started"
  | "datasource_ready"
  | "binding_apply_started"
  | "binding_applied"
  | "completed"
  | "validation_failed"
  | "workspace_create_failed"
  | "datasource_create_failed"
  | "datasource_update_failed"
  | "binding_apply_failed"
  | "compensation_soft_delete_failed"
  | "compensation_mark_unavailable_failed";

type WorkflowBindingSummary = {
  bound: boolean;
  workspaceId?: string;
  datasourceId?: string;
};

type WorkflowCompensationSummary = {
  attempted: boolean;
  status: "skipped" | "succeeded" | "failed";
  strategy?: "soft_delete" | "mark_unavailable";
  message?: string;
};

export type DatasourceWorkflowResult = {
  mode: DatasourceWorkflowMode;
  stage: DatasourceWorkflowStage;
  workspaceId: string;
  datasourceId: string;
  bindingSummary: WorkflowBindingSummary;
  idempotencyKey?: string;
  replayed: boolean;
  compensation?: WorkflowCompensationSummary;
};

type StoredWorkflowError = {
  code: string;
  message: string;
  statusCode: number;
  details?: Record<string, unknown>;
};

type IdempotencyRecord =
  | {
      kind: "success";
      value: DatasourceWorkflowResult;
    }
  | {
      kind: "error";
      value: StoredWorkflowError;
    };

const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

@Injectable()
export class DatasourceWorkflowService {
  private readonly idempotencyStore = new Map<string, IdempotencyRecord>();

  constructor(
    private readonly datasourceService: DatasourceService,
    private readonly datasourceRepository: DatasourceRepository,
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceDatasourceService: WorkspaceDatasourceService,
    private readonly auditLogRepository: AuditLogRepository
  ) {}

  async upsertWorkflow(
    actor: Actor | undefined,
    body: UpsertDatasourceWorkflowDto,
    idempotencyKeyRaw?: string
  ): Promise<DatasourceWorkflowResult> {
    const normalizedActor = this.assertActor(actor);
    const mode = body.mode;
    const idempotencyKey = this.normalizeIdempotencyKey(idempotencyKeyRaw);
    const idempotencyIdentity = idempotencyKey
      ? `${normalizedActor.id}::${mode}::${idempotencyKey}`
      : undefined;
    if (idempotencyIdentity) {
      const replayed = this.readIdempotencyRecord(idempotencyIdentity);
      if (replayed) {
        return replayed;
      }
    }

    let stage: DatasourceWorkflowStage = "received";
    let workspaceId = this.resolveWorkspaceId(body);
    let datasourceId = this.resolveDatasourceId(body);
    let createdDatasourceId = "";
    let bindingSummary: WorkflowBindingSummary = {
      bound: false
    };
    let compensation: WorkflowCompensationSummary = {
      attempted: false,
      status: "skipped"
    };

    await this.auditLogRepository.appendEvent({
      phase: "governance",
      eventType: "datasource.workflow.lifecycle",
      eventCode: "WORKFLOW_STARTED",
      message: "数据源编排流程开始",
      metadata: {
        mode,
        stage,
        actorId: normalizedActor.id,
        workspaceId: workspaceId || null,
        datasourceId: datasourceId || null,
        idempotencyKey: idempotencyKey ?? null
      }
    });

    try {
      this.validateWorkflowInput(mode, body, normalizedActor);

      if (!workspaceId) {
        stage = "workspace_create_started";
        const workspaceName = this.resolveWorkspaceCreateName(body);
        if (!workspaceName) {
          stage = "validation_failed";
          throw new DomainError(
            "VALIDATION_ERROR",
            "workspaceId 不能为空，且未提供 workspaceCreate.name。",
            400,
            { field: "workspaceId" }
          );
        }
        const createdWorkspace = await this.workspaceService.createWorkspace(
          normalizedActor,
          { name: workspaceName }
        );
        workspaceId = createdWorkspace.id;
      }
      stage = "workspace_ready";

      if (mode === "create") {
        stage = "datasource_create_started";
        const datasourcePayload = body.datasource;
        if (!datasourcePayload?.name?.trim() || !datasourcePayload.type) {
          stage = "validation_failed";
          throw new DomainError(
            "VALIDATION_ERROR",
            "create 模式必须提供 datasource.name 与 datasource.type。",
            400,
            {
              field: "datasource"
            }
          );
        }
        const createdDatasource = await this.datasourceService.createDatasource({
          name: datasourcePayload.name,
          type: datasourcePayload.type,
          host: datasourcePayload.host,
          port: datasourcePayload.port,
          database: datasourcePayload.database,
          username: datasourcePayload.username,
          password: datasourcePayload.password,
          filePath: datasourcePayload.filePath,
          shared: datasourcePayload.shared
        });
        datasourceId = createdDatasource.id;
        createdDatasourceId = createdDatasource.id;
      } else {
        if (!datasourceId) {
          stage = "validation_failed";
          throw new DomainError(
            "VALIDATION_ERROR",
            "edit 模式必须提供 datasourceId。",
            400,
            {
              field: "datasourceId"
            }
          );
        }
        stage = "datasource_update_started";
        if (body.datasource && Object.keys(body.datasource).length > 0) {
          const patchPayload = { ...body.datasource };
          delete patchPayload.datasourceId;
          await this.datasourceService.updateDatasource(
            normalizedActor,
            datasourceId,
            patchPayload
          );
        } else {
          await this.datasourceService.getDatasourceOrThrow(datasourceId);
        }
      }
      stage = "datasource_ready";

      stage = "binding_apply_started";
      const bindingResult = await this.workspaceDatasourceService.bindDatasources(
        normalizedActor,
        workspaceId,
        [datasourceId]
      );
      if (!bindingResult.successItems.includes(datasourceId)) {
        const failed = bindingResult.failedItems.find(
          (item) => item.item === datasourceId
        );
        stage = "binding_apply_failed";
        throw new DomainError(
          failed?.code ?? "WORKSPACE_BINDING_FAILED",
          failed?.message ?? "绑定工作空间失败。",
          400,
          {
            workspaceId,
            datasourceId
          }
        );
      }
      stage = "binding_applied";
      bindingSummary = {
        bound: true,
        workspaceId,
        datasourceId
      };

      stage = "completed";
      const result: DatasourceWorkflowResult = {
        mode,
        stage,
        workspaceId,
        datasourceId,
        bindingSummary,
        idempotencyKey,
        replayed: false
      };

      await this.auditLogRepository.appendEvent({
        phase: "governance",
        eventType: "datasource.workflow.lifecycle",
        eventCode: "WORKFLOW_SUCCEEDED",
        message: "数据源编排流程完成",
        metadata: {
          mode,
          stage,
          actorId: normalizedActor.id,
          workspaceId,
          datasourceId,
          idempotencyKey: idempotencyKey ?? null,
          bindingSummary
        }
      });

      if (idempotencyIdentity) {
        this.idempotencyStore.set(idempotencyIdentity, {
          kind: "success",
          value: result
        });
      }
      return result;
    } catch (error) {
      const failedStage = this.toFailedStage(stage);
      const normalized = this.toDomainError(error, failedStage);
      if (mode === "create" && createdDatasourceId) {
        compensation = await this.compensateCreateFailure({
          datasourceId: createdDatasourceId,
          failedStage: failedStage,
          reason: normalized.message
        });
      }

      await this.auditLogRepository.appendEvent({
        phase: "governance",
        eventType: "datasource.workflow.lifecycle",
        eventCode: "WORKFLOW_FAILED",
        severity: "error",
        message: "数据源编排流程失败",
        metadata: {
          mode,
          stage: failedStage,
          actorId: normalizedActor.id,
          workspaceId: workspaceId || null,
          datasourceId: datasourceId || createdDatasourceId || null,
          idempotencyKey: idempotencyKey ?? null,
          bindingSummary,
          compensation,
          error: {
            code: normalized.code,
            message: normalized.message
          }
        }
      });

      const details: Record<string, unknown> = {
        ...(normalized.details ?? {}),
        stage: failedStage,
        workspaceId: workspaceId || undefined,
        datasourceId: datasourceId || createdDatasourceId || undefined,
        bindingSummary,
        compensation,
        idempotencyKey: idempotencyKey || undefined
      };

      if (idempotencyIdentity) {
        this.idempotencyStore.set(idempotencyIdentity, {
          kind: "error",
          value: {
            code: normalized.code,
            message: normalized.message,
            statusCode: normalized.statusCode,
            details
          }
        });
      }

      throw new DomainError(
        normalized.code,
        normalized.message,
        normalized.statusCode,
        details
      );
    }
  }

  private validateWorkflowInput(
    mode: DatasourceWorkflowMode,
    body: UpsertDatasourceWorkflowDto,
    actor: Actor
  ): void {
    if (mode === "create" && !this.isSystemAdmin(actor)) {
      throw new DomainError(
        "FORBIDDEN",
        "仅系统管理员可执行 create workflow。",
        403
      );
    }

    if (this.resolveWorkspaceCreateName(body) && !this.isSystemAdmin(actor)) {
      throw new DomainError(
        "FORBIDDEN",
        "仅系统管理员可在 workflow 中新建工作空间。",
        403
      );
    }

    if (
      mode === "edit" &&
      body.datasource &&
      Object.keys(body.datasource).length > 0 &&
      !this.isSystemAdmin(actor)
    ) {
      throw new DomainError(
        "FORBIDDEN",
        "仅系统管理员可在 edit workflow 中修改数据源基础信息。",
        403
      );
    }
  }

  private resolveWorkspaceId(body: UpsertDatasourceWorkflowDto): string {
    return body.workspace?.workspaceId?.trim() ?? body.workspaceId?.trim() ?? "";
  }

  private resolveWorkspaceCreateName(body: UpsertDatasourceWorkflowDto): string {
    return body.workspace?.create?.name?.trim() ?? body.workspaceCreate?.name?.trim() ?? "";
  }

  private resolveDatasourceId(body: UpsertDatasourceWorkflowDto): string {
    return body.datasource?.datasourceId?.trim() ?? body.datasourceId?.trim() ?? "";
  }

  private async compensateCreateFailure(input: {
    datasourceId: string;
    failedStage: DatasourceWorkflowStage;
    reason: string;
  }): Promise<WorkflowCompensationSummary> {
    try {
      const deleted = await this.datasourceRepository.softDeleteDatasource(
        input.datasourceId
      );
      if (deleted?.status === "deleted") {
        await this.auditLogRepository.appendEvent({
          phase: "governance",
          eventType: "datasource.workflow.compensation",
          eventCode: "SOFT_DELETE_SUCCEEDED",
          message: "create workflow 失败后软删除数据源成功",
          metadata: {
            datasourceId: input.datasourceId,
            failedStage: input.failedStage
          }
        });
        return {
          attempted: true,
          status: "succeeded",
          strategy: "soft_delete",
          message: "soft_deleted"
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.auditLogRepository.appendEvent({
        phase: "governance",
        eventType: "datasource.workflow.compensation",
        eventCode: "SOFT_DELETE_FAILED",
        severity: "warning",
        message: "create workflow 失败后软删除数据源失败，执行降级补偿",
        metadata: {
          datasourceId: input.datasourceId,
          failedStage: input.failedStage,
          error: message
        }
      });
    }

    try {
      const unavailable = await this.datasourceRepository.markDatasourceUnavailable(
        input.datasourceId,
        {
          code: "provisioning_failed",
          failedStage: input.failedStage,
          reason: input.reason
        }
      );
      if (unavailable?.status === "unavailable") {
        await this.auditLogRepository.appendEvent({
          phase: "governance",
          eventType: "datasource.workflow.compensation",
          eventCode: "MARK_UNAVAILABLE_SUCCEEDED",
          severity: "warning",
          message: "create workflow 失败后降级为 unavailable + provisioning_failed",
          metadata: {
            datasourceId: input.datasourceId,
            failedStage: input.failedStage
          }
        });
        return {
          attempted: true,
          status: "succeeded",
          strategy: "mark_unavailable",
          message: "marked_unavailable"
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.auditLogRepository.appendEvent({
        phase: "governance",
        eventType: "datasource.workflow.compensation",
        eventCode: "MARK_UNAVAILABLE_FAILED",
        severity: "error",
        message: "create workflow 失败后 unavailable 降级补偿失败",
        metadata: {
          datasourceId: input.datasourceId,
          failedStage: input.failedStage,
          error: message
        }
      });
      return {
        attempted: true,
        status: "failed",
        strategy: "mark_unavailable",
        message
      };
    }

    return {
      attempted: true,
      status: "failed",
      strategy: "mark_unavailable",
      message: "compensation_failed"
    };
  }

  private readIdempotencyRecord(
    idempotencyIdentity: string
  ): DatasourceWorkflowResult | undefined {
    const record = this.idempotencyStore.get(idempotencyIdentity);
    if (!record) {
      return undefined;
    }

    if (record.kind === "success") {
      return {
        ...record.value,
        replayed: true
      };
    }

    const error = record.value;
    throw new DomainError(error.code, error.message, error.statusCode, {
      ...(error.details ?? {}),
      replayed: true
    });
  }

  private normalizeIdempotencyKey(value?: string): string | undefined {
    const normalized = value?.trim();
    if (!normalized) {
      return undefined;
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

  private assertActor(actor: Actor | undefined): Actor {
    if (!actor?.id?.trim()) {
      throw new DomainError("ACTOR_CONTEXT_REQUIRED", "缺少 actor 上下文。", 401);
    }
    return actor;
  }

  private isSystemAdmin(actor: Actor): boolean {
    return actor.role === "admin" || actor.isSystemAdmin === true;
  }

  private toDomainError(
    error: unknown,
    stage: DatasourceWorkflowStage
  ): DomainError {
    if (error instanceof DomainError) {
      return error;
    }

    return new DomainError(
      "DATASOURCE_WORKFLOW_FAILED",
      error instanceof Error ? error.message : "数据源编排失败",
      500,
      {
        stage
      }
    );
  }

  private toFailedStage(stage: DatasourceWorkflowStage): DatasourceWorkflowStage {
    if (stage === "workspace_create_started") {
      return "workspace_create_failed";
    }
    if (stage === "datasource_create_started") {
      return "datasource_create_failed";
    }
    if (stage === "datasource_update_started") {
      return "datasource_update_failed";
    }
    if (stage === "binding_apply_started") {
      return "binding_apply_failed";
    }
    return stage;
  }
}
