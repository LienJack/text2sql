import { Injectable } from "@nestjs/common";
import type {
  ChatStreamEvent,
  ChatSessionView,
  ChatMessage,
  ReasoningStage,
  Session,
  SessionSyncStatus,
  SqlRun
} from "@text2sql/shared-types";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "../../common/domain-error";
import { GraphBuilderService } from "../agent/graph/graph.builder";
import { SqlToolRegistryService } from "../agent/sql/tools/sql-tool-registry.service";
import { RedisBufferService } from "../data/cache/redis-buffer.service";
import { ChatRepository } from "../data/persistence/chat.repository";
import { DatasourceRegistryService } from "../datasource/datasource-registry.service";
import { ProviderCatalogService } from "../llm/provider-catalog.service";
import { ProviderRouterService } from "../llm/provider-router.service";
import { TraceService } from "../observability/trace.service";

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
    private readonly datasourceRegistry: DatasourceRegistryService,
    private readonly providerCatalog: ProviderCatalogService,
    private readonly providerRouter: ProviderRouterService,
    private readonly traceService: TraceService
  ) {}

  async createSession(
    datasource = "sqlite_main",
    modelCatalogId?: string
  ): Promise<Session> {
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
      datasource,
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
    return session;
  }

  async listSessions(status?: SessionSyncStatus): Promise<Session[]> {
    return this.repository.listSessions({
      statuses: status ? [status] : undefined
    });
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
      modelCatalogId: session.modelCatalogId ?? undefined,
      traceContext: {
        source: "chat",
        route: "/api/v1/sessions/:sessionId/messages",
        requestId
      }
    });

    const finalRun = this.applyRejectedFallback(run, session.datasource);
    await this.persistAssistantAndRun(
      sessionId,
      finalRun,
      userPersistResult.primaryPersisted
    );
    return finalRun;
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
          modelCatalogId: session.modelCatalogId ?? undefined,
          traceContext: {
            source: "chat",
            route: "/api/v1/sessions/:sessionId/messages/stream",
            requestId
          }
        },
        {
          streamMode: true,
          tools: this.sqlToolRegistry.getTools(),
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
      if (finalRun.error) {
        await emit("error", {
          code: finalRun.status === "rejected" ? "SQL_READONLY_REJECTED" : undefined,
          message: finalRun.error,
          details: null
        });
      }
      await emit("finish", {
        status: finalRun.status,
        rowCount: finalRun.rows?.length ?? 0
      });
      await this.persistAssistantAndRun(
        sessionId,
        finalRun,
        userPersistResult.primaryPersisted
      );
      return finalRun;
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
      await this.persistAssistantAndRun(sessionId, run, userPersistResult.primaryPersisted);
      return run;
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
    const latestRun = await this.repository.getLatestRunBySessionId(sessionId);
    return {
      session,
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
    return run;
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
}
