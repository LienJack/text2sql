import { Test } from "@nestjs/testing";
import { DomainError } from "../../src/common/domain-error";
import { UserModule } from "../../src/modules/governance/user/user.module";
import { UserService } from "../../src/modules/governance/user/user.service";

describe("user service", () => {
  beforeAll(() => {
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
  });

  it("supports list filters with pagination", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [UserModule]
    }).compile();
    try {
      const userService = moduleRef.get(UserService);

      await userService.createUser("admin-test", {
        account: "alice",
        name: "Alice",
        email: "alice@example.com",
        status: "active",
        workspaceIds: ["workspace-sales"],
        variables: [{ key: "region", value: "apac" }]
      });

      await userService.createUser("admin-test", {
        account: "bob",
        name: "Bob",
        email: "bob@example.com",
        status: "disabled",
        workspaceIds: ["workspace-finance"],
        variables: []
      });

      const keywordResult = await userService.listUsers({
        page: 1,
        pageSize: 10,
        keyword: "ali"
      });
      expect(keywordResult.total).toBe(1);
      expect(keywordResult.items[0]?.account).toBe("alice");

      const statusResult = await userService.listUsers({
        page: 1,
        pageSize: 10,
        status: "disabled"
      });
      expect(statusResult.items.every((item) => item.status === "disabled")).toBe(true);

      const workspaceResult = await userService.listUsers({
        page: 1,
        pageSize: 10,
        workspaceId: "workspace-sales"
      });
      expect(workspaceResult.total).toBe(1);
      expect(workspaceResult.items[0]?.account).toBe("alice");
    } finally {
      await moduleRef.close();
    }
  });

  it("rejects account change on update", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [UserModule]
    }).compile();
    try {
      const userService = moduleRef.get(UserService);

      const created = await userService.createUser("admin-test", {
        account: "charlie",
        name: "Charlie",
        email: "charlie@example.com",
        variables: []
      });

      await expect(
        userService.updateUser("admin-test", created.id, {
          account: "charlie-new"
        })
      ).rejects.toMatchObject({
        code: "ACCOUNT_IMMUTABLE"
      });
    } finally {
      await moduleRef.close();
    }
  });

  it("protects default admin from deletion and supports partial-success batch delete", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [UserModule]
    }).compile();
    try {
      const userService = moduleRef.get(UserService);

      const initialUsers = await userService.listUsers({
        page: 1,
        pageSize: 20
      });
      const defaultAdmin = initialUsers.items.find((item) => item.account === "admin");
      expect(defaultAdmin).toBeDefined();

      const deletable = await userService.createUser("admin-test", {
        account: "to-delete",
        name: "To Delete",
        email: "to-delete@example.com",
        variables: []
      });

      await expect(userService.deleteUser(defaultAdmin!.id)).rejects.toBeInstanceOf(DomainError);
      await expect(userService.deleteUser(defaultAdmin!.id)).rejects.toMatchObject({
        code: "DEFAULT_ADMIN_PROTECTED"
      });

      const batchResult = await userService.deleteUsersBatch({
        userIds: [defaultAdmin!.id, deletable.id, "missing-user-id"]
      });
      expect(batchResult.successCount).toBe(1);
      expect(batchResult.failedCount).toBe(2);
      expect(batchResult.failedItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            userId: defaultAdmin!.id,
            code: "DEFAULT_ADMIN_PROTECTED"
          }),
          expect.objectContaining({
            userId: "missing-user-id",
            code: "USER_NOT_FOUND"
          })
        ])
      );
    } finally {
      await moduleRef.close();
    }
  });

  it("supports resetting password with custom default password", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [UserModule]
    }).compile();
    try {
      const userService = moduleRef.get(UserService);

      const created = await userService.createUser("admin-test", {
        account: "pwd-user",
        name: "Pwd User",
        email: "pwd-user@example.com",
        variables: []
      });

      const reset = await userService.resetPassword("admin-test", created.id, {
        defaultPassword: "Temp@123456"
      });

      expect(reset.userId).toBe(created.id);
      expect(reset.temporaryPassword).toBe("Temp@123456");
      expect(reset.resetAt).toBeTruthy();
    } finally {
      await moduleRef.close();
    }
  });
});
