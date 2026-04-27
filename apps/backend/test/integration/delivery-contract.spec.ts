import { INestApplication } from "@nestjs/common";
import type { ChatStreamEvent } from "@text2sql/shared-types";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { DeliveryContractMapper } from "../../src/modules/conversation/delivery/delivery-contract.mapper";
import { createSeededSqliteFixture } from "../support/sqlite-fixture";

interface ParsedSseEvent {
  eventType: string;
  event: ChatStreamEvent;
}

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

describe("delivery contract integration", () => {
  let app: INestApplication;
  let cleanupFixture: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const fixture = await createSeededSqliteFixture("delivery-contract");
    cleanupFixture = fixture.cleanup;
    process.env.SQLITE_PATH = fixture.dbPath;
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "true";

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (cleanupFixture) {
      await cleanupFixture();
    }
  });

  it("keeps sync response and stream finish payload contract-consistent", async () => {
    const sessionRes = await request(app.getHttpServer())
      .post("/api/v1/sessions")
      .send({ datasource: "sqlite_main" });
    expect(sessionRes.status).toBe(201);
    const sessionId = sessionRes.body.data.id as string;

    const syncRes = await request(app.getHttpServer())
      .post(`/api/v1/sessions/${sessionId}/messages`)
      .send({ message: "统计订单状态分布" });
    expect(syncRes.status).toBe(201);
    expect(syncRes.body.data.delivery).toBeTruthy();
    expect(syncRes.body.data.run.delivery).toEqual(syncRes.body.data.delivery);
    expect(syncRes.body.data.delivery.answer).toBeTruthy();
    expect(syncRes.body.data.run.answer).toBe(syncRes.body.data.delivery.answer.text);
    expect(syncRes.body.data.delivery.evidence.runId).toBe(
      syncRes.body.data.run.runId as string
    );
    const syncArtifact = syncRes.body.data.delivery.artifact as
      | {
          rowCount: number;
          summary?: { text?: string };
          table?: {
            rowCount?: number;
          };
          validation?: {
            status?: string;
          };
          display?: string;
        }
      | undefined;
    expect(syncArtifact).toBeTruthy();
    expect(syncArtifact?.summary?.text).toBe(syncRes.body.data.run.answer);
    expect(syncArtifact?.table?.rowCount).toBe(syncArtifact?.rowCount);
    expect(syncArtifact?.validation?.status).toBeTruthy();
    expect(syncArtifact?.display).toBeTruthy();

    const streamRes = await request(app.getHttpServer())
      .post(`/api/v1/sessions/${sessionId}/messages/stream`)
      .send({ message: "统计订单状态分布" });
    expect(streamRes.status).toBe(200);
    const events = parseSseEvents(streamRes.text);
    const finish = [...events].reverse().find((item) => item.eventType === "finish");
    expect(finish).toBeDefined();

    const finishData = (finish?.event.data ?? {}) as {
      status: string;
      rowCount: number;
      delivery?: Record<string, unknown>;
    };
    expect(typeof finishData.status).toBe("string");
    expect(typeof finishData.rowCount).toBe("number");
    expect(finishData.delivery).toBeTruthy();
    expect(finishData.delivery).toHaveProperty("answer");
    expect(finishData.delivery).toHaveProperty("evidence");
    expect((finishData.delivery as { answer?: { text?: string } }).answer?.text).toBe(
      syncRes.body.data.run.answer
    );
    expect((finishData.delivery as { artifact?: { summary?: { text?: string } } }).artifact?.summary?.text).toBeTruthy();
    expect(
      (finishData.delivery as { evidence?: { runId?: string } }).evidence?.runId
    ).toBe(finish?.event.runId);
    const syncContextPackSummary = (
      syncRes.body.data.delivery?.evidence?.contextPackSummary as
        | Record<string, unknown>
        | undefined
    );
    if (syncContextPackSummary) {
      expect(
        (finishData.delivery as { evidence?: { contextPackSummary?: unknown } }).evidence
          ?.contextPackSummary
      ).toEqual(syncContextPackSummary);
    }

    const messagesRes = await request(app.getHttpServer())
      .get(`/api/v1/sessions/${sessionId}/messages`)
      .send();
    expect(messagesRes.status).toBe(200);
    expect(messagesRes.body.data.latestRun).toBeTruthy();
    expect(messagesRes.body.data.latestRun.runId).toBe(finish?.event.runId);
    expect(messagesRes.body.data.latestRun.delivery.answer).toEqual(
      (finishData.delivery as { answer?: unknown })?.answer
    );
    expect(messagesRes.body.data.latestRun.delivery.artifact).toEqual(
      (finishData.delivery as { artifact?: unknown })?.artifact
    );
    expect(messagesRes.body.data.latestRun.answer).toBe(
      messagesRes.body.data.latestRun.delivery.answer.text
    );
    expect(messagesRes.body.data.latestRun.delivery.evidence.runId).toBe(
      finish?.event.runId
    );
  });

  it("falls back with delivery_mapper_failed when mapper throws", async () => {
    const mapper = app.get(DeliveryContractMapper);
    const mapSpy = jest.spyOn(mapper, "map").mockImplementation(() => {
      throw new Error("mapper exploded");
    });

    const sessionRes = await request(app.getHttpServer())
      .post("/api/v1/sessions")
      .send({ datasource: "sqlite_main" });
    expect(sessionRes.status).toBe(201);
    const sessionId = sessionRes.body.data.id as string;

    const syncRes = await request(app.getHttpServer())
      .post(`/api/v1/sessions/${sessionId}/messages`)
      .send({ message: "统计订单状态分布" });
    expect(syncRes.status).toBe(201);
    expect(syncRes.body.data.delivery.evidence.riskTags).toEqual(
      expect.arrayContaining(["delivery_mapper_failed"])
    );
    expect(syncRes.body.data.run.answer).toBe(syncRes.body.data.delivery.answer.text);
    expect(syncRes.body.data.run.delivery.evidence.riskTags).toEqual(
      expect.arrayContaining(["delivery_mapper_failed"])
    );

    const streamRes = await request(app.getHttpServer())
      .post(`/api/v1/sessions/${sessionId}/messages/stream`)
      .send({ message: "统计订单状态分布" });
    expect(streamRes.status).toBe(200);
    const events = parseSseEvents(streamRes.text);
    const finish = [...events].reverse().find((item) => item.eventType === "finish");
    expect(finish).toBeDefined();
    const finishData = (finish?.event.data ?? {}) as {
      delivery?: {
        evidence?: {
          riskTags?: string[];
        };
      };
    };
    expect(finishData.delivery?.evidence?.riskTags).toEqual(
      expect.arrayContaining(["delivery_mapper_failed"])
    );

    mapSpy.mockRestore();
  });
});
