import { Test } from "@nestjs/testing";
import { AppConfigModule } from "../../src/modules/config/config.module";
import { AppConfigService } from "../../src/modules/config/app-config.service";

describe("LangSmith config", () => {
  const reset = (): void => {
    delete process.env.LANGSMITH_TRACING;
    delete process.env.LANGSMITH_API_KEY;
    delete process.env.LANGSMITH_ENDPOINT;
    delete process.env.LANGSMITH_PROJECT;
    delete process.env.LANGSMITH_WORKSPACE_ID;
    delete process.env.LANGSMITH_TIMEOUT_MS;
  };

  beforeEach(() => {
    reset();
  });

  afterEach(() => {
    reset();
  });

  it("should default to tracing disabled", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule]
    }).compile();

    const config = moduleRef.get(AppConfigService);
    expect(config.langsmithTracing).toBe(false);
    expect(config.langsmithConfigured).toBe(false);
    expect(config.langsmithReady).toBe(false);
    expect(config.langsmithProject).toBe("text2sql");
  });

  it("should report ready when tracing and api key are set", async () => {
    process.env.LANGSMITH_TRACING = "true";
    process.env.LANGSMITH_API_KEY = "test-key";
    process.env.LANGSMITH_PROJECT = "text2sql-test";
    process.env.LANGSMITH_TIMEOUT_MS = "3000";

    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule]
    }).compile();

    const config = moduleRef.get(AppConfigService);
    expect(config.langsmithTracing).toBe(true);
    expect(config.langsmithConfigured).toBe(true);
    expect(config.langsmithReady).toBe(true);
    expect(config.langsmithProject).toBe("text2sql-test");
    expect(config.langsmithTimeoutMs).toBe(3000);
  });
});
