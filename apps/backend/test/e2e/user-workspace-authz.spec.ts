import { resolve } from "node:path";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { requestActorMiddleware } from "../../src/modules/auth/request-actor.middleware";
import { requestIdMiddleware } from "../../src/modules/middleware/request-id.middleware";

describe("user/workspace authz (e2e)", () => {
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

  it("blocks non-admin user-management writes", async () => {
    const createUser = await request(app.getHttpServer())
      .post("/api/v1/system/users")
      .set("x-user-id", "plain-user")
      .set("x-user-role", "user")
      .send({
        account: "no-perm-user",
        name: "No Perm",
        email: "no-perm@example.com",
        variables: []
      });

    expect(createUser.status).toBe(403);
    expect(readErrorMessage(createUser.body)).toContain("仅管理员可执行该操作");
  });

  it("enforces workspace-admin scope boundaries", async () => {
    const createWorkspaceA = await request(app.getHttpServer())
      .post("/api/v1/system/workspaces")
      .set("x-user-id", "admin-authz")
      .set("x-user-role", "admin")
      .send({ name: "权限空间-A" });
    const workspaceA = createWorkspaceA.body.data.id as string;

    const createWorkspaceB = await request(app.getHttpServer())
      .post("/api/v1/system/workspaces")
      .set("x-user-id", "admin-authz")
      .set("x-user-role", "admin")
      .send({ name: "权限空间-B" });
    const workspaceB = createWorkspaceB.body.data.id as string;

    const seedWorkspaceAdmin = await request(app.getHttpServer())
      .post(`/api/v1/system/workspaces/${workspaceA}/members`)
      .set("x-user-id", "admin-authz")
      .set("x-user-role", "admin")
      .send({
        userId: "workspace-admin-a",
        role: "admin",
        displayName: "Workspace Admin A"
      });
    expect(seedWorkspaceAdmin.body.status).toBe("success");

    const scopedWriteAllowed = await request(app.getHttpServer())
      .post(`/api/v1/system/workspaces/${workspaceA}/members`)
      .set("x-user-id", "workspace-admin-a")
      .set("x-user-role", "user")
      .send({
        userId: "workspace-member-a1",
        role: "member",
        displayName: "Workspace Member A1"
      });
    expect(scopedWriteAllowed.body.status).toBe("success");

    const scopedWriteRejected = await request(app.getHttpServer())
      .post(`/api/v1/system/workspaces/${workspaceB}/members`)
      .set("x-user-id", "workspace-admin-a")
      .set("x-user-role", "user")
      .send({
        userId: "workspace-member-b1",
        role: "member"
      });
    expect(scopedWriteRejected.body.status).toBe("error");
    expect(scopedWriteRejected.body.error.code).toBe("FORBIDDEN");
  });

  it("keeps user API admin-only even for workspace admins", async () => {
    const scopedUserApiCall = await request(app.getHttpServer())
      .get("/api/v1/system/users")
      .set("x-user-id", "workspace-admin-a")
      .set("x-user-role", "user")
      .send();

    expect(scopedUserApiCall.status).toBe(403);
    expect(readErrorMessage(scopedUserApiCall.body)).toContain("仅管理员可执行该操作");
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
