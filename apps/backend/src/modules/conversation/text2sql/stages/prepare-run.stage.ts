import { Injectable } from "@nestjs/common";
import type {
  ChatMessage,
  ContextEnvelope,
  Datasource,
  Session
} from "@text2sql/shared-types";
import { v4 as uuidv4 } from "uuid";
import { DomainError } from "../../../../common/domain-error";
import { DatasourceService } from "../../../governance/datasource/datasource.service";
import { RedisBufferService } from "../../../platform/data/cache/index";
import { ChatRepository } from "../../../platform/data/persistence/index";
import {
  ChatPolicyGuardService,
  type ChatPolicyActorInput,
  type ChatSqlAccessContext
} from "../../chat/application/shared/chat-policy-guard.service";

export interface Text2SqlPrepareRunInput {
  sessionId: string;
  message: string;
  requestId?: string;
  contextEnvelope?: ContextEnvelope;
  actor?: ChatPolicyActorInput;
}

export interface Text2SqlPreparedRunContext {
  runId: string;
  session: Session;
  datasource: Datasource;
  sqlAccessContext?: ChatSqlAccessContext;
  question: string;
  requestId?: string;
  contextEnvelope?: ContextEnvelope;
  userPersistResult: {
    primaryPersisted: boolean;
  };
}

@Injectable()
export class PrepareRunStage {
  constructor(
    private readonly datasourceService: DatasourceService,
    private readonly redisBuffer: RedisBufferService,
    private readonly repository: ChatRepository,
    private readonly chatPolicyGuardService: ChatPolicyGuardService
  ) {}

  async run(input: Text2SqlPrepareRunInput): Promise<Text2SqlPreparedRunContext> {
    const session = await this.repository.getSessionById(input.sessionId);
    if (!session) {
      throw new DomainError("SESSION_NOT_FOUND", "会话不存在", 404, {
        sessionId: input.sessionId
      });
    }

    await this.chatPolicyGuardService.assertSessionWritableByPolicy(session);
    const datasource = await this.datasourceService.assertDatasourceAvailable(
      session.datasource
    );
    const sqlAccessContext = await this.chatPolicyGuardService.resolveSqlAccessContext(
      session,
      input.actor
    );

    const userMessage: ChatMessage = {
      id: uuidv4(),
      sessionId: input.sessionId,
      role: "user",
      content: input.message,
      createdAt: new Date().toISOString()
    };

    await this.redisBuffer.bufferMessage(userMessage);
    const userPersistResult = await this.repository.persistMessage(userMessage);
    await this.repository.ensureSessionTitleFromFirstMessage(
      input.sessionId,
      input.message
    );

    return {
      runId: uuidv4(),
      session,
      datasource,
      sqlAccessContext,
      question: input.message,
      requestId: input.requestId,
      contextEnvelope: input.contextEnvelope,
      userPersistResult
    };
  }
}
