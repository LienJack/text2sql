import { ConfigService } from "@nestjs/config";
import { AppConfigService } from "../../src/modules/config/app-config.service";

const createConfig = (values: Record<string, string>): AppConfigService => {
  const config = {
    get: <T>(key: string, fallback?: T): T =>
      (values[key] as T | undefined) ?? (fallback as T)
  } as ConfigService;
  return new AppConfigService(config);
};

describe("AppConfigService authentication policy", () => {
  it("defaults production to oidc and fails when required verifier config is absent", () => {
    const config = createConfig({
      NODE_ENV: "production",
      SQLITE_PATH: "data/sqlite/test.db",
      DATABASE_URL: "postgresql://example",
      REDIS_URL: "redis://example",
      LLM_MOCK_MODE: "true",
      DATASOURCE_SECRET_KEY: "non-default"
    });

    expect(config.authMode).toBe("oidc_bearer");
    expect(() => config.assertCriticalConfig()).toThrow(
      "AUTH_OIDC_ISSUER, AUTH_OIDC_AUDIENCE, AUTH_OIDC_JWKS_URL"
    );
  });

  it("rejects dev header authentication in production", () => {
    const config = createConfig({
      NODE_ENV: "production",
      AUTH_MODE: "dev_headers",
      SQLITE_PATH: "data/sqlite/test.db",
      DATABASE_URL: "postgresql://example",
      REDIS_URL: "redis://example",
      LLM_MOCK_MODE: "true",
      DATASOURCE_SECRET_KEY: "non-default"
    });

    expect(() => config.assertCriticalConfig()).toThrow(
      "生产环境必须使用 AUTH_MODE=oidc_bearer"
    );
  });

  it("removes identity-forging headers from oidc CORS policy", () => {
    const config = createConfig({
      NODE_ENV: "production",
      AUTH_MODE: "oidc_bearer"
    });

    expect(config.corsAllowedHeaders).toContain("authorization");
    expect(config.corsAllowedHeaders).not.toContain("x-user-id");
    expect(config.corsAllowedHeaders).not.toContain("x-user-role");
  });
});
