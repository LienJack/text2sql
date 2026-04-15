import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { requestActorMiddleware } from "../../src/modules/auth/request-actor.middleware";
import { requestIdMiddleware } from "../../src/modules/middleware/request-id.middleware";
import { WorkspaceModule } from "../../src/modules/workspace/workspace.module";

describe("workspace api (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";

    const moduleFixture = await Test.createTestingModule({
      imports: [WorkspaceModule]
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

  it("supports workspace CRUD with admin boundary and default protection", async () => {
    const nonAdminCreate = await request(app.getHttpServer())
      .post("/api/v1/system/workspaces")
      .set("x-user-id", "plain-user")
      .set("x-user-role", "user")
      .send({
        name: "普通用户新建空间"
      });

    expect(nonAdminCreate.status).toBe(201);
    expect(nonAdminCreate.body.status).toBe("error");
    expect(nonAdminCreate.body.error.code).toBe("FORBIDDEN");

    const adminCreate = await request(app.getHttpServer())
      .post("/api/v1/system/workspaces")
      .set("x-user-id", "admin-e2e")
      .set("x-user-role", "admin")
      .send({
        name: "运营空间"
      });

    expect(adminCreate.status).toBe(201);
    expect(adminCreate.body.status).toBe("success");
    expect(adminCreate.body.data.name).toBe("运营空间");

    const workspaceId = adminCreate.body.data.id as string;

    const listRes = await request(app.getHttpServer())
      .get("/api/v1/system/workspaces")
      .set("x-user-id", "admin-e2e")
      .set("x-user-role", "admin");

    expect(listRes.status).toBe(200);
    expect(listRes.body.status).toBe("success");
    expect(
      listRes.body.data.items.some((item: { id: string }) => item.id === workspaceId)
    ).toBe(true);

    const defaultWorkspace = listRes.body.data.items.find(
      (item: { isDefault: boolean }) => item.isDefault
    ) as { id: string } | undefined;
    expect(defaultWorkspace).toBeDefined();

    const renameRes = await request(app.getHttpServer())
      .patch(`/api/v1/system/workspaces/${workspaceId}`)
      .set("x-user-id", "admin-e2e")
      .set("x-user-role", "admin")
      .send({
        name: "运营空间-已重命名"
      });

    expect(renameRes.status).toBe(200);
    expect(renameRes.body.status).toBe("success");
    expect(renameRes.body.data.name).toBe("运营空间-已重命名");

    const deleteDefaultRes = await request(app.getHttpServer())
      .delete(`/api/v1/system/workspaces/${defaultWorkspace?.id}`)
      .set("x-user-id", "admin-e2e")
      .set("x-user-role", "admin");

    expect(deleteDefaultRes.status).toBe(200);
    expect(deleteDefaultRes.body.status).toBe("error");
    expect(deleteDefaultRes.body.error.code).toBe("WORKSPACE_DEFAULT_PROTECTED");

    const deleteRes = await request(app.getHttpServer())
      .delete(`/api/v1/system/workspaces/${workspaceId}`)
      .set("x-user-id", "admin-e2e")
      .set("x-user-role", "admin");

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.status).toBe("success");
    expect(deleteRes.body.data.deleted).toBe(true);
    expect(deleteRes.body.data.workspaceId).toBe(workspaceId);
  });

  it("supports member management with scoped workspace-admin permissions", async () => {
    const createA = await request(app.getHttpServer())
      .post("/api/v1/system/workspaces")
      .set("x-user-id", "admin-e2e-2")
      .set("x-user-role", "admin")
      .send({ name: "空间-A" });
    const createB = await request(app.getHttpServer())
      .post("/api/v1/system/workspaces")
      .set("x-user-id", "admin-e2e-2")
      .set("x-user-role", "admin")
      .send({ name: "空间-B" });

    const workspaceA = createA.body.data.id as string;
    const workspaceB = createB.body.data.id as string;

    const seedWorkspaceAdmin = await request(app.getHttpServer())
      .post(`/api/v1/system/workspaces/${workspaceA}/members`)
      .set("x-user-id", "admin-e2e-2")
      .set("x-user-role", "admin")
      .send({
        userId: "ws-admin-a",
        role: "admin",
        displayName: "空间管理员A"
      });

    expect(seedWorkspaceAdmin.status).toBe(201);
    expect(seedWorkspaceAdmin.body.status).toBe("success");

    const addByWorkspaceAdmin = await request(app.getHttpServer())
      .post(`/api/v1/system/workspaces/${workspaceA}/members`)
      .set("x-user-id", "ws-admin-a")
      .set("x-user-role", "user")
      .send({
        userId: "member-a1",
        role: "member",
        displayName: "成员A1",
        email: "member-a1@example.com"
      });

    expect(addByWorkspaceAdmin.status).toBe(201);
    expect(addByWorkspaceAdmin.body.status).toBe("success");
    expect(addByWorkspaceAdmin.body.data.member.userId).toBe("member-a1");

    const forbiddenCrossWorkspace = await request(app.getHttpServer())
      .post(`/api/v1/system/workspaces/${workspaceB}/members`)
      .set("x-user-id", "ws-admin-a")
      .set("x-user-role", "user")
      .send({
        userId: "member-b1",
        role: "member"
      });

    expect(forbiddenCrossWorkspace.status).toBe(201);
    expect(forbiddenCrossWorkspace.body.status).toBe("error");
    expect(forbiddenCrossWorkspace.body.error.code).toBe("FORBIDDEN");

    const membersRes = await request(app.getHttpServer())
      .get(`/api/v1/system/workspaces/${workspaceA}/members`)
      .set("x-user-id", "ws-admin-a")
      .set("x-user-role", "user")
      .query({
        page: 1,
        pageSize: 1,
        keyword: "member-a1"
      });

    expect(membersRes.status).toBe(200);
    expect(membersRes.body.status).toBe("success");
    expect(membersRes.body.data.items).toHaveLength(1);
    expect(membersRes.body.data.pagination.total).toBe(1);

    const updateRoleRes = await request(app.getHttpServer())
      .patch(`/api/v1/system/workspaces/${workspaceA}/members/member-a1/role`)
      .set("x-user-id", "ws-admin-a")
      .set("x-user-role", "user")
      .send({ role: "admin" });

    expect(updateRoleRes.status).toBe(200);
    expect(updateRoleRes.body.status).toBe("success");
    expect(updateRoleRes.body.data.member.role).toBe("admin");

    const batchRemoveRes = await request(app.getHttpServer())
      .post(`/api/v1/system/workspaces/${workspaceA}/members/remove-batch`)
      .set("x-user-id", "ws-admin-a")
      .set("x-user-role", "user")
      .send({
        memberIds: ["member-a1", "missing-member"]
      });

    expect(batchRemoveRes.status).toBe(201);
    expect(batchRemoveRes.body.status).toBe("success");
    expect(batchRemoveRes.body.data.successCount).toBe(1);
    expect(batchRemoveRes.body.data.failedCount).toBe(1);
  });

  it("cleans members and applies fallback on workspace deletion", async () => {
    const createRes = await request(app.getHttpServer())
      .post("/api/v1/system/workspaces")
      .set("x-user-id", "admin-e2e-3")
      .set("x-user-role", "admin")
      .send({
        name: "即将删除空间"
      });

    const workspaceId = createRes.body.data.id as string;

    await request(app.getHttpServer())
      .post(`/api/v1/system/workspaces/${workspaceId}/members`)
      .set("x-user-id", "admin-e2e-3")
      .set("x-user-role", "admin")
      .send({
        userId: "orphan-on-delete",
        role: "member"
      });

    const listRes = await request(app.getHttpServer())
      .get("/api/v1/system/workspaces")
      .set("x-user-id", "admin-e2e-3")
      .set("x-user-role", "admin");
    const defaultWorkspace = listRes.body.data.items.find(
      (item: { isDefault: boolean }) => item.isDefault
    ) as { id: string };

    const deleteRes = await request(app.getHttpServer())
      .delete(`/api/v1/system/workspaces/${workspaceId}`)
      .set("x-user-id", "admin-e2e-3")
      .set("x-user-role", "admin");

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.status).toBe("success");
    expect(deleteRes.body.data.removedMemberCount).toBe(1);
    expect(deleteRes.body.data.reassignedUserIds).toEqual(["orphan-on-delete"]);
    expect(deleteRes.body.data.fallbackWorkspaceId).toBe(defaultWorkspace.id);

    const defaultMembers = await request(app.getHttpServer())
      .get(`/api/v1/system/workspaces/${defaultWorkspace.id}/members`)
      .set("x-user-id", "admin-e2e-3")
      .set("x-user-role", "admin")
      .query({ keyword: "orphan-on-delete" });

    expect(defaultMembers.status).toBe(200);
    expect(defaultMembers.body.status).toBe("success");
    expect(
      defaultMembers.body.data.items.some(
        (item: { userId: string }) => item.userId === "orphan-on-delete"
      )
    ).toBe(true);
  });
});
