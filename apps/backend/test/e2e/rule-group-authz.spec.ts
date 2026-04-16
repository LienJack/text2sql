import { resolve } from "node:path";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { requestActorMiddleware } from "../../src/modules/auth/request-actor.middleware";
import { requestIdMiddleware } from "../../src/modules/middleware/request-id.middleware";

describe("rule group authz (e2e)", () => {
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
    app.use(requestIdMiddleware);
    app.use(requestActorMiddleware);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true
      })
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("keeps retired rule-group routes unavailable regardless of actor role", async () => {
    const server = app.getHttpServer();
    const probes = await Promise.all([
      request(server)
        .post("/api/v1/system/rule-groups")
        .set("x-user-id", "admin-rule-group-authz")
        .set("x-user-role", "admin")
        .send({ workspaceId: "ws-legacy", name: "legacy-group" }),
      request(server)
        .post("/api/v1/system/rule-groups")
        .set("x-user-id", "workspace-admin-only-rulegroup-a")
        .set("x-user-role", "user")
        .send({ workspaceId: "ws-legacy", name: "legacy-group" }),
      request(server)
        .get("/api/v1/system/rule-groups")
        .set("x-user-id", "workspace-member-legacy")
        .set("x-user-role", "user")
    ]);

    for (const response of probes) {
      expect(response.status).toBe(404);
      expect(readErrorMessage(response.body).toLowerCase()).toContain("cannot");
    }
  });
});

function readErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const record = payload as Record<string, unknown>;
  if (
    record.error &&
    typeof record.error === "object" &&
    "message" in record.error
  ) {
    const nested = record.error as Record<string, unknown>;
    if (typeof nested.message === "string") {
      return nested.message;
    }
  }
  if (typeof record.message === "string") {
    return record.message;
  }
  return "";
}
