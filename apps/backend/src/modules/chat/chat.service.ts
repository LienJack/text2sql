import { Injectable } from "@nestjs/common";
import type { ChatMessage, Session, SqlRun } from "@text2sql/shared-types";
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
      createdAt: new Date().toISOString()
    };
    await this.repository.createSession(session);
    return session;
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
    await this.repository.persistMessage(userMessage);

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
    await this.repository.persistMessage(assistantMessage);
    await this.repository.persistRun(run);
    this.traceService.record(run.trace);
    await this.redisBuffer.clearBufferedMessages(sessionId);
    return run;
  }

  async listMessages(
    sessionId: string,
    page = 1,
    pageSize = 50
  ): Promise<ChatMessage[]> {
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

  async getRunById(runId: string): Promise<SqlRun> {
    const run = await this.repository.getRunById(runId);
    if (!run) {
      throw new DomainError("RUN_NOT_FOUND", "运行记录不存在", 404, { runId });
    }
    return run;
  }
}
