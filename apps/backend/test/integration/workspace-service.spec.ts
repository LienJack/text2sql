import { Test } from "@nestjs/testing";
import { DomainError } from "../../src/common/domain-error";
import { WorkspaceModule } from "../../src/modules/governance/workspace/workspace.module";
import { WorkspaceService } from "../../src/modules/governance/workspace/workspace.service";

describe("workspace service", () => {
  const adminActor = {
    id: "system-admin",
    role: "admin" as const
  };

  beforeAll(() => {
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
  });

  it("protects default workspace deletion", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [WorkspaceModule]
    }).compile();
    const service = moduleRef.get(WorkspaceService);

    try {
      const list = await service.listWorkspaces(adminActor);
      const defaultWorkspace = list.items.find((item) => item.isDefault);
      expect(defaultWorkspace).toBeDefined();

      await expect(
        service.deleteWorkspace(adminActor, defaultWorkspace?.id ?? "workspace_default")
      ).rejects.toBeInstanceOf(DomainError);
      await expect(
        service.deleteWorkspace(adminActor, defaultWorkspace?.id ?? "workspace_default")
      ).rejects.toThrow("默认工作空间不可删除。");
    } finally {
      await moduleRef.close();
    }
  });

  it("allows workspace admin to manage own members but not other workspaces", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [WorkspaceModule]
    }).compile();
    const service = moduleRef.get(WorkspaceService);

    try {
      const workspaceA = await service.createWorkspace(adminActor, {
        name: "A 空间"
      });
      const workspaceB = await service.createWorkspace(adminActor, {
        name: "B 空间"
      });

      await service.addMember(adminActor, workspaceA.id, {
        userId: "workspace-admin-a",
        role: "admin"
      });

      const workspaceAdminActor = {
        id: "workspace-admin-a",
        role: "user" as const
      };

      const created = await service.addMember(workspaceAdminActor, workspaceA.id, {
        userId: "member-a1",
        role: "member"
      });

      expect(created.created).toBe(true);
      expect(created.member.workspaceId).toBe(workspaceA.id);

      await expect(
        service.addMember(workspaceAdminActor, workspaceB.id, {
          userId: "member-b1",
          role: "member"
        })
      ).rejects.toBeInstanceOf(DomainError);
    } finally {
      await moduleRef.close();
    }
  });

  it("reassigns orphan users to default workspace when deleting workspace", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [WorkspaceModule]
    }).compile();
    const service = moduleRef.get(WorkspaceService);

    try {
      const defaultWorkspace = (await service.listWorkspaces(adminActor)).items.find(
        (item) => item.isDefault
      );
      expect(defaultWorkspace).toBeDefined();

      const removableWorkspace = await service.createWorkspace(adminActor, {
        name: "可删空间"
      });

      await service.addMember(adminActor, removableWorkspace.id, {
        userId: "orphan-user",
        role: "member"
      });
      await service.addMember(adminActor, removableWorkspace.id, {
        userId: "shared-user",
        role: "member"
      });
      await service.addMember(adminActor, defaultWorkspace?.id ?? "workspace_default", {
        userId: "shared-user",
        role: "member"
      });

      const deleted = await service.deleteWorkspace(adminActor, removableWorkspace.id);
      expect(deleted.deleted).toBe(true);
      expect(deleted.removedMemberCount).toBe(2);
      expect(deleted.reassignedUserIds).toEqual(["orphan-user"]);

      const defaultMembers = await service.listMembers(
        adminActor,
        defaultWorkspace?.id ?? "workspace_default"
      );
      expect(defaultMembers.items.some((item) => item.userId === "orphan-user")).toBe(true);
    } finally {
      await moduleRef.close();
    }
  });
});
