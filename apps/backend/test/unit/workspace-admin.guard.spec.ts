import { ExecutionContext } from "@nestjs/common";
import { DomainError } from "../../src/common/domain-error";
import { WorkspaceAdminGuard } from "../../src/modules/auth/workspace-admin.guard";
import { WorkspaceRepository } from "../../src/modules/data/persistence/workspace.repository";

const createContext = (request: Record<string, unknown>): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => request
    })
  }) as unknown as ExecutionContext;

describe("WorkspaceAdminGuard", () => {
  it("allows system admin actor without workspace scoping", async () => {
    const repository = {
      isWorkspaceAdmin: jest.fn().mockResolvedValue(false)
    } as unknown as WorkspaceRepository;
    const guard = new WorkspaceAdminGuard(repository);
    await expect(
      guard.canActivate(
        createContext({
          actor: {
            id: "system-admin",
            role: "admin",
            isSystemAdmin: true
          }
        })
      )
    ).resolves.toBe(true);
    expect(repository.isWorkspaceAdmin).not.toHaveBeenCalled();
  });

  it("allows workspace admin from actor scoped roles", async () => {
    const repository = {
      isWorkspaceAdmin: jest.fn().mockResolvedValue(false)
    } as unknown as WorkspaceRepository;
    const guard = new WorkspaceAdminGuard(repository);
    await expect(
      guard.canActivate(
        createContext({
          actor: {
            id: "user-1",
            role: "user",
            workspaceRoles: {
              "workspace-alpha": "admin"
            }
          },
          params: {
            workspaceId: "workspace-alpha"
          }
        })
      )
    ).resolves.toBe(true);
    expect(repository.isWorkspaceAdmin).not.toHaveBeenCalled();
  });

  it("allows workspace admin from repository membership", async () => {
    const repository = {
      isWorkspaceAdmin: jest.fn().mockResolvedValue(true)
    } as unknown as WorkspaceRepository;
    const guard = new WorkspaceAdminGuard(repository);

    await expect(
      guard.canActivate(
        createContext({
          actor: {
            id: "user-2",
            role: "user"
          },
          body: {
            workspaceId: "workspace-beta"
          }
        })
      )
    ).resolves.toBe(true);

    expect(repository.isWorkspaceAdmin).toHaveBeenCalledWith("user-2", "workspace-beta");
  });

  it("rejects non-admin actor when workspace scope is missing", async () => {
    const repository = {
      isWorkspaceAdmin: jest.fn().mockResolvedValue(false)
    } as unknown as WorkspaceRepository;
    const guard = new WorkspaceAdminGuard(repository);

    await expect(
      guard.canActivate(
        createContext({
          actor: {
            id: "user-3",
            role: "user"
          }
        })
      )
    ).rejects.toThrow(DomainError);
  });

  it("rejects actor without workspace admin access", async () => {
    const repository = {
      isWorkspaceAdmin: jest.fn().mockResolvedValue(false)
    } as unknown as WorkspaceRepository;
    const guard = new WorkspaceAdminGuard(repository);

    await expect(
      guard.canActivate(
        createContext({
          actor: {
            id: "user-4",
            role: "user"
          },
          query: {
            id: "workspace-gamma"
          }
        })
      )
    ).rejects.toThrow("仅系统管理员或工作空间管理员可执行该操作。");
    expect(repository.isWorkspaceAdmin).toHaveBeenCalledWith("user-4", "workspace-gamma");
  });
});
