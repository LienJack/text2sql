import { Injectable } from "@nestjs/common";
import type { ChatMessage, SqlRun } from "@text2sql/shared-types";
import { v4 as uuidv4 } from "uuid";
import { RedisBufferService } from "../../../../platform/data/cache/index";
import { ChatRepository } from "../../../../platform/data/persistence/index";

export interface ChatRunPersistenceInput {
  sessionId: string;
  run: SqlRun;
  userPrimaryPersisted: boolean;
}

@Injectable()
export class ChatRunPersistenceService {
  constructor(
    private readonly redisBuffer: RedisBufferService,
    private readonly repository: ChatRepository
  ) {}

  async persistAssistantAndRun(input: ChatRunPersistenceInput): Promise<void> {
    const assistantMessage: ChatMessage = {
      id: uuidv4(),
      sessionId: input.sessionId,
      role: "assistant",
      content: input.run.answer ?? input.run.error ?? "系统未返回结果。",
      metadata: {
        runId: input.run.runId,
        status: input.run.status
      },
      createdAt: new Date().toISOString()
    };
    await this.redisBuffer.bufferMessage(assistantMessage);
    const assistantPersistResult = await this.repository.persistMessage(assistantMessage);
    await this.repository.persistRun(input.run);

    const allPrimaryPersisted =
      input.userPrimaryPersisted && assistantPersistResult.primaryPersisted;
    if (allPrimaryPersisted) {
      await this.redisBuffer.clearBufferedMessages(input.sessionId);
      await this.repository.markSessionSyncHealthy(input.sessionId);
    } else {
      await this.repository.markSessionSyncPending(
        input.sessionId,
        new Date().toISOString()
      );
    }
  }
}
