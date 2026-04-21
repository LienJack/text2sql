import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { requestActorMiddleware } from "../../src/modules/auth/request-actor.middleware";
import { requestIdMiddleware } from "../../src/modules/middleware/request-id.middleware";
import { UserModule } from "../../src/modules/governance/user/user.module";

type HeaderCarrier = {
  set: (field: string, value: string) => HeaderCarrier;
};

const asAdmin = <T extends HeaderCarrier>(carrier: T): T =>
  carrier
    .set("x-user-role", "admin")
    .set("x-user-id", "admin-e2e") as T;

describe("user api (e2e)", () => {
  let app: INestApplication;

  beforeEach(async () => {
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";

    const moduleFixture = await Test.createTestingModule({
      imports: [UserModule]
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

  afterEach(async () => {
    await app.close();
  });

  it("rejects non-admin requests", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/system/users").send();
    expect(res.status).toBe(403);
  });

  it("supports create, list filters, status toggle and reset-password", async () => {
    const createRes = await asAdmin(
      request(app.getHttpServer()).post("/api/v1/system/users")
    ).send({
      account: "alice",
      name: "Alice",
      email: "alice@example.com",
      status: "active",
      workspaceIds: ["workspace-sales"],
      variables: [
        {
          key: "region",
          value: "apac"
        }
      ]
    });

    expect(createRes.status).toBe(201);
    expect(createRes.body.status).toBe("success");
    expect(createRes.body.data.account).toBe("alice");
    expect(createRes.body.data.variables).toEqual([
      {
        key: "region",
        value: "apac"
      }
    ]);

    const userId = createRes.body.data.id as string;

    const statusRes = await asAdmin(
      request(app.getHttpServer()).patch(`/api/v1/system/users/${userId}/status`)
    ).send({
      status: "disabled"
    });
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.status).toBe("success");
    expect(statusRes.body.data.status).toBe("disabled");

    const resetRes = await asAdmin(
      request(app.getHttpServer()).post(
        `/api/v1/system/users/${userId}/reset-password`
      )
    ).send({});
    expect(resetRes.status).toBe(201);
    expect(resetRes.body.status).toBe("success");
    expect(resetRes.body.data.userId).toBe(userId);
    expect(typeof resetRes.body.data.temporaryPassword).toBe("string");

    const listRes = await asAdmin(
      request(app.getHttpServer()).get("/api/v1/system/users")
    ).query({
      page: 1,
      pageSize: 10,
      keyword: "ali",
      status: "disabled",
      workspaceId: "workspace-sales"
    });
    expect(listRes.status).toBe(200);
    expect(listRes.body.status).toBe("success");
    expect(listRes.body.data.total).toBe(1);
    expect(listRes.body.data.items[0].account).toBe("alice");
  });

  it("rejects account mutation on update", async () => {
    const createRes = await asAdmin(
      request(app.getHttpServer()).post("/api/v1/system/users")
    ).send({
      account: "bob",
      name: "Bob",
      email: "bob@example.com",
      variables: []
    });
    const userId = createRes.body.data.id as string;

    const updateRes = await asAdmin(
      request(app.getHttpServer()).patch(`/api/v1/system/users/${userId}`)
    ).send({
      account: "bob-new"
    });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.status).toBe("error");
    expect(updateRes.body.error.code).toBe("ACCOUNT_IMMUTABLE");
  });

  it("returns partial-success result for batch delete and protects default admin", async () => {
    const createRes = await asAdmin(
      request(app.getHttpServer()).post("/api/v1/system/users")
    ).send({
      account: "to-delete",
      name: "To Delete",
      email: "to-delete@example.com",
      variables: []
    });
    const deletableId = createRes.body.data.id as string;

    const listRes = await asAdmin(
      request(app.getHttpServer()).get("/api/v1/system/users")
    ).query({
      page: 1,
      pageSize: 20,
      keyword: "admin"
    });
    const defaultAdminId = listRes.body.data.items.find(
      (item: { account: string }) => item.account === "admin"
    )?.id as string;

    const batchRes = await asAdmin(
      request(app.getHttpServer()).post("/api/v1/system/users/batch-delete")
    ).send({
      userIds: [defaultAdminId, deletableId, "missing-user-id"]
    });

    expect(batchRes.status).toBe(201);
    expect(batchRes.body.status).toBe("success");
    expect(batchRes.body.data.successCount).toBe(1);
    expect(batchRes.body.data.failedCount).toBe(2);
    expect(batchRes.body.data.failedItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: defaultAdminId,
          code: "DEFAULT_ADMIN_PROTECTED"
        }),
        expect.objectContaining({
          userId: "missing-user-id",
          code: "USER_NOT_FOUND"
        })
      ])
    );
  });
});
