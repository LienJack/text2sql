import type { ConfigService } from "@nestjs/config";
import { DomainError } from "../../src/common/domain-error";
import { AppConfigService } from "../../src/modules/config/app-config.service";
import { RagTaskHealthProbeService } from "../../src/modules/llm/rag-task-health-probe.service";

const createConfigServiceMock = (
  entries: Record<string, string>
): Pick<ConfigService, "get"> => ({
  get: (...args: unknown[]) => {
    const key = String(args[0] ?? "");
    const defaultValue = args[1];
    return (entries[key] ?? defaultValue) as unknown;
  }
});

describe("RagTaskHealthProbeService", () => {
  it("returns dimension_mismatch when embedding vector length differs from expected", async () => {
    const appConfig = new AppConfigService(
      createConfigServiceMock({
        NODE_ENV: "test",
        LLM_MOCK_MODE: "true",
        EMBEDDING_MOCK_MODE: "false"
      }) as ConfigService
    );
    const service = new RagTaskHealthProbeService(appConfig);

    const result = await service.probeEmbedding({
      runtime: {
        provider: "openai",
        model: "text-embedding-3-small",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "test",
        timeoutMs: 1000,
        dimensions: 3
      },
      expectedDimensions: 4
    });

    expect(result.status).toBe("failed");
    expect(result.reasonCode).toBe("dimension_mismatch");
    expect(result.details?.expectedDimensions).toBe(4);
    expect(result.details?.actualDimensions).toBe(3);
  });

  it("fills builtin rerank samples when candidates are insufficient", async () => {
    const appConfig = new AppConfigService(
      createConfigServiceMock({
        NODE_ENV: "test",
        LLM_MOCK_MODE: "true",
        RERANK_MOCK_MODE: "false"
      }) as ConfigService
    );
    const service = new RagTaskHealthProbeService(appConfig);

    const result = await service.probeRerank({
      runtime: {
        provider: "siliconflow",
        model: "bge-reranker-v2-m3",
        baseUrl: "https://api.siliconflow.cn/v1",
        apiKey: "test",
        timeoutMs: 1000
      },
      sampleQuery: "revenue by status",
      sampleCandidates: ["only one"]
    });

    expect(result.status).toBe("healthy");
    expect(result.reasonCode).toBe("ok");
    expect(result.challenge.status).toBe("comparable");
    expect(result.details?.sampleCandidateCount).toBeGreaterThanOrEqual(2);
    expect(result.reranked?.length).toBeGreaterThanOrEqual(2);
  });

  it("maps provider unavailable errors into stable reason code", async () => {
    const appConfig = new AppConfigService(
      createConfigServiceMock({
        NODE_ENV: "test",
        LLM_MOCK_MODE: "false"
      }) as ConfigService
    );
    const service = new RagTaskHealthProbeService(appConfig);
    const result = await (
      service as unknown as {
        mapProbeFailure: (error: unknown) => { status: string; reasonCode: string };
      }
    ).mapProbeFailure(
      new DomainError("EMBEDDING_PROVIDER_UNAVAILABLE", "provider unavailable", 503)
    );
    expect(result.status).toBe("degraded");
    expect(result.reasonCode).toBe("provider_unavailable");
  });
});
