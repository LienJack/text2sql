import { Test } from "@nestjs/testing";
import { AppConfigModule } from "../../src/modules/config/config.module";
import { LlmModule } from "../../src/modules/llm/llm.module";
import { ProviderRouterService } from "../../src/modules/llm/provider-router.service";

describe("provider router", () => {
  it("should use llm mock mode and return sql draft", async () => {
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "true";
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, LlmModule]
    }).compile();
    const service = moduleRef.get(ProviderRouterService);
    const draft = await service.generateSql("统计退款金额");
    expect(draft.provider).toBe("volcengine");
    expect(draft.sql.toLowerCase()).toContain("select");
  });

  it("should fail directly when llm config is missing", async () => {
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "false";
    process.env.LLM_BASE_URL = "";
    process.env.LLM_API_KEY = "";
    process.env.LLM_MODEL = "";
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, LlmModule]
    }).compile();
    const service = moduleRef.get(ProviderRouterService);
    await expect(service.generateSql("统计退款金额")).rejects.toMatchObject({
      code: "LLM_CONFIG_MISSING"
    });
  });
});
