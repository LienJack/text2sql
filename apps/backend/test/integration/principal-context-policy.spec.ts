import { ExecutionContext } from "@nestjs/common";
import { AppConfigService } from "../../src/modules/config/app-config.service";
import { PrincipalContextGuard } from "../../src/modules/governance/auth/principal-context.guard";

const createContext = (principal?: Record<string, unknown>): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        actor: principal ? { principal } : undefined
      })
    })
  }) as unknown as ExecutionContext;

describe("PrincipalContextGuard policy", () => {
  it("accepts a verified Principal in production", () => {
    const config = { nodeEnv: "production" } as AppConfigService;
    const guard = new PrincipalContextGuard(config);

    expect(
      guard.canActivate(
        createContext({
          trustLevel: "verified"
        })
      )
    ).toBe(true);
  });

  it("rejects a development Principal in production", () => {
    const config = { nodeEnv: "production" } as AppConfigService;
    const guard = new PrincipalContextGuard(config);

    expect(() =>
      guard.canActivate(
        createContext({
          trustLevel: "development"
        })
      )
    ).toThrow("生产请求必须来自已验证的 OIDC Principal。");
  });
});
