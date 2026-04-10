import { PersistenceRetryService } from "../../src/modules/data/cache/persistence-retry.service";

describe("chat persistence retry", () => {
  it("should ack buffered messages and mark session healthy when retry succeeds", async () => {
    const repository = {
      listSessions: jest.fn().mockResolvedValue([
        { id: "session-1", syncStatus: "pending" }
      ]),
      persistMessage: jest.fn().mockResolvedValue({ primaryPersisted: true }),
      markSessionSyncHealthy: jest.fn(),
      markSessionSyncPending: jest.fn()
    };
    const redisBuffer = {
      claimMessagesForRetry: jest.fn().mockResolvedValue([
        {
          raw: "{\"id\":\"msg-1\"}",
          message: {
            id: "msg-1",
            sessionId: "session-1",
            role: "assistant",
            content: "ok",
            createdAt: "2026-04-10T00:00:00.000Z"
          }
        }
      ]),
      ackRetriedMessage: jest.fn(),
      releaseRetriedMessage: jest.fn(),
      getBufferedMessages: jest.fn().mockResolvedValue([])
    };
    const config = { databaseUrl: "postgres://localhost:5432/text2sql" };

    const service = new PersistenceRetryService(
      config as never,
      repository as never,
      redisBuffer as never
    );

    await service.retryPendingMessages();

    expect(repository.persistMessage).toHaveBeenCalledTimes(1);
    expect(redisBuffer.ackRetriedMessage).toHaveBeenCalledTimes(1);
    expect(repository.markSessionSyncHealthy).toHaveBeenCalledWith("session-1");
    expect(repository.markSessionSyncPending).not.toHaveBeenCalled();
  });

  it("should keep session pending when retry fails", async () => {
    const repository = {
      listSessions: jest.fn().mockResolvedValue([
        { id: "session-2", syncStatus: "pending" }
      ]),
      persistMessage: jest.fn().mockResolvedValue({ primaryPersisted: false }),
      markSessionSyncHealthy: jest.fn(),
      markSessionSyncPending: jest.fn()
    };
    const redisBuffer = {
      claimMessagesForRetry: jest.fn().mockResolvedValue([
        {
          raw: "{\"id\":\"msg-2\"}",
          message: {
            id: "msg-2",
            sessionId: "session-2",
            role: "assistant",
            content: "failed",
            createdAt: "2026-04-10T00:00:00.000Z"
          }
        }
      ]),
      ackRetriedMessage: jest.fn(),
      releaseRetriedMessage: jest.fn(),
      getBufferedMessages: jest.fn().mockResolvedValue([])
    };
    const config = { databaseUrl: "postgres://localhost:5432/text2sql" };

    const service = new PersistenceRetryService(
      config as never,
      repository as never,
      redisBuffer as never
    );

    await service.retryPendingMessages();

    expect(redisBuffer.releaseRetriedMessage).toHaveBeenCalledTimes(1);
    expect(repository.markSessionSyncPending).toHaveBeenCalledTimes(1);
    expect(repository.markSessionSyncHealthy).not.toHaveBeenCalled();
  });
});
