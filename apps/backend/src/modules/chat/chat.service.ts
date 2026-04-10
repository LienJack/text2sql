import { Injectable } from "@nestjs/common";
import type {
  ChatSessionView,
  ChatMessage,
  Session,
  SessionSyncStatus,
  SqlRun
} from "@text2sql/shared-types";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "../../common/domain-error";
import { GraphBuilderService } from "../agent/graph/graph.builder";
import { RedisBufferService } from "../data/cache/redis-buffer.service";
import { ChatRepository } from "../data/persistence/chat.repository";
import { TraceService } from "../observability/trace.service";

@Injectable()
export class ChatService {
  constructor(
    private readonly graphBuilder: GraphBuilderService,
    private readonly redisBuffer: RedisBufferService,
    private readonly repository: ChatRepository,
    private readonly traceService: TraceService
  ) {}

  async createSession(datasource = "sqlite_main"): Promise<Session> {
    const session: Session = {
      id: uuidv4(),
      datasource,
      createdAt: new Date().toISOString(),
      title: "新会话",
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
    }
  ): Promise<Session> {
    const sanitizedPatch: {
      title?: string;
      debugEnabled?: boolean;
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
      traceContext: {
        source: "chat",
        route: "/api/v1/sessions/:sessionId/messages",
        requestId
      }
    });

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
      userPersistResult.primaryPersisted && assistantPersistResult.primaryPersisted;
    if (allPrimaryPersisted) {
      await this.redisBuffer.clearBufferedMessages(sessionId);
      await this.repository.markSessionSyncHealthy(sessionId);
    } else {
      await this.repository.markSessionSyncPending(
        sessionId,
        new Date().toISOString()
      );
    }

    return run;
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
}
