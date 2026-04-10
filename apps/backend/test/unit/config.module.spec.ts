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
});
