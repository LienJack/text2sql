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
      list.push(message);
      this.inMemoryBuffer.set(message.sessionId, list);
      return;
    }
    try {
      await this.ensureConnected();
      await this.redis.rpush(
        `${this.redisPrefix}${message.sessionId}`,
        JSON.stringify(message)
      );
      await this.redis.expire(`${this.redisPrefix}${message.sessionId}`, 3600);
    } catch (error) {
      this.logger.warn(
        `Redis 写入失败，回退内存缓冲: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      const list = this.inMemoryBuffer.get(message.sessionId) ?? [];
      list.push(message);
      this.inMemoryBuffer.set(message.sessionId, list);
    }
  }

  async getBufferedMessages(sessionId: string): Promise<ChatMessage[]> {
    if (!this.redis) {
      return this.inMemoryBuffer.get(sessionId) ?? [];
    }
    try {
      await this.ensureConnected();
      const values = await this.redis.lrange(
        `${this.redisPrefix}${sessionId}`,
        0,
        -1
      );
      return values.map((value) => JSON.parse(value) as ChatMessage);
    } catch {
      return this.inMemoryBuffer.get(sessionId) ?? [];
    }
  }

  async clearBufferedMessages(sessionId: string): Promise<void> {
    this.inMemoryBuffer.delete(sessionId);
    if (!this.redis) {
      return;
    }
    try {
      await this.ensureConnected();
      await this.redis.del(`${this.redisPrefix}${sessionId}`);
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
}
