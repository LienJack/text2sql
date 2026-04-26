import type { ConfigService } from "@nestjs/config";
import { DomainError } from "../../src/common/domain-error";
import { AppConfigService } from "../../src/modules/config/app-config.service";
import { EmbeddingRouterService } from "../../src/modules/llm/embedding-router.service";

const createConfigServiceMock = (
  entries: Record<string, string>
): Pick<ConfigService, "get"> => ({
  get: (...args: unknown[]) => {
    const key = String(args[0] ?? "");
    const defaultValue = args[1];
    return (entries[key] ?? defaultValue) as unknown;
  }
});

describe("Text2Sql v2 embedding provider", () => {
  it("returns deterministic mock vectors when embedding mock mode is explicitly enabled", async () => {
    const config = new AppConfigService(
      createConfigServiceMock({
        NODE_ENV: "development",
        LLM_MOCK_MODE: "true",
        EMBEDDING_MOCK_MODE: "true",
        EMBEDDING_PROVIDER: "volcengine",
        EMBEDDING_MODEL: "embedding-v1",
        EMBEDDING_VECTOR_VERSION: "v2",
        EMBEDDING_DIMENSIONS: "8"
      }) as ConfigService
    );
    const service = new EmbeddingRouterService(config);

    const first = await service.embed({
      texts: ["orders amount"],
      indexVersion: "idx-1",
      scope: "datasource",
      assetType: "rag_chunk"
    });
    const second = await service.embed({
      texts: ["orders amount"],
      indexVersion: "idx-1",
      scope: "datasource",
      assetType: "rag_chunk"
    });

    expect(first).toHaveLength(1);
    expect(first[0]?.metadata.provider).toBe("volcengine:mock");
    expect(first[0]?.metadata.model).toBe("embedding-v1");
    expect(first[0]?.metadata.dimensions).toBe(8);
    expect(first[0]?.metadata.vectorVersion).toBe("v2");
    expect(first[0]?.vector).toEqual(second[0]?.vector);
  });

  it("allows llm mock mode as deterministic test double in NODE_ENV=test", async () => {
    const config = new AppConfigService(
      createConfigServiceMock({
        NODE_ENV: "test",
        LLM_MOCK_MODE: "true",
        EMBEDDING_PROVIDER: "openai",
        EMBEDDING_MODEL: "embedding-test"
      }) as ConfigService
    );
    const service = new EmbeddingRouterService(config);
    const vectors = await service.embed({
      texts: ["orders amount"]
    });
    expect(vectors).toHaveLength(1);
    expect(vectors[0]?.metadata.provider).toContain(":mock");
  });

  it("throws explicit unavailable error when provider config is missing in non-test llm mock mode", async () => {
    const config = new AppConfigService(
      createConfigServiceMock({
        NODE_ENV: "development",
        LLM_MOCK_MODE: "true",
        EMBEDDING_MOCK_MODE: "false",
        EMBEDDING_PROVIDER: "openai",
        EMBEDDING_BASE_URL: "",
        EMBEDDING_API_KEY: ""
      }) as ConfigService
    );
    const service = new EmbeddingRouterService(config);

    await expect(
      service.embed({
        texts: ["orders amount"]
      })
    ).rejects.toMatchObject<Partial<DomainError>>({
      code: "EMBEDDING_PROVIDER_UNAVAILABLE"
    });
  });
});
