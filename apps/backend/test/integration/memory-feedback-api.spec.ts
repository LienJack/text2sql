import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { KNOWLEDGE_MEMORY_COMPAT_BRIDGE } from "../../src/modules/knowledge/memory/memory.module";
import {
  assertKnowledgeCompatBridgeRetirementReady,
  KNOWLEDGE_COMPAT_BRIDGE_RETIREMENT_WINDOW
} from "../../src/modules/knowledge/rag/rag.module";
import { createSeededSqliteFixture } from "../support/sqlite-fixture";

function withActor(
  req: request.Test,
  role: "admin" | "user"
): request.Test {
  return req.set("x-user-role", role).set("x-user-id", `itest-${role}`);
}

describe("memory feedback api integration", () => {
  let app: INestApplication;
  let cleanupFixture: (() => Promise<void>) | undefined;

  const createRunId = async (): Promise<string> => {
    const sessionRes = await withActor(
      request(app.getHttpServer()).post("/api/v1/sessions"),
      "admin"
    ).send({
      datasource: "sqlite_main"
    });
    expect(sessionRes.status).toBe(201);
    const sessionId = sessionRes.body.data.id as string;

    const messageRes = await withActor(
      request(app.getHttpServer()).post(`/api/v1/sessions/${sessionId}/messages`),
      "admin"
    ).send({
      message: "统计订单状态分布"
    });
    expect(messageRes.status).toBe(201);
    return messageRes.body.data.run.runId as string;
  };

  beforeAll(async () => {
    const fixture = await createSeededSqliteFixture("memory-feedback-api");
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

  it("allows admin to submit memory feedback", async () => {
    const runId = await createRunId();

    const res = await withActor(
      request(app.getHttpServer()).post("/api/v1/rag/memory/feedback"),
      "admin"
    ).send({
      runId,
      targetStatus: "verified",
      note: "manual verify"
    });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("success");
    expect(res.body.data.runId).toBe(runId);
    expect(res.body.data.afterStatus).toBe("verified");
  });

  it("returns 403 for non-admin feedback requests", async () => {
    const runId = await createRunId();

    const res = await withActor(
      request(app.getHttpServer()).post("/api/v1/rag/memory/feedback"),
      "user"
    ).send({
      runId,
      targetStatus: "verified"
    });

    expect(res.status).toBe(403);
    expect(res.body.statusCode).toBe(403);
    expect(res.body.message).toContain("仅管理员可执行该操作");
  });

  it("returns 404 for unknown run ids", async () => {
    const res = await withActor(
      request(app.getHttpServer()).post("/api/v1/rag/memory/feedback"),
      "admin"
    ).send({
      runId: "run-not-exist",
      targetStatus: "verified"
    });

    expect(res.status).toBe(404);
    expect(res.body.status).toBe("error");
    expect(res.body.error.code).toBe("RUN_NOT_FOUND");
  });

  it("returns 409 for downgrade conflicts", async () => {
    const runId = await createRunId();
    const promoteRes = await withActor(
      request(app.getHttpServer()).post("/api/v1/rag/memory/feedback"),
      "admin"
    ).send({
      runId,
      targetStatus: "production"
    });
    expect(promoteRes.status).toBe(201);

    const conflictRes = await withActor(
      request(app.getHttpServer()).post("/api/v1/rag/memory/feedback"),
      "admin"
    ).send({
      runId,
      targetStatus: "candidate"
    });

    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.status).toBe("error");
    expect(conflictRes.body.error.code).toBe("MEMORY_FEEDBACK_CONFLICT");
  });

  it("allows memory bridge retirement once prerequisites are met", () => {
    expect(KNOWLEDGE_MEMORY_COMPAT_BRIDGE.removeBy).toBe(
      KNOWLEDGE_COMPAT_BRIDGE_RETIREMENT_WINDOW
    );
    expect(() =>
      assertKnowledgeCompatBridgeRetirementReady("memory", {
        conversationImportsClosed: true,
        boundaryGatePassed: true,
        keyRegressionsPassed: true
      })
    ).not.toThrow();
  });
});
