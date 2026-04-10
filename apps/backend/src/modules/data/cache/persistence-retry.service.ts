import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { AppConfigService } from "../../config/app-config.service";
import { ChatRepository } from "../persistence/chat.repository";
import { RedisBufferService } from "./redis-buffer.service";

@Injectable()
export class PersistenceRetryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PersistenceRetryService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly retryIntervalMs = 30_000;
  private readonly retryBatchSize = 20;

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly repository: ChatRepository,
    private readonly redisBuffer: RedisBufferService
  ) {}

  onModuleInit(): void {
    if (!this.appConfig.databaseUrl) {
      return;
    }
    this.timer = setInterval(() => {
      void this.retryPendingMessages();
    }, this.retryIntervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async retryPendingMessages(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const sessions = await this.repository.listSessions({
        statuses: ["pending", "degraded"]
      });
      for (const session of sessions) {
        await this.retrySession(session.id);
      }
    } finally {
      this.running = false;
    }
  }

  private async retrySession(sessionId: string): Promise<void> {
    const claimed = await this.redisBuffer.claimMessagesForRetry(
      sessionId,
      this.retryBatchSize
    );
    if (claimed.length === 0) {
      const remaining = await this.redisBuffer.getBufferedMessages(sessionId);
      if (remaining.length === 0) {
        await this.repository.markSessionSyncHealthy(sessionId);
      }
      return;
    }

    let hasFailure = false;
    const failedAt = new Date().toISOString();
    for (const entry of claimed) {
      const result = await this.repository.persistMessage(entry.message);
      if (result.primaryPersisted) {
        await this.redisBuffer.ackRetriedMessage(sessionId, entry.raw);
      } else {
        hasFailure = true;
        await this.redisBuffer.releaseRetriedMessage(sessionId, entry.raw);
      }
    }

    if (hasFailure) {
      await this.repository.markSessionSyncPending(sessionId, failedAt);
      this.logger.warn(`会话 ${sessionId} 补偿重试失败，已保持待同步状态。`);
      return;
    }

    const remaining = await this.redisBuffer.getBufferedMessages(sessionId);
    if (remaining.length === 0) {
      await this.repository.markSessionSyncHealthy(sessionId);
    }
  }
}
