import { Injectable } from "@nestjs/common";
import type {
  ChatStreamEvent,
  ChatSessionView,
  ChatMessage,
  ExecutionTrace,
  ExecutionTraceStep,
  Session,
  SessionSyncStatus,
  SqlRun
} from "@text2sql/shared-types";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "../../common/domain-error";
import { GraphBuilderService } from "../agent/graph/graph.builder";
import { ClarifyNode } from "../agent/nodes/clarify.node";
import { ExecuteSqlNode } from "../agent/nodes/execute-sql.node";
import { FormatAnswerNode } from "../agent/nodes/format-answer.node";
import { SafetyCheckNode } from "../agent/nodes/safety-check.node";
import { RedisBufferService } from "../data/cache/redis-buffer.service";
import { ChatRepository } from "../data/persistence/chat.repository";
import { ProviderRouterService } from "../llm/provider-router.service";
import { ProviderCatalogService } from "../llm/provider-catalog.service";
import { ToolEventsMapper } from "../llm/tools/tool-events.mapper";
import { ToolRegistryService } from "../llm/tools/tool-registry.service";
import { TraceService } from "../observability/trace.service";

@Injectable()
export class ChatService {
  constructor(
    private readonly graphBuilder: GraphBuilderService,
    private readonly clarifyNode: ClarifyNode,
    private readonly safetyNode: SafetyCheckNode,
    private readonly executeNode: ExecuteSqlNode,
    private readonly formatNode: FormatAnswerNode,
    private readonly redisBuffer: RedisBufferService,
    private readonly repository: ChatRepository,
    private readonly providerCatalog: ProviderCatalogService,
    private readonly providerRouter: ProviderRouterService,
    private readonly toolRegistry: ToolRegistryService,
    private readonly toolEventsMapper: ToolEventsMapper,
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

    await this.persistAssistantAndRun(sessionId, run, userPersistResult.primaryPersisted);
    return run;
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

    const emit = async (
      type: ChatStreamEvent["type"],
      data?: ChatStreamEvent["data"]
    ) => {
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

    const traceSteps: ExecutionTraceStep[] = [];
    const toolCalls: NonNullable<ExecutionTrace["toolCalls"]> = [];
    const appendStep = (
      node: string,
      status: ExecutionTraceStep["status"],
      detail: string,
      extra?: Partial<ExecutionTraceStep>
    ) => {
      traceSteps.push({
        node,
        status,
        detail,
        at: new Date().toISOString(),
        ...extra
      });
    };

    const clarification = this.clarifyNode.run(message);
    if (clarification) {
      appendStep("clarify", "success", clarification.reason, {
        outputSummary: clarification.question
      });
      const run: SqlRun = {
        runId,
        sessionId,
        question: message,
        status: "clarification",
        provider: session.modelProvider ?? "unknown",
        model: session.modelName ?? undefined,
        answer: clarification.question,
        clarification,
        trace: {
          runId,
          provider: session.modelProvider ?? "unknown",
          retryCount: 0,
          steps: traceSteps,
          streamStatus: "completed",
          toolCalls
        },
        llmRaw: null,
        createdAt: new Date().toISOString()
      };
      await emit("finish", {
        status: run.status
      });
      await this.persistAssistantAndRun(sessionId, run, userPersistResult.primaryPersisted);
      return run;
    }

    appendStep("clarify", "skipped", "问题信息充足，跳过澄清。");

    try {
      const draft = await this.providerRouter.streamSql(
        message,
        {
          modelCatalogId: session.modelCatalogId ?? undefined
        },
        {
          tools: this.toolRegistry.getTools(),
          onEvent: async (event) => {
            if (event.type === "text-delta") {
              await emit("text-delta", event.payload);
              return;
            }
            const mappedStep = this.toolEventsMapper.toTraceStep(event);
            if (mappedStep) {
              traceSteps.push(mappedStep);
            }
            if (
              event.type === "tool-call" ||
              event.type === "tool-result" ||
              event.type === "tool-error"
            ) {
              const payload = event.payload as {
                toolName?: string;
                toolCallId?: string;
                output?: unknown;
                input?: unknown;
                message?: string;
              };
              toolCalls.push({
                toolName: payload.toolName ?? "unknown",
                toolCallId: payload.toolCallId ?? "unknown",
                status:
                  event.type === "tool-call"
                    ? "called"
                    : event.type === "tool-result"
                      ? "result"
                      : "error",
                detail:
                  typeof payload.message === "string"
                    ? payload.message
                    : JSON.stringify(payload.output ?? payload.input ?? payload),
                at: new Date().toISOString()
              });
            }
            await emit(event.type, event.payload);
          }
        }
      );

      appendStep("generate-sql", "success", draft.provider, {
        outputSummary: draft.sql
      });

      const safety = this.safetyNode.run(draft.sql);
      if (!safety.safe) {
        appendStep("safety-check", "failed", safety.reason, {
          errorSummary: safety.reason
        });
        const run: SqlRun = {
          runId,
          sessionId,
          question: message,
          status: "rejected",
          provider: draft.provider,
          model: draft.model,
          sql: draft.sql,
          explanation: draft.explanation,
          error: safety.reason,
          trace: {
            runId,
            provider: draft.provider,
            retryCount: 0,
            steps: traceSteps,
            streamStatus: "failed",
            toolCalls
          },
          llmRaw: {
            provider: draft.provider,
            model: draft.model,
            rawText: draft.rawText,
            createdAt: new Date().toISOString()
          },
          createdAt: new Date().toISOString()
        };
        await emit("error", safety.reason);
        await this.persistAssistantAndRun(
          sessionId,
          run,
          userPersistResult.primaryPersisted
        );
        return run;
      }

      appendStep("safety-check", "success", "SQL 通过只读校验。");
      const execution = await this.executeNode.run(draft.sql);
      appendStep("execute-sql", "success", `rows=${execution.rows.length}`, {
        outputSummary: JSON.stringify({
          rowCount: execution.rows.length,
          columns: execution.columns
        })
      });
      const answer = this.formatNode.run(
        message,
        execution.rows,
        execution.columns
      );
      appendStep("format-answer", "success", "结果已格式化。", {
        outputSummary: answer
      });

      const run: SqlRun = {
        runId,
        sessionId,
        question: message,
        status: "executionResult",
        provider: draft.provider,
        model: draft.model,
        sql: draft.sql,
        explanation: draft.explanation,
        answer,
        rows: execution.rows,
        columns: execution.columns,
        trace: {
          runId,
          provider: draft.provider,
          retryCount: 0,
          steps: traceSteps,
          streamStatus: "completed",
          toolCalls
        },
        llmRaw: {
          provider: draft.provider,
          model: draft.model,
          rawText: draft.rawText,
          createdAt: new Date().toISOString()
        },
        createdAt: new Date().toISOString()
      };

      await emit("finish", {
        status: run.status,
        rowCount: run.rows?.length ?? 0
      });
      await this.persistAssistantAndRun(sessionId, run, userPersistResult.primaryPersisted);
      return run;
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      appendStep("generate-sql", "failed", messageText, {
        errorSummary: messageText
      });
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
          steps: traceSteps,
          streamStatus: "failed",
          toolCalls
        },
        llmRaw: null,
        createdAt: new Date().toISOString()
      };
      await emit("error", messageText);
      await this.persistAssistantAndRun(sessionId, run, userPersistResult.primaryPersisted);
      return run;
    }
  }

  async listMessages(
    sessionId: string,
    page = 1,
    pageSize = 50
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
    pageSize = 50
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
    this.traceService.record(run.trace);

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
}
