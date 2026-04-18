import { Injectable } from "@nestjs/common";
import type {
  ChatStreamEvent,
  ChatSessionView,
  ChatMessage,
  Datasource,
  ReasoningStage,
  Session,
  SessionSyncStatus,
  SqlRun
} from "@text2sql/shared-types";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "../../common/domain-error";
import { GraphBuilderService } from "../agent/graph/graph.builder";
import { SqlToolRegistryService } from "../agent/sql/tools/sql-tool-registry.service";
import {
  DeliveryContractMapper,
  type DeliveryReplayRecordInput
} from "../delivery/delivery-contract.mapper";
import {
  type AccessContext
} from "../auth/datasource-access-policy.service";
import { PolicyEvaluatorService } from "../auth/policy-evaluator.service";
import { RedisBufferService } from "../data/cache/redis-buffer.service";
import { ChatRepository } from "../data/persistence/chat.repository";
import { WorkspaceDatasourcePolicyRepository } from "../data/persistence/workspace-datasource-policy.repository";
import { DatasourceRegistryService } from "../datasource/datasource-registry.service";
import { ProviderCatalogService } from "../llm/provider-catalog.service";
import { ProviderRouterService } from "../llm/provider-router.service";
import { TraceService } from "../observability/trace.service";
import { RagReplayRepository } from "../rag/observability/rag-replay.repository";
import { DatasourceService } from "../datasource/datasource.service";
import { MemoryPromotionService } from "../memory/memory-promotion.service";
import type { SessionListView } from "./dto/list-sessions.dto";

const MODEL_PROBE_PROMPT = {
  systemPrompt: "You are a health check assistant. Reply with exactly OK.",
  userPrompt: "Reply with OK."
};

@Injectable()
export class ChatService {
  constructor(
    private readonly graphBuilder: GraphBuilderService,
    private readonly sqlToolRegistry: SqlToolRegistryService,
    private readonly redisBuffer: RedisBufferService,
    private readonly repository: ChatRepository,
    private readonly datasourceService: DatasourceService,
    private readonly policyEvaluatorService: PolicyEvaluatorService,
    private readonly workspaceDatasourcePolicyRepository: WorkspaceDatasourcePolicyRepository,
    private readonly datasourceRegistry: DatasourceRegistryService,
    private readonly providerCatalog: ProviderCatalogService,
    private readonly providerRouter: ProviderRouterService,
    private readonly traceService: TraceService,
    private readonly ragReplayRepository: RagReplayRepository,
    private readonly deliveryContractMapper: DeliveryContractMapper,
    private readonly memoryPromotionService: MemoryPromotionService
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

  async renameSession(sessionId: string, title: string): Promise<Session> {
    return this.updateSession(sessionId, { title: title.trim() });
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

  async sendMessage(
    sessionId: string,
    message: string,
    requestId?: string
  ): Promise<SqlRun> {
    const session = await this.repository.getSessionById(sessionId);
    if (!session) {
      throw new DomainError("SESSION_NOT_FOUND", "会话不存在", 404, { sessionId });
    }
    await this.assertSessionWritableByPolicy(session);
    const datasource = await this.datasourceService.assertDatasourceAvailable(
      session.datasource
    );
    const sqlAccessContext = await this.resolveSqlAccessContext(session);

    const userMessage: ChatMessage = {
      id: uuidv4(),
      sessionId,
      role: "user",
      content: message,
      createdAt: new Date().toISOString()
    };
    await this.redisBuffer.bufferMessage(userMessage);
    const userPersistResult = await this.repository.persistMessage(userMessage);
    await this.repository.ensureSessionTitleFromFirstMessage(sessionId, message);

    const run = await this.graphBuilder.run({
      runId: uuidv4(),
      sessionId,
      question: message,
      datasourceId: session.datasource,
      datasourceType: datasource.type,
      modelCatalogId: session.modelCatalogId ?? undefined,
      accessContext: sqlAccessContext,
      traceContext: {
        source: "chat",
        route: "/api/v1/sessions/:sessionId/messages",
        requestId
      }
    });

    const finalRun = this.applyRejectedFallback(run, session.datasource);
    const runWithDelivery = await this.attachDeliveryContract(finalRun);
    await this.persistAssistantAndRun(
      sessionId,
      runWithDelivery,
      userPersistResult.primaryPersisted
    );
    await this.triggerMemoryPromotion(session, runWithDelivery, requestId);
    return runWithDelivery;
  }

  async streamMessage(
    sessionId: string,
    message: string,
    requestId: string | undefined,
    onEvent: (event: ChatStreamEvent) => Promise<void> | void
  ): Promise<SqlRun> {
    const session = await this.repository.getSessionById(sessionId);
    if (!session) {
      throw new DomainError("SESSION_NOT_FOUND", "会话不存在", 404, { sessionId });
    }
    await this.assertSessionWritableByPolicy(session);
    const datasource = await this.datasourceService.assertDatasourceAvailable(
      session.datasource
    );
    const sqlAccessContext = await this.resolveSqlAccessContext(session);

    const runId = uuidv4();
    const userMessage: ChatMessage = {
      id: uuidv4(),
      sessionId,
      role: "user",
      content: message,
      createdAt: new Date().toISOString()
    };
    await this.redisBuffer.bufferMessage(userMessage);
    const userPersistResult = await this.repository.persistMessage(userMessage);
    await this.repository.ensureSessionTitleFromFirstMessage(sessionId, message);

    const emit = async (type: ChatStreamEvent["type"], data: ChatStreamEvent["data"]) => {
      await onEvent({
        type,
        runId,
        sessionId,
        at: new Date().toISOString(),
        data
      });
    };

    await emit("start", {
      requestId: requestId ?? null
    });

    const toolCalls: NonNullable<NonNullable<SqlRun["trace"]>["toolCalls"]> = [];
    let stepSequence = 0;

    try {
      const run = await this.graphBuilder.run(
        {
          runId,
          sessionId,
          question: message,
          datasourceId: session.datasource,
          datasourceType: datasource.type,
          modelCatalogId: session.modelCatalogId ?? undefined,
          accessContext: sqlAccessContext,
          traceContext: {
            source: "chat",
            route: "/api/v1/sessions/:sessionId/messages/stream",
            requestId
          }
        },
        {
          streamMode: true,
          tools: this.sqlToolRegistry.getToolsForDatasource(datasource, {
            accessContext: sqlAccessContext
          }),
          onLlmEvent: async (event) => {
            if (event.type === "text-delta") {
              await emit("text-delta", {
                text: event.text
              });
              return;
            }

            if (event.type === "tool-call") {
              toolCalls.push({
                toolName: event.toolName,
                toolCallId: event.toolCallId,
                status: "called",
                detail: JSON.stringify(event.input ?? {}),
                at: new Date().toISOString()
              });
              await emit("tool-call", {
                toolName: event.toolName,
                toolCallId: event.toolCallId,
                input: event.input
              });
              return;
            }

            if (event.type === "tool-result") {
              toolCalls.push({
                toolName: event.toolName,
                toolCallId: event.toolCallId,
                status: "result",
                detail: JSON.stringify(event.output ?? {}),
                at: new Date().toISOString()
              });
              await emit("tool-result", {
                toolName: event.toolName,
                toolCallId: event.toolCallId,
                output: event.output
              });
              return;
            }

            toolCalls.push({
              toolName: event.toolName,
              toolCallId: event.toolCallId,
              status: "error",
              detail: event.message,
              at: new Date().toISOString()
            });
            await emit("tool-error", {
              toolName: event.toolName,
              toolCallId: event.toolCallId,
              message: event.message
            });
          },
          onStep: async ({ step }) => {
            const streamSequence = step.sequence ?? stepSequence + 1;
            stepSequence = Math.max(stepSequence, streamSequence);
            const stepTimestamp = step.at ?? step.endedAt ?? step.startedAt ?? new Date().toISOString();
            await emit("state", {
              node: step.node,
              status: step.status,
              stepId: step.stepId ?? `${runId}:${step.node}:${streamSequence}`,
              sequence: streamSequence,
              lifecycle: step.lifecycle ?? this.resolveStepLifecycle(step.status),
              detail: step.detail ?? "",
              stage: this.resolveReasoningStage(step.node),
              title: this.resolveReasoningTitle(step.node),
              at: stepTimestamp,
              startedAt: step.startedAt,
              endedAt: step.endedAt,
              durationMs: step.durationMs,
              inputSummary: step.inputSummary,
              outputSummary: step.outputSummary,
              errorSummary: step.errorSummary
            });
          }
        }
      );

      const finalRun = this.applyRejectedFallback(run, session.datasource);
      finalRun.trace.streamStatus = finalRun.error ? "failed" : "completed";
      finalRun.trace.toolCalls = toolCalls;
      const runWithDelivery = await this.attachDeliveryContract(finalRun);
      if (runWithDelivery.error) {
        await emit("error", {
          code:
            runWithDelivery.status === "rejected" ? "SQL_READONLY_REJECTED" : undefined,
          message: runWithDelivery.error,
          details: null
        });
      }
      await emit("finish", {
        status: runWithDelivery.status,
        rowCount: runWithDelivery.rows?.length ?? 0,
        delivery: runWithDelivery.delivery
      });
      await this.persistAssistantAndRun(
        sessionId,
        runWithDelivery,
        userPersistResult.primaryPersisted
      );
      await this.triggerMemoryPromotion(session, runWithDelivery, requestId);
      return runWithDelivery;
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      const run: SqlRun = {
        runId,
        sessionId,
        question: message,
        status: "failed",
        provider: session.modelProvider ?? "unknown",
        model: session.modelName ?? undefined,
        error: messageText,
        trace: {
          runId,
          provider: session.modelProvider ?? "unknown",
          retryCount: 0,
          steps: [],
          streamStatus: "failed",
          toolCalls
        },
        llmRaw: null,
        createdAt: new Date().toISOString()
      };
      const domainError =
        error instanceof DomainError ? error : undefined;
      await emit("error", {
        code: domainError?.code,
        message: messageText,
        details: (domainError?.details as Record<string, unknown> | undefined) ?? null
      });
      const runWithDelivery = await this.attachDeliveryContract(run);
      await this.persistAssistantAndRun(
        sessionId,
        runWithDelivery,
        userPersistResult.primaryPersisted
      );
      await this.triggerMemoryPromotion(session, runWithDelivery, requestId);
      return runWithDelivery;
    }
  }

  async listMessages(
    sessionId: string,
    page = 1,
    pageSize = 0
  ): Promise<ChatMessage[]> {
    const session = await this.repository.getSessionById(sessionId);
    if (!session) {
      throw new DomainError("SESSION_NOT_FOUND", "会话不存在", 404, { sessionId });
    }
    const persisted = await this.repository.getMessages(sessionId, page, pageSize);
    const buffered = await this.redisBuffer.getBufferedMessages(sessionId);
    const merged = [...persisted, ...buffered];
    const unique = new Map<string, ChatMessage>();
    for (const message of merged) {
      unique.set(message.id, message);
    }
    return Array.from(unique.values()).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt)
    );
  }

  async getSessionView(
    sessionId: string,
    page = 1,
    pageSize = 0
  ): Promise<ChatSessionView> {
    const session = await this.repository.getSessionById(sessionId);
    if (!session) {
      throw new DomainError("SESSION_NOT_FOUND", "会话不存在", 404, { sessionId });
    }
    const messages = await this.listMessages(sessionId, page, pageSize);
    const latestRunRaw = await this.repository.getLatestRunBySessionId(sessionId);
    const latestRun = latestRunRaw
      ? await this.attachDeliveryContract(latestRunRaw)
      : undefined;
    return {
      session: await this.mergeDatasourceMetadata(session),
      messages,
      latestRun
    };
  }

  async getRunById(runId: string): Promise<SqlRun> {
    const run = await this.repository.getRunById(runId);
    if (!run) {
      throw new DomainError("RUN_NOT_FOUND", "运行记录不存在", 404, { runId });
    }
    const session = await this.repository.getSessionById(run.sessionId);
    if (!session) {
      throw new DomainError("RUN_NOT_FOUND", "运行记录不存在", 404, { runId });
    }
    return this.attachDeliveryContract(run);
  }

  private async assertSessionWritableByPolicy(session: Session): Promise<void> {
    const workspaceId = session.workspaceId?.trim();
    if (!workspaceId) {
      return;
    }
    const stillBound =
      await this.workspaceDatasourcePolicyRepository.isDatasourceBound(
        workspaceId,
        session.datasource
      );
    if (!stillBound) {
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
  }

  private async resolveSqlAccessContext(
    session: Session
  ): Promise<
    | {
        actorId: string;
        workspaceId: string;
        roleSet: string[];
        allowedTables: string[];
        allowedColumnsByTable: Record<string, string[]>;
        rowFiltersByTable: Record<string, string>;
        evaluatorMode: "workspace_table_permissions";
      }
    | undefined
  > {
    const workspaceId = session.workspaceId?.trim();
    const actorId = session.createdByUserId?.trim();
    if (!workspaceId || !actorId) {
      return undefined;
    }
    const context: AccessContext = await this.policyEvaluatorService.resolveAccessContext({
      actor: {
        id: actorId,
        role: "user",
        requestedWorkspaceId: workspaceId
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

  private async persistAssistantAndRun(
    sessionId: string,
    run: SqlRun,
    userPrimaryPersisted: boolean
  ): Promise<void> {
    const assistantMessage: ChatMessage = {
      id: uuidv4(),
      sessionId,
      role: "assistant",
      content: run.answer ?? run.error ?? "系统未返回结果。",
      metadata: {
        runId: run.runId,
        status: run.status
      },
      createdAt: new Date().toISOString()
    };
    await this.redisBuffer.bufferMessage(assistantMessage);
    const assistantPersistResult = await this.repository.persistMessage(assistantMessage);
    await this.repository.persistRun(run);
    this.traceService.record(run.trace, {
      status: run.status,
      error: run.error
    });

    const allPrimaryPersisted =
      userPrimaryPersisted && assistantPersistResult.primaryPersisted;
    if (allPrimaryPersisted) {
      await this.redisBuffer.clearBufferedMessages(sessionId);
      await this.repository.markSessionSyncHealthy(sessionId);
    } else {
      await this.repository.markSessionSyncPending(
        sessionId,
        new Date().toISOString()
      );
    }
  }

  private resolveReasoningStage(node: string): ReasoningStage {
    switch (node) {
      case "clarify":
        return "analysis";
      case "retrieve-knowledge":
      case "build-intent-plan":
      case "build-semantic-query":
      case "build-physical-plan":
        return "analysis";
      case "generate-sql":
        return "generation";
      case "safety-check":
        return "validation";
      case "execute-sql":
        return "execution";
      case "format-answer":
        return "response";
      default:
        return "unknown";
    }
  }

  private resolveReasoningTitle(node: string): string {
    switch (node) {
      case "clarify":
        return "理解问题";
      case "retrieve-knowledge":
        return "检索上下文";
      case "build-intent-plan":
        return "意图规划";
      case "build-semantic-query":
        return "语义规划";
      case "build-physical-plan":
        return "物理规划";
      case "generate-sql":
        return "生成 SQL";
      case "safety-check":
        return "安全校验";
      case "execute-sql":
        return "执行查询";
      case "format-answer":
        return "整理回答";
      default:
        return node;
    }
  }

  private resolveStepLifecycle(
    status: "success" | "failed" | "skipped"
  ): "completed" | "failed" | "skipped" {
    if (status === "failed") {
      return "failed";
    }
    if (status === "skipped") {
      return "skipped";
    }
    return "completed";
  }

  private async mergeDatasourceMetadata(
    session: Session,
    resolvedDatasource?: Datasource
  ): Promise<Session> {
    const datasource =
      resolvedDatasource ??
      (await this.datasourceService.getDatasourceById(
        session.datasource,
        {
          includeDeleted: true
        }
      ));

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
    if (normalized === "unavailable" || normalized === "offline" || normalized === "disconnected") {
      return "unavailable";
    }
    return "unavailable";
  }

  private applyRejectedFallback(run: SqlRun, datasource: string): SqlRun {
    if (run.status !== "rejected") {
      return run;
    }
    if (!this.datasourceRegistry.shouldFallbackOnReject(datasource)) {
      return run;
    }
    if (run.answer) {
      return run;
    }
    return {
      ...run,
      answer:
        "请求触发了只读安全策略，本次未执行 SQL。你可以改为查询统计口径或时间范围，我会继续协助。"
    };
  }

  private async attachDeliveryContract(run: SqlRun): Promise<SqlRun> {
    try {
      const replayRecords = await this.loadReplayRecords(run.runId);
      const delivery = this.deliveryContractMapper.map({
        run,
        replayRecords
      });
      return {
        ...run,
        delivery
      };
    } catch {
      return {
        ...run,
        delivery: this.deliveryContractMapper.buildFallback(
          run,
          "delivery_mapper_failed"
        )
      };
    }
  }

  private async loadReplayRecords(runId: string): Promise<DeliveryReplayRecordInput[]> {
    const records = await this.ragReplayRepository.listByRunId(runId);
    return records.map((item) => ({
      replayKey: item.replayKey,
      stage: item.stage,
      indexVersionId: item.indexVersionId,
      payload: item.payload,
      createdAt: item.createdAt
    }));
  }

  private async triggerMemoryPromotion(
    session: Session,
    run: SqlRun,
    requestId?: string
  ): Promise<void> {
    try {
      await this.memoryPromotionService.promoteFromRun({
        run,
        datasourceId: session.datasource,
        requestId
      });
    } catch {
      // memory promotion is additive and must not interrupt chat completion.
    }
  }
}
