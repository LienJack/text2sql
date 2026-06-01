import { Injectable } from "@nestjs/common";
import type {
  ChatMessage,
  ChatSessionView,
  ChatStreamEvent,
  ContextEnvelope,
  Session,
  SessionSyncStatus,
  SqlRun
} from "@text2sql/shared-types";
import { ExecuteMessageUsecase } from "./application/execute-message.usecase";
import { RunViewUsecase } from "./application/run-view.usecase";
import { SaveViewFromRunUsecase } from "./application/save-view-from-run.usecase";
import { SessionLifecycleUsecase } from "./application/session-lifecycle.usecase";
import { StreamMessageUsecase } from "./application/stream-message.usecase";
import type { SessionListView } from "./dto/list-sessions.dto";
import type { ChatPolicyActorInput } from "./application/shared/chat-policy-guard.service";

@Injectable()
export class ChatService {
  constructor(
    private readonly sessionLifecycleUsecase: SessionLifecycleUsecase,
    private readonly executeMessageUsecase: ExecuteMessageUsecase,
    private readonly streamMessageUsecase: StreamMessageUsecase,
    private readonly runViewUsecase: RunViewUsecase,
    private readonly saveViewFromRunUsecase: SaveViewFromRunUsecase
  ) {}

  createSession(
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
    return this.sessionLifecycleUsecase.createSession(
      datasource,
      modelCatalogId,
      options
    );
  }

  listSessions(
    status?: SessionSyncStatus,
    datasource?: string,
    view: SessionListView = "all",
    options?: {
      workspaceId?: string;
    }
  ): Promise<Session[]> {
    return this.sessionLifecycleUsecase.listSessions(
      status,
      datasource,
      view,
      options
    );
  }

  renameSession(sessionId: string, title: string): Promise<Session> {
    return this.updateSession(sessionId, { title: title.trim() });
  }

  updateSession(
    sessionId: string,
    patch: {
      title?: string;
      debugEnabled?: boolean;
      modelCatalogId?: string;
    }
  ): Promise<Session> {
    return this.sessionLifecycleUsecase.updateSession(sessionId, patch);
  }

  deleteSession(sessionId: string): Promise<void> {
    return this.sessionLifecycleUsecase.deleteSession(sessionId);
  }

  probeModelConnectivity(modelCatalogId: string): Promise<{
    ok: boolean;
    provider: string;
    model: string;
    latencyMs: number;
  }> {
    return this.sessionLifecycleUsecase.probeModelConnectivity(modelCatalogId);
  }

  sendMessage(
    sessionId: string,
    message: string,
    requestId?: string,
    contextEnvelope?: ContextEnvelope,
    actor?: ChatPolicyActorInput
  ): Promise<SqlRun> {
    return this.executeMessageUsecase.executeMessage({
      sessionId,
      message,
      requestId,
      contextEnvelope,
      actor
    });
  }

  streamMessage(
    sessionId: string,
    message: string,
    requestId: string | undefined,
    onEvent: (event: ChatStreamEvent) => Promise<void> | void,
    abortSignal?: AbortSignal,
    contextEnvelope?: ContextEnvelope,
    actor?: ChatPolicyActorInput
  ): Promise<SqlRun> {
    return this.streamMessageUsecase.streamMessage({
      sessionId,
      message,
      requestId,
      onEvent,
      abortSignal,
      contextEnvelope,
      actor
    });
  }

  listMessages(sessionId: string, page = 1, pageSize = 0): Promise<ChatMessage[]> {
    return this.runViewUsecase.listMessages({
      sessionId,
      page,
      pageSize
    });
  }

  getSessionView(
    sessionId: string,
    page = 1,
    pageSize = 0
  ): Promise<ChatSessionView> {
    return this.runViewUsecase.getSessionView({
      sessionId,
      page,
      pageSize
    });
  }

  getRunById(runId: string): Promise<SqlRun> {
    return this.runViewUsecase.getRunById(runId);
  }

  saveViewFromRun(input: {
    runId: string;
    name: string;
    displayName?: string;
    description?: string;
    actorId?: string;
  }): Promise<{
    stage: "chat_run_view_saved";
    workspaceId: string;
    datasourceId: string;
    runId: string;
    replayed: boolean;
    activeRevision?: number;
    draftRevision: number;
    view: {
      id: string;
      name: string;
      sql: string;
      displayName?: string | null;
      description?: string | null;
    };
  }> {
    return this.saveViewFromRunUsecase.execute(input);
  }
}
