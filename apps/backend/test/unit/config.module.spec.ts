import { Test } from "@nestjs/testing";
import { AppConfigModule } from "../../src/modules/config/config.module";
import { AppConfigService } from "../../src/modules/config/app-config.service";

describe("AppConfigService", () => {
  beforeAll(() => {
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_MOCK_MODE;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_MODEL;
    delete process.env.SQLITE_PATH;
    delete process.env.REDIS_URL;
    delete process.env.DATABASE_URL;
  });

  it("should provide defaults", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule]
    }).compile();

    const config = moduleRef.get(AppConfigService);
    expect(config.port).toBe(3000);
    expect(config.llmProvider).toBe("volcengine");
    expect(config.sqlitePath).toContain("data/sqlite/text2sql.db");
  });

  it("should build database url from POSTGRES_* env variables", async () => {
    process.env.POSTGRES_HOST = "localhost";
    process.env.POSTGRES_PORT = "5432";
    process.env.POSTGRES_DB = "text2sql";
    process.env.POSTGRES_USER = "admin";
    process.env.POSTGRES_PASSWORD = "admin";
    process.env.POSTGRES_SCHEMA = "public";
    delete process.env.DATABASE_URL;

    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule]
    }).compile();

    const config = moduleRef.get(AppConfigService);
    expect(config.databaseUrl).toBe(
      "postgresql://admin:admin@localhost:5432/text2sql?schema=public"
    );
  });
});
