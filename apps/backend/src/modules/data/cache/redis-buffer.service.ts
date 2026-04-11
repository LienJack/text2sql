import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import type { ChatMessage } from "@text2sql/shared-types";
import { AppConfigService } from "../../config/app-config.service";

@Injectable()
export class RedisBufferService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisBufferService.name);
  private readonly inMemoryBuffer = new Map<string, ChatMessage[]>();
  private redis?: Redis;
  private readonly redisPrefix = "text2sql:session:";
  private readonly sessionBufferTtlSeconds = 12 * 60 * 60;

  constructor(private readonly appConfig: AppConfigService) {
    if (this.appConfig.redisUrl) {
      this.redis = new Redis(this.appConfig.redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1
      });
      this.redis.on("error", (error) => {
        this.logger.warn(`Redis 连接异常，降级为内存模式: ${error.message}`);
      });
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.redis) {
      return true;
    }
    try {
      if (
        this.redis.status === "connecting" ||
        this.redis.status === "connect" ||
        this.redis.status === "reconnecting"
      ) {
        return true;
      }
      await this.ensureConnected();
      await this.redis.ping();
      return true;
    } catch {
      return false;
    }
  }

  async bufferMessage(message: ChatMessage): Promise<void> {
    if (!this.redis) {
      const list = this.inMemoryBuffer.get(message.sessionId) ?? [];
      if (!list.some((item) => item.id === message.id)) {
        list.push(message);
      }
      this.inMemoryBuffer.set(message.sessionId, list);
      return;
    }
    try {
      await this.ensureConnected();
      const serialized = JSON.stringify(message);
      await this.redis.rpush(
        this.pendingKey(message.sessionId),
        serialized
      );
      await this.redis.expire(this.pendingKey(message.sessionId), this.sessionBufferTtlSeconds);
      await this.redis.expire(
        this.processingKey(message.sessionId),
        this.sessionBufferTtlSeconds
      );
    } catch (error) {
      this.logger.warn(
        `Redis 写入失败，回退内存缓冲: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      const list = this.inMemoryBuffer.get(message.sessionId) ?? [];
      if (!list.some((item) => item.id === message.id)) {
        list.push(message);
      }
      this.inMemoryBuffer.set(message.sessionId, list);
    }
  }

  async getBufferedMessages(sessionId: string): Promise<ChatMessage[]> {
    if (!this.redis) {
      return this.inMemoryBuffer.get(sessionId) ?? [];
    }
    try {
      await this.ensureConnected();
      const [pendingValues, processingValues] = await Promise.all([
        this.redis.lrange(this.pendingKey(sessionId), 0, -1),
        this.redis.lrange(this.processingKey(sessionId), 0, -1)
      ]);
      return [...pendingValues, ...processingValues].map(
        (value) => JSON.parse(value) as ChatMessage
      );
    } catch {
      return this.inMemoryBuffer.get(sessionId) ?? [];
    }
  }

  async claimMessagesForRetry(
    sessionId: string,
    batchSize = 20
  ): Promise<Array<{ raw: string; message: ChatMessage }>> {
    if (!this.redis) {
      const list = this.inMemoryBuffer.get(sessionId) ?? [];
      return list.slice(0, batchSize).map((message) => ({
        raw: JSON.stringify(message),
        message
      }));
    }
    try {
      await this.ensureConnected();
      const claimed: Array<{ raw: string; message: ChatMessage }> = [];
      for (let i = 0; i < batchSize; i += 1) {
        const raw = await this.redis.lmove(
          this.pendingKey(sessionId),
          this.processingKey(sessionId),
          "RIGHT",
          "LEFT"
        );
        if (!raw) {
          break;
        }
        claimed.push({
          raw,
          message: JSON.parse(raw) as ChatMessage
        });
      }
      return claimed;
    } catch (error) {
      this.logger.warn(
        `Redis claim 失败，回退内存重试: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      const list = this.inMemoryBuffer.get(sessionId) ?? [];
      return list.slice(0, batchSize).map((message) => ({
        raw: JSON.stringify(message),
        message
      }));
    }
  }

  async ackRetriedMessage(sessionId: string, raw: string): Promise<void> {
    if (!this.redis) {
      const list = this.inMemoryBuffer.get(sessionId) ?? [];
      const message = JSON.parse(raw) as ChatMessage;
      this.inMemoryBuffer.set(
        sessionId,
        list.filter((item) => item.id !== message.id)
      );
      return;
    }
    try {
      await this.ensureConnected();
      await this.redis.lrem(this.processingKey(sessionId), 1, raw);
    } catch {
      // ignore ack failures in v1
    }
  }

  async releaseRetriedMessage(sessionId: string, raw: string): Promise<void> {
    if (!this.redis) {
      const list = this.inMemoryBuffer.get(sessionId) ?? [];
      const message = JSON.parse(raw) as ChatMessage;
      if (!list.some((item) => item.id === message.id)) {
        list.push(message);
      }
      this.inMemoryBuffer.set(sessionId, list);
      return;
    }
    try {
      await this.ensureConnected();
      await this.redis.lrem(this.processingKey(sessionId), 1, raw);
      await this.redis.rpush(this.pendingKey(sessionId), raw);
      await this.redis.expire(this.pendingKey(sessionId), this.sessionBufferTtlSeconds);
      await this.redis.expire(
        this.processingKey(sessionId),
        this.sessionBufferTtlSeconds
      );
    } catch {
      // ignore release failures in v1
    }
  }

  async clearBufferedMessages(sessionId: string): Promise<void> {
    this.inMemoryBuffer.delete(sessionId);
    if (!this.redis) {
      return;
    }
    try {
      await this.ensureConnected();
      await this.redis.del(
        this.pendingKey(sessionId),
        this.processingKey(sessionId)
      );
    } catch {
      // ignore clear failures in v1
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
    }
  }

  private async ensureConnected(): Promise<void> {
    if (!this.redis) {
      return;
    }
    if (
      this.redis.status === "ready" ||
      this.redis.status === "connect" ||
      this.redis.status === "connecting"
    ) {
      return;
    }
    try {
      await this.redis.connect();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("already connecting") ||
        message.includes("already connected")
      ) {
        return;
      }
      throw error;
    }
  }

  private pendingKey(sessionId: string): string {
    return `${this.redisPrefix}${sessionId}:pending`;
  }

  private processingKey(sessionId: string): string {
    return `${this.redisPrefix}${sessionId}:processing`;
  }
}
