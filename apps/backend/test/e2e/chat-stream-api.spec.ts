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

    const nonFinishEvents = parsedEvents.filter(
      ({ eventType }) => eventType !== "finish"
    );
    for (const { event } of nonFinishEvents) {
      const dataWithCompat = event.data as Record<string, unknown>;
      expect(dataWithCompat.delivery).toBeUndefined();
    }

    const startEvent = parsedEvents[startIndex]?.event;
    expect(startEvent).toBeDefined();
    expect(startEvent?.type).toBe("start");
    expect(startEvent?.data).toHaveProperty("requestId");

    const stateEvents = parsedEvents.filter(({ eventType }) => eventType === "state");
    const runningGenerateIndex = parsedEvents.findIndex(({ eventType, event }) => {
      const stateData = event.data as {
        node?: unknown;
        lifecycle?: unknown;
      };
      return (
        eventType === "state" &&
        stateData.node === "generate-sql" &&
        stateData.lifecycle === "running"
      );
    });
    expect(runningGenerateIndex).toBeGreaterThan(startIndex);
    for (const { event } of stateEvents) {
      const stateData = event.data as {
        node: unknown;
        status: unknown;
        detail: unknown;
        sequence?: unknown;
        stepId?: unknown;
        lifecycle?: unknown;
        v2?: {
          stageArtifact?: {
            stage?: string;
            status?: string;
            metadata?: {
              taskProfile?: string;
              reasoningTier?: string;
              policySource?: string;
            };
          };
        };
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
      if (stateData.v2?.stageArtifact) {
        expect([
          "intake",
          "retrieve",
          "assemble-context",
          "semantic-plan",
          "generate-sql",
          "validate",
          "correct",
          "execute",
          "answer"
        ]).toContain(stateData.v2.stageArtifact.stage);
        expect([
          "success",
          "failed",
          "skipped",
          "degraded",
          "clarification"
        ]).toContain(stateData.v2.stageArtifact.status);
        const stageMetadata = stateData.v2.stageArtifact.metadata;
        expect(typeof stageMetadata?.taskProfile).toBe("string");
        expect(typeof stageMetadata?.reasoningTier).toBe("string");
        expect(typeof stageMetadata?.policySource).toBe("string");
      }
    }

    expect(
      stateEvents.some(({ event }) => {
        const stateData = event.data as {
          v2?: {
            stageArtifact?: {
              stage?: string;
            };
          };
        };
        return typeof stateData.v2?.stageArtifact?.stage === "string";
      })
    ).toBe(true);

    const textDeltaEvents = parsedEvents.filter(
      ({ eventType }) => eventType === "text-delta"
    );
    const firstTextDeltaIndex = eventTypes.indexOf("text-delta");
    expect(runningGenerateIndex).toBeLessThan(firstTextDeltaIndex);
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
      delivery?: {
        answer?: {
          text?: string;
          status?: string;
        };
        artifact?: {
          summary?: {
            text?: string;
          };
          table?: {
            rowCount?: number;
          };
          rowCount?: number;
          validation?: {
            status?: string;
          };
          display?: string;
        };
        evidence?: {
          runId?: string;
          contextPackStatus?: string;
          contextPackSummary?: {
            status?: string;
            selectedEvidenceCount?: number;
          };
          v2?: {
            stageArtifacts?: Array<{ stage?: string }>;
          };
        };
      };
    };
    expect(typeof finishData.status).toBe("string");
    expect(typeof finishData.rowCount).toBe("number");
    expect(finishData.rowCount as number).toBeGreaterThanOrEqual(0);
    expect(finishData.delivery?.answer?.status).toBe(finishData.status);
    expect(finishData.delivery?.artifact?.summary?.text).toBeTruthy();
    expect(finishData.delivery?.artifact?.table?.rowCount).toBe(
      finishData.delivery?.artifact?.rowCount
    );
    expect(finishData.delivery?.artifact?.validation?.status).toBeTruthy();
    expect(finishData.delivery?.artifact?.display).toBeTruthy();
    expect(finishData.delivery?.evidence?.runId).toBe(streamRunId);
    const contextPackStatus = finishData.delivery?.evidence?.contextPackStatus;
    if (contextPackStatus !== undefined) {
      expect(["ready", "degraded"]).toContain(contextPackStatus);
    }
    const streamContextPackSummary = finishData.delivery?.evidence?.contextPackSummary as
      | {
          status?: string;
          selectedEvidenceCount?: number;
        }
      | undefined;
    if (streamContextPackSummary) {
      expect(["ready", "degraded"]).toContain(streamContextPackSummary.status);
      expect(typeof streamContextPackSummary.selectedEvidenceCount).toBe("number");
    }
    const deliveryV2 = finishData.delivery?.evidence?.v2 as
      | {
          stageArtifacts?: Array<{ stage?: string }>;
        }
      | undefined;
    if (deliveryV2 !== undefined) {
      expect(deliveryV2.stageArtifacts?.map((item) => item.stage)).toEqual([
        "intake",
        "retrieve",
        "assemble-context",
        "semantic-plan",
        "generate-sql",
        "validate",
        "correct",
        "execute",
        "answer"
      ]);
    }

    const messagesRes = await request(app.getHttpServer())
      .get(`/api/v1/sessions/${sessionId}/messages`)
      .send();
    expect(messagesRes.status).toBe(200);
    expect(messagesRes.body.data.latestRun).toBeTruthy();
    const latestRun = messagesRes.body.data.latestRun as {
      runId: string;
      sessionId: string;
      error?: string | null;
      trace: {
        streamStatus?: string;
      };
    };
    expect(latestRun.runId).toBe(streamRunId);
    expect(latestRun.sessionId).toBe(sessionId);
    expect(messagesRes.body.data.latestRun.answer).toBe(
      messagesRes.body.data.latestRun.delivery.answer.text
    );
    expect(messagesRes.body.data.latestRun.delivery.evidence.runId).toBe(streamRunId);
    if (streamContextPackSummary) {
      expect(
        messagesRes.body.data.latestRun.delivery.evidence.contextPackSummary
      ).toEqual(streamContextPackSummary);
    }
    expect(["completed", "failed"]).toContain(latestRun.trace.streamStatus);
    const latestTraceV2 = (messagesRes.body.data.latestRun.trace?.v2 ?? null) as
      | {
          version?: string;
        }
      | null;
    if (latestTraceV2) {
      expect(latestTraceV2.version).toBe("v2");
    }
    if (latestRun.trace.streamStatus === "failed") {
      expect(typeof latestRun.error).toBe("string");
      expect(latestRun.error?.trim().length).toBeGreaterThan(0);
      expect(eventTypes).toContain("error");
    }
  });

  it("keeps rejected stream runs in safe delivery semantics without chart artifact", async () => {
    const sessionRes = await request(app.getHttpServer())
      .post("/api/v1/sessions")
      .send({ datasource: "sqlite_main" });
    const sessionId = sessionRes.body.data.id as string;

    const streamRes = await request(app.getHttpServer())
      .post(`/api/v1/sessions/${sessionId}/messages/stream`)
      .send({ message: "DELETE orders where id = 1" });

    expect(streamRes.status).toBe(200);
    const parsedEvents = parseSseEvents(streamRes.text);
    const finishEvent = [...parsedEvents]
      .reverse()
      .find(({ eventType }) => eventType === "finish")?.event;
    expect(finishEvent).toBeDefined();

    const finishData = (finishEvent?.data ?? {}) as {
      status?: string;
      delivery?: {
        answer?: {
          status?: string;
        };
        artifact?: {
          chart?: unknown;
          display?: string;
        };
      };
    };

    expect(finishData.status).toBe("rejected");
    expect(finishData.delivery?.answer?.status).toBe("rejected");
    expect(finishData.delivery?.artifact?.chart).toBeUndefined();
    expect(finishData.delivery?.artifact?.display).not.toBe("metric");
    expect(finishData.delivery?.artifact?.display).not.toBe("bar");
    expect(finishData.delivery?.artifact?.display).not.toBe("line");
    expect(finishData.delivery?.artifact?.display).not.toBe("pie");
  });

  it("should accept optional contextEnvelope on stream message endpoint", async () => {
    const sessionRes = await request(app.getHttpServer())
      .post("/api/v1/sessions")
      .send({ datasource: "sqlite_main" });
    const sessionId = sessionRes.body.data.id as string;

    const streamRes = await request(app.getHttpServer())
      .post(`/api/v1/sessions/${sessionId}/messages/stream`)
      .send({
        message: "统计华东区已支付订单净销售额",
        contextEnvelope: {
          metricDefinition: "净销售额=订单金额-退款金额",
          timeRange: {
            from: "2026-01-01",
            to: "2026-03-31",
            timezone: "Asia/Shanghai"
          },
          entityMappings: [
            {
              entity: "华东区",
              mappedTo: "region=east_china"
            }
          ],
          mustIncludeTables: ["orders"],
          mustExcludeTables: ["internal_audit_logs"],
          businessConstraints: ["仅统计已支付订单"]
        }
      });

    expect(streamRes.status).toBe(200);
    expect(streamRes.headers["content-type"]).toContain("text/event-stream");

    const parsedEvents = parseSseEvents(streamRes.text);
    expect(parsedEvents.length).toBeGreaterThanOrEqual(2);
    expect(parsedEvents.some(({ eventType }) => eventType === "start")).toBe(true);
    expect(parsedEvents.some(({ eventType }) => eventType === "finish")).toBe(true);
  });

  it("should reject invalid contextEnvelope boundary on stream message endpoint", async () => {
    const sessionRes = await request(app.getHttpServer())
      .post("/api/v1/sessions")
      .send({ datasource: "sqlite_main" });
    const sessionId = sessionRes.body.data.id as string;

    const invalidRes = await request(app.getHttpServer())
      .post(`/api/v1/sessions/${sessionId}/messages/stream`)
      .send({
        message: "统计订单",
        contextEnvelope: {
          metricDefinition: "x".repeat(301)
        }
      });

    expect(invalidRes.status).toBe(400);
    expect(invalidRes.headers["content-type"]).toContain("application/json");
    expect(invalidRes.body.statusCode).toBe(400);
    expect(invalidRes.body.error).toBe("Bad Request");
    expect(Array.isArray(invalidRes.body.message)).toBe(true);
    expect(
      (invalidRes.body.message as string[]).some((item) =>
        item.includes("contextEnvelope.metricDefinition")
      )
    ).toBe(true);
  });
});
