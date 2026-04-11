import { ExecutionContext } from "@nestjs/common";
import { DomainError } from "../../src/common/domain-error";
import { AdminOnlyGuard } from "../../src/modules/auth/admin-only.guard";

const createContext = (role: "admin" | "user"): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        actor: {
          role
        }
      })
    })
  }) as unknown as ExecutionContext;

describe("AdminOnlyGuard", () => {
  it("should allow admin role", () => {
    const guard = new AdminOnlyGuard();
    expect(guard.canActivate(createContext("admin"))).toBe(true);
  });

  it("should reject non-admin role", () => {
    const guard = new AdminOnlyGuard();
    expect(() => guard.canActivate(createContext("user"))).toThrow(DomainError);
    expect(() => guard.canActivate(createContext("user"))).toThrow(
      "仅管理员可执行该操作。"
    );
  });
});
