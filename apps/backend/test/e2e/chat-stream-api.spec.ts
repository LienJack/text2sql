import { resolve } from "node:path";
import { INestApplication } from "@nestjs/common";
import type { ChatStreamEvent } from "@text2sql/shared-types";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";

interface ParsedSseEvent {
  eventType: string;
  event: ChatStreamEvent;
}

const INTERMEDIATE_EVENT_TYPES = new Set([
  "state",
  "text-delta",
  "tool-call",
  "tool-result",
  "tool-error"
]);

function parseSseEvents(payload: string): ParsedSseEvent[] {
  const blocks = payload
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean);

  const events: ParsedSseEvent[] = [];
  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const eventLine = lines.find((line) => line.startsWith("event:"));
    const dataLines = lines.filter((line) => line.startsWith("data:"));
    if (!eventLine || dataLines.length === 0) {
      continue;
    }

    const eventType = eventLine.replace(/^event:\s*/, "").trim();
    const dataText = dataLines
      .map((line) => line.replace(/^data:\s*/, ""))
      .join("\n");
    const event = JSON.parse(dataText) as ChatStreamEvent;
    events.push({
      eventType,
      event
    });
  }

  return events;
}

describe("chat stream api (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.SQLITE_PATH = resolve(
      __dirname,
      "../../../../data/sqlite/text2sql.db"
    );
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "true";
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("should stream chat events via sse endpoint", async () => {
    const sessionRes = await request(app.getHttpServer())
      .post("/api/v1/sessions")
      .send({ datasource: "sqlite_main" });
    const sessionId = sessionRes.body.data.id as string;

    const streamRes = await request(app.getHttpServer())
      .post(`/api/v1/sessions/${sessionId}/messages/stream`)
      .send({ message: "统计订单状态分布" });

    expect(streamRes.status).toBe(200);
    expect(streamRes.headers["content-type"]).toContain("text/event-stream");
    const parsedEvents = parseSseEvents(streamRes.text);
    expect(parsedEvents.length).toBeGreaterThanOrEqual(2);

    const eventTypes = parsedEvents.map(({ eventType }) => eventType);
    const startIndex = eventTypes.indexOf("start");
    const finishIndex = eventTypes.lastIndexOf("finish");
    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(finishIndex).toBeGreaterThan(startIndex);

    const betweenStartAndFinish = eventTypes.slice(startIndex + 1, finishIndex);
    expect(
      betweenStartAndFinish.some((type) => INTERMEDIATE_EVENT_TYPES.has(type))
    ).toBe(true);
    expect(eventTypes.slice(finishIndex + 1)).not.toContain("start");

    const runIds = new Set(parsedEvents.map(({ event }) => event.runId));
    expect(runIds.size).toBe(1);
    const [streamRunId] = Array.from(runIds);
    expect(streamRunId).toBeTruthy();

    for (const { eventType, event } of parsedEvents) {
      expect(eventType).toBe(event.type);
      expect(event.sessionId).toBe(sessionId);
      expect(typeof event.runId).toBe("string");
      expect(event.runId.length).toBeGreaterThan(0);
      expect(typeof event.at).toBe("string");
      expect(Number.isNaN(Date.parse(event.at))).toBe(false);
      expect(event).toHaveProperty("data");
    }

    const startEvent = parsedEvents[startIndex]?.event;
    expect(startEvent).toBeDefined();
    expect(startEvent?.type).toBe("start");
    expect(startEvent?.data).toHaveProperty("requestId");

    const stateEvents = parsedEvents.filter(({ eventType }) => eventType === "state");
    for (const { event } of stateEvents) {
      const stateData = event.data as {
        node: unknown;
        status: unknown;
        detail: unknown;
        sequence?: unknown;
        stepId?: unknown;
        lifecycle?: unknown;
      };
      expect(typeof stateData.node).toBe("string");
      expect(["success", "failed", "skipped"]).toContain(stateData.status);
      expect(typeof stateData.detail).toBe("string");
      if (stateData.sequence !== undefined) {
        expect(typeof stateData.sequence).toBe("number");
        expect(stateData.sequence as number).toBeGreaterThan(0);
      }
      if (stateData.stepId !== undefined) {
        expect(typeof stateData.stepId).toBe("string");
      }
      if (stateData.lifecycle !== undefined) {
        expect(["running", "completed", "failed", "skipped"]).toContain(
          stateData.lifecycle
        );
      }
    }

    const textDeltaEvents = parsedEvents.filter(
      ({ eventType }) => eventType === "text-delta"
    );
    expect(textDeltaEvents.length).toBeGreaterThan(0);
    expect(
      textDeltaEvents.some(({ event }) => {
        const text = (event.data as { text?: string }).text ?? "";
        return text.trim().length > 0;
      })
    ).toBe(true);

    const finishEvent = parsedEvents[finishIndex]?.event;
    expect(finishEvent).toBeDefined();
    expect(finishEvent?.type).toBe("finish");
    const finishData = (finishEvent?.data ?? {}) as {
      status: unknown;
      rowCount: unknown;
    };
    expect(typeof finishData.status).toBe("string");
    expect(typeof finishData.rowCount).toBe("number");
    expect(finishData.rowCount as number).toBeGreaterThanOrEqual(0);

    const messagesRes = await request(app.getHttpServer())
      .get(`/api/v1/sessions/${sessionId}/messages`)
      .send();
    expect(messagesRes.status).toBe(200);
    expect(messagesRes.body.data.latestRun).toBeTruthy();
    expect(messagesRes.body.data.latestRun.runId).toBe(streamRunId);
    expect(messagesRes.body.data.latestRun.sessionId).toBe(sessionId);
    expect(messagesRes.body.data.latestRun.trace.streamStatus).toBe("completed");
  });
});
