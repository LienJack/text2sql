import { Injectable } from "@nestjs/common";
import type {
  Datasource,
  Session,
  SessionSyncStatus
} from "@text2sql/shared-types";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "../../../../common/domain-error";
import type { AccessContext } from "../../../governance/access/datasource-access-policy.service";
import { PolicyEvaluatorService } from "../../../governance/access/policy-evaluator.service";
import { DatasourceService } from "../../../governance/datasource/datasource.service";
import { ProviderCatalogService } from "../../../llm/provider-catalog.service";
import { ProviderRouterService } from "../../../llm/provider-router.service";
import { RedisBufferService } from "../../../platform/data/cache/index";
import {
  ChatRepository,
  WorkspaceDatasourcePolicyRepository
} from "../../../platform/data/persistence/index";
import type { SessionListView } from "../dto/list-sessions.dto";

const MODEL_PROBE_PROMPT = {
  systemPrompt: "You are a health check assistant. Reply with exactly OK.",
  userPrompt: "Reply with OK."
};

@Injectable()
export class SessionLifecycleUsecase {
  constructor(
    private readonly redisBuffer: RedisBufferService,
    private readonly repository: ChatRepository,
    private readonly datasourceService: DatasourceService,
    private readonly policyEvaluatorService: PolicyEvaluatorService,
    private readonly workspaceDatasourcePolicyRepository: WorkspaceDatasourcePolicyRepository,
    private readonly providerCatalog: ProviderCatalogService,
    private readonly providerRouter: ProviderRouterService
  ) {}

  async createSession(
    datasource: string,
    modelCatalogId?: string,
    options?: {
      workspaceId?: string;
      createdByUserId?: string;
      actor?: {
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
    }
  ): Promise<Session> {
    const normalizedDatasource = datasource.trim();
    const normalizedWorkspaceId = options?.workspaceId?.trim() || undefined;
    const normalizedCreatedByUserId =
      options?.createdByUserId?.trim() || undefined;
    if (!normalizedDatasource) {
      throw new DomainError("VALIDATION_ERROR", "datasource 为必填项", 400, {
        field: "datasource"
      });
    }

    if (normalizedWorkspaceId) {
      const accessContext = await this.policyEvaluatorService.resolveAccessContext({
        actor: options?.actor ?? {
          id: normalizedCreatedByUserId,
          role: "user",
          requestedWorkspaceId: normalizedWorkspaceId
        },
        workspaceId: normalizedWorkspaceId
      });
      const visible = await this.policyEvaluatorService.listVisibleDatasources({
        context: accessContext
      });
      if (!visible.ids.includes(normalizedDatasource)) {
        throw new DomainError(
          "DATASOURCE_ACCESS_DENIED",
          "当前工作空间未绑定该数据源或无访问权限。",
          403,
          {
            workspaceId: normalizedWorkspaceId,
            datasourceId: normalizedDatasource,
            actorId: accessContext.actorId
          }
        );
      }
    }

    const datasourceMeta = await this.datasourceService.assertDatasourceAvailable(
      normalizedDatasource
    );
    let defaultModel:
      | {
          id: string;
          provider: string;
          model: string;
        }
      | undefined;
    if (modelCatalogId) {
      const resolved = await this.providerCatalog.resolveModelById(modelCatalogId);
      defaultModel = {
        id: resolved.id,
        provider: resolved.provider,
        model: resolved.model
      };
    } else {
      try {
        const resolved = await this.providerCatalog.resolveDefaultModel();
        defaultModel = {
          id: resolved.id,
          provider: resolved.provider,
          model: resolved.model
        };
      } catch {
        defaultModel = undefined;
      }
    }

    const session: Session = {
      id: uuidv4(),
      datasource: normalizedDatasource,
      workspaceId: normalizedWorkspaceId ?? null,
      createdByUserId: normalizedCreatedByUserId ?? null,
      datasourceName: datasourceMeta.name,
      datasourceType: datasourceMeta.type,
      datasourceStatus: this.normalizeDatasourceStatus(datasourceMeta.status),
      createdAt: new Date().toISOString(),
      title: "新会话",
      modelCatalogId: defaultModel?.id ?? null,
      modelProvider: defaultModel?.provider ?? null,
      modelName: defaultModel?.model ?? null,
      debugEnabled: false,
      syncStatus: "healthy",
      syncFailedCount: 0,
      lastSyncFailureAt: null
    };
    await this.repository.createSession(session);
    return this.mergeDatasourceMetadata(session, datasourceMeta);
  }

  async listSessions(
    status?: SessionSyncStatus,
    datasource?: string,
    view: SessionListView = "all",
    options?: {
      workspaceId?: string;
    }
  ): Promise<Session[]> {
    const normalizedDatasource = datasource?.trim() || undefined;
    const normalizedWorkspaceId = options?.workspaceId?.trim() || undefined;
    if (view === "current" && !normalizedDatasource) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "view=current 时 datasource 为必填项",
        400,
        { view, field: "datasource" }
      );
    }
    if (view === "current" && normalizedDatasource) {
      await this.datasourceService.getDatasourceOrThrow(normalizedDatasource);
    }

    const sessions = await this.repository.listSessions({
      datasource: view === "readonly-history" ? undefined : normalizedDatasource,
      statuses: status ? [status] : undefined,
      workspaceId: normalizedWorkspaceId
    });
    const normalized = await Promise.all(
      sessions.map(async (session) => this.mergeDatasourceMetadata(session))
    );

    if (view === "readonly-history") {
      const readonly: Session[] = [];
      for (const session of normalized) {
        const datasourceStatus = this.normalizeDatasourceStatus(
          session.datasourceStatus
        );
        if (datasourceStatus === "unavailable" || datasourceStatus === "deleted") {
          readonly.push(session);
          continue;
        }
        if (session.workspaceId) {
          const stillBound =
            await this.workspaceDatasourcePolicyRepository.isDatasourceBound(
              session.workspaceId,
              session.datasource
            );
          if (!stillBound) {
            readonly.push(session);
          }
        }
      }
      return readonly;
    }

    if (view === "current") {
      const current: Session[] = [];
      for (const session of normalized) {
        if (session.datasource !== normalizedDatasource) {
          continue;
        }
        if (this.normalizeDatasourceStatus(session.datasourceStatus) !== "available") {
          continue;
        }
        if (session.workspaceId) {
          const stillBound =
            await this.workspaceDatasourcePolicyRepository.isDatasourceBound(
              session.workspaceId,
              session.datasource
            );
          if (!stillBound) {
            continue;
          }
        }
        current.push(session);
      }
      return current;
    }

    return normalized;
  }

  async updateSession(
    sessionId: string,
    patch: {
      title?: string;
      debugEnabled?: boolean;
      modelCatalogId?: string;
    }
  ): Promise<Session> {
    const sanitizedPatch: {
      title?: string;
      debugEnabled?: boolean;
      modelCatalogId?: string;
      modelProvider?: string;
      modelName?: string;
    } = {};

    if (patch.title !== undefined) {
      const normalizedTitle = patch.title.trim();
      if (!normalizedTitle) {
        throw new DomainError("VALIDATION_ERROR", "会话标题不能为空", 400, {
          sessionId
        });
      }
      sanitizedPatch.title = normalizedTitle;
    }
    if (patch.debugEnabled !== undefined) {
      sanitizedPatch.debugEnabled = patch.debugEnabled;
    }
    if (patch.modelCatalogId !== undefined) {
      const modelId = patch.modelCatalogId.trim();
      if (!modelId) {
        throw new DomainError("VALIDATION_ERROR", "模型 ID 不能为空", 400, {
          sessionId
        });
      }
      const model = await this.providerCatalog.resolveModelById(modelId);
      sanitizedPatch.modelCatalogId = model.id;
      sanitizedPatch.modelProvider = model.provider;
      sanitizedPatch.modelName = model.model;
    }

    const session = await this.repository.updateSession(sessionId, sanitizedPatch);
    if (!session) {
      throw new DomainError("SESSION_NOT_FOUND", "会话不存在", 404, { sessionId });
    }
    return session;
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = await this.repository.softDeleteSession(sessionId);
    if (!session) {
      throw new DomainError("SESSION_NOT_FOUND", "会话不存在", 404, { sessionId });
    }
    await this.redisBuffer.clearBufferedMessages(sessionId);
  }

  async probeModelConnectivity(modelCatalogId: string): Promise<{
    ok: boolean;
    provider: string;
    model: string;
    latencyMs: number;
  }> {
    const normalizedModelId = modelCatalogId.trim();
    if (!normalizedModelId) {
      throw new DomainError("VALIDATION_ERROR", "模型 ID 不能为空", 400, {
        modelCatalogId
      });
    }

    const startedAt = Date.now();
    try {
      const draft = await this.providerRouter.generate(MODEL_PROBE_PROMPT, {
        modelCatalogId: normalizedModelId
      });
      const responseText = draft.rawText.trim().toUpperCase();
      if (!responseText) {
        throw new DomainError(
          "MODEL_PROBE_EMPTY",
          "模型探活返回为空响应，请稍后重试。",
          502,
          {
            modelCatalogId: normalizedModelId
          }
        );
      }
      return {
        ok: true,
        provider: draft.provider,
        model: draft.model,
        latencyMs: Date.now() - startedAt
      };
    } catch (error) {
      if (error instanceof DomainError) {
        throw new DomainError(
          "MODEL_UNREACHABLE",
          `模型连通性检测失败：${error.message}`,
          409,
          {
            modelCatalogId: normalizedModelId,
            latencyMs: Date.now() - startedAt,
            reasonCode: error.code
          }
        );
      }
      throw new DomainError(
        "MODEL_UNREACHABLE",
        `模型连通性检测失败：${error instanceof Error ? error.message : String(error)}`,
        409,
        {
          modelCatalogId: normalizedModelId,
          latencyMs: Date.now() - startedAt
        }
      );
    }
  }

  private async mergeDatasourceMetadata(
    session: Session,
    resolvedDatasource?: Datasource
  ): Promise<Session> {
    const datasource =
      resolvedDatasource ??
      (await this.datasourceService.getDatasourceById(session.datasource, {
        includeDeleted: true
      }));

    if (!datasource) {
      return {
        ...session,
        datasourceStatus: "deleted"
      };
    }

    return {
      ...session,
      datasourceName: datasource.name,
      datasourceType: datasource.type,
      datasourceStatus: this.normalizeDatasourceStatus(datasource.status)
    };
  }

  private normalizeDatasourceStatus(
    status: string | undefined | null
  ): "available" | "unavailable" | "deleted" {
    const normalized = status?.toLowerCase();
    if (normalized === "available") {
      return "available";
    }
    if (normalized === "deleted") {
      return "deleted";
    }
    if (
      normalized === "unavailable" ||
      normalized === "offline" ||
      normalized === "disconnected"
    ) {
      return "unavailable";
    }
    return "unavailable";
  }
}
