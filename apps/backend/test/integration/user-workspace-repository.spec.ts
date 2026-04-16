import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { v4 as uuidv4 } from "uuid";
import { AppModule } from "../../src/app.module";
import { UserRepository } from "../../src/modules/data/persistence/user.repository";
import { WorkspaceRepository } from "../../src/modules/data/persistence/workspace.repository";

describe("user/workspace repository integration", () => {
  beforeAll(() => {
    process.env.SQLITE_PATH = resolve(
      __dirname,
      "../../../../data/sqlite/text2sql.db"
    );
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "true";
  });

  it("supports workspace membership role checks across multiple workspaces", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    try {
      const userRepository = moduleRef.get(UserRepository);
      const workspaceRepository = moduleRef.get(WorkspaceRepository);

      const userId = `user-${uuidv4()}`;
      const workspaceAId = `workspace-a-${uuidv4()}`;
      const workspaceBId = `workspace-b-${uuidv4()}`;

      await workspaceRepository.upsertWorkspace({
        id: workspaceAId,
        name: `Workspace A ${uuidv4()}`
      });
      await workspaceRepository.upsertWorkspace({
        id: workspaceBId,
        name: `Workspace B ${uuidv4()}`
      });
      await userRepository.upsertUser({
        id: userId,
        account: `account-${uuidv4()}`,
        name: "Workspace Scoped Admin",
        email: `workspace-admin-${uuidv4()}@example.com`
      });

      await workspaceRepository.upsertWorkspaceMember({
        userId,
        workspaceId: workspaceAId,
        role: "admin"
      });
      await workspaceRepository.upsertWorkspaceMember({
        userId,
        workspaceId: workspaceBId,
        role: "member"
      });

      await expect(workspaceRepository.isWorkspaceAdmin(userId, workspaceAId)).resolves.toBe(
        true
      );
      await expect(workspaceRepository.isWorkspaceAdmin(userId, workspaceBId)).resolves.toBe(
        false
      );

      const membersInA = await workspaceRepository.listWorkspaceMembers({
        workspaceId: workspaceAId,
        page: 1,
        pageSize: 10
      });
      expect(membersInA.items).toHaveLength(1);
      expect(membersInA.items[0]?.role).toBe("admin");
      expect(membersInA.items[0]?.userId).toBe(userId);
    } finally {
      await moduleRef.close();
    }
  });

  it("applies soft-delete filters and pagination defaults for users/workspaces", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    try {
      const userRepository = moduleRef.get(UserRepository);
      const workspaceRepository = moduleRef.get(WorkspaceRepository);

      const activeUserId = `active-user-${uuidv4()}`;
      const deletedUserId = `deleted-user-${uuidv4()}`;
      const activeWorkspaceId = `active-workspace-${uuidv4()}`;
      const deletedWorkspaceId = `deleted-workspace-${uuidv4()}`;

      await userRepository.upsertUser({
        id: activeUserId,
        account: `active-account-${uuidv4()}`,
        name: "Active User",
        email: `active-${uuidv4()}@example.com`
      });
      await userRepository.upsertUser({
        id: deletedUserId,
        account: `deleted-account-${uuidv4()}`,
        name: "Deleted User",
        email: `deleted-${uuidv4()}@example.com`
      });
      await userRepository.softDeleteUser(deletedUserId);

      await workspaceRepository.upsertWorkspace({
        id: activeWorkspaceId,
        name: `Active Workspace ${uuidv4()}`
      });
      await workspaceRepository.upsertWorkspace({
        id: deletedWorkspaceId,
        name: `Deleted Workspace ${uuidv4()}`
      });
      await workspaceRepository.softDeleteWorkspace(deletedWorkspaceId);

      const usersWithoutDeleted = await userRepository.listUsers({
        page: 1,
        pageSize: 100
      });
      const usersWithDeleted = await userRepository.listUsers({
        includeDeleted: true,
        page: 1,
        pageSize: 100
      });

      expect(usersWithoutDeleted.items.some((item) => item.id === activeUserId)).toBe(true);
      expect(usersWithoutDeleted.items.some((item) => item.id === deletedUserId)).toBe(false);
      expect(usersWithDeleted.items.some((item) => item.id === deletedUserId)).toBe(true);

      const workspacesWithoutDeleted = await workspaceRepository.listWorkspaces({
        page: 1,
        pageSize: 100
      });
      const workspacesWithDeleted = await workspaceRepository.listWorkspaces({
        includeDeleted: true,
        page: 1,
        pageSize: 100
      });

      expect(
        workspacesWithoutDeleted.items.some((item) => item.id === activeWorkspaceId)
      ).toBe(true);
      expect(
        workspacesWithoutDeleted.items.some((item) => item.id === deletedWorkspaceId)
      ).toBe(false);
      expect(workspacesWithDeleted.items.some((item) => item.id === deletedWorkspaceId)).toBe(
        true
      );

      const pagedUsers = await userRepository.listUsers({
        includeDeleted: true,
        page: 1,
        pageSize: 1
      });
      expect(pagedUsers.items).toHaveLength(1);
      expect(pagedUsers.total).toBeGreaterThanOrEqual(2);
    } finally {
      await moduleRef.close();
    }
  });
});
