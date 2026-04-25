import { Test } from "@nestjs/testing";
import { AppConfigModule } from "../../src/modules/config/config.module";
import { AppConfigService } from "../../src/modules/config/app-config.service";

describe("AppConfigService", () => {
  const resetAppEnv = () => {
    delete process.env.PORT;
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_MOCK_MODE;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_TIMEOUT_MS;
    delete process.env.LLM_STREAM_TIMEOUT_MS;
    delete process.env.SQLITE_PATH;
    delete process.env.REDIS_URL;
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_HOST;
    delete process.env.POSTGRES_PORT;
    delete process.env.POSTGRES_DB;
    delete process.env.POSTGRES_USER;
    delete process.env.POSTGRES_PASSWORD;
    delete process.env.POSTGRES_SCHEMA;
    delete process.env.SQL_SAFETY_SOFT_WARN_MAX_LENGTH;
    delete process.env.R1_GATE_WINDOW_MINUTES;
    delete process.env.R1_GATE_MIN_SAMPLES;
    delete process.env.R1_GATE_MIN_SUCCESS_RATE;
    delete process.env.R1_GATE_MAX_REJECTION_RATE;
    delete process.env.R1_GATE_MAX_HARD_FAILURE_RATE;
  };

  beforeEach(() => {
    resetAppEnv();
  });

  it("should provide defaults", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule]
    }).compile();

    const config = moduleRef.get(AppConfigService);
    expect(config.port).toBe(3002);
    expect(config.llmProvider).toBe("volcengine");
    expect(config.llmTimeoutMs).toBe(30000);
    expect(config.llmStreamTimeoutMs).toBe(30000);
    expect(config.sqlitePath).toContain("data/sqlite/text2sql.db");
  });

  it("should use LLM_STREAM_TIMEOUT_MS when configured", async () => {
    process.env.LLM_TIMEOUT_MS = "30000";
    process.env.LLM_STREAM_TIMEOUT_MS = "90000";

    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule]
    }).compile();

    const config = moduleRef.get(AppConfigService);
    expect(config.llmTimeoutMs).toBe(30000);
    expect(config.llmStreamTimeoutMs).toBe(90000);
  });

  it("should fallback to LLM_TIMEOUT_MS when LLM_STREAM_TIMEOUT_MS is invalid", async () => {
    process.env.LLM_TIMEOUT_MS = "45000";
    process.env.LLM_STREAM_TIMEOUT_MS = "invalid";

    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule]
    }).compile();

    const config = moduleRef.get(AppConfigService);
    expect(config.llmTimeoutMs).toBe(45000);
    expect(config.llmStreamTimeoutMs).toBe(45000);
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

  it("should fallback to defaults when r1 numeric env values are invalid", async () => {
    process.env.R1_GATE_WINDOW_MINUTES = "invalid";
    process.env.R1_GATE_MIN_SAMPLES = "invalid";
    process.env.R1_GATE_MIN_SUCCESS_RATE = "invalid";
    process.env.R1_GATE_MAX_REJECTION_RATE = "invalid";
    process.env.R1_GATE_MAX_HARD_FAILURE_RATE = "invalid";
    process.env.SQL_SAFETY_SOFT_WARN_MAX_LENGTH = "invalid";

    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule]
    }).compile();

    const config = moduleRef.get(AppConfigService);
    expect(config.r1GateWindowMinutes).toBe(60);
    expect(config.r1GateMinSamples).toBe(10);
    expect(config.r1GateMinSuccessRate).toBe(0.95);
    expect(config.r1GateMaxRejectionRate).toBe(0.2);
    expect(config.r1GateMaxHardFailureRate).toBe(0.05);
    expect(config.sqlSafetySoftWarnMaxLength).toBe(600);
  });
});
