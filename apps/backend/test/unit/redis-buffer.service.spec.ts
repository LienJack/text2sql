import { RedisBufferService } from "../../src/modules/data/cache/redis-buffer.service";

describe("RedisBufferService (memory fallback)", () => {
  const appConfig = {
    redisUrl: ""
  };

  it("should buffer and clear messages in memory mode", async () => {
    const service = new RedisBufferService(appConfig as never);
    const message = {
      id: "msg-1",
      sessionId: "session-1",
      role: "user" as const,
      content: "hello",
      createdAt: "2026-04-10T00:00:00.000Z"
    };

    await service.bufferMessage(message);
    const buffered = await service.getBufferedMessages("session-1");
    expect(buffered).toHaveLength(1);
    expect(buffered[0]?.id).toBe("msg-1");

    await service.clearBufferedMessages("session-1");
    const cleared = await service.getBufferedMessages("session-1");
    expect(cleared).toHaveLength(0);
  });

  it("should claim and ack messages in memory mode", async () => {
    const service = new RedisBufferService(appConfig as never);
    const message = {
      id: "msg-2",
      sessionId: "session-2",
      role: "assistant" as const,
      content: "world",
      createdAt: "2026-04-10T00:00:00.000Z"
    };
    await service.bufferMessage(message);

    const claimed = await service.claimMessagesForRetry("session-2", 10);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.message.id).toBe("msg-2");

    await service.ackRetriedMessage("session-2", claimed[0]!.raw);
    const buffered = await service.getBufferedMessages("session-2");
    expect(buffered).toHaveLength(0);
  });
});
