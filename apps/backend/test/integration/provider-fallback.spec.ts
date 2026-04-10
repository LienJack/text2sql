import { Test } from "@nestjs/testing";
import { AppConfigModule } from "../../src/modules/config/config.module";
import { LlmModule } from "../../src/modules/llm/llm.module";
import { ProviderRouterService } from "../../src/modules/llm/provider-router.service";

describe("provider router", () => {
  it("should use default provider and return sql draft", async () => {
    process.env.LLM_PROVIDER = "volcengine";
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, LlmModule]
    }).compile();
    const service = moduleRef.get(ProviderRouterService);
    const draft = await service.generateSql("统计退款金额");
    expect(draft.provider).toBe("volcengine");
    expect(draft.sql.toLowerCase()).toContain("select");
  });
});

