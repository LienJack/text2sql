import { AppConfigService } from "../../src/modules/config/app-config.service";
import { RagTaskConfigRepository } from "../../src/modules/data/persistence/rag-task-config.repository";

function createRepository(): RagTaskConfigRepository {
  return new RagTaskConfigRepository({
    databaseUrl: ""
  } as AppConfigService);
}

describe("RagTaskConfigRepository", () => {
  it("keeps the stored api key when the runtime target is unchanged", async () => {
    const repository = createRepository();

    await repository.upsertConfig({
      taskType: "embedding",
      provider: "openai",
      model: "text-embedding-3-small",
      baseUrl: "https://api.openai.com/v1",
      apiKeyCiphertext: "secret-embedding-key",
      apiKeyMasked: "secr***-key"
    });

    const updated = await repository.upsertConfig({
      taskType: "embedding",
      provider: "openai",
      model: "text-embedding-3-small",
      baseUrl: "https://api.openai.com/v1",
      timeoutMs: 5000
    });

    expect(updated.hasApiKey).toBe(true);
    expect(updated.apiKeyMasked).toBe("secr***-key");
    await expect(repository.getApiKey("embedding")).resolves.toBe("secret-embedding-key");
  });

  it("clears the stored api key when the runtime target changes without a replacement key", async () => {
    const repository = createRepository();

    await repository.upsertConfig({
      taskType: "embedding",
      provider: "openai",
      model: "text-embedding-3-small",
      baseUrl: "https://api.openai.com/v1",
      apiKeyCiphertext: "secret-embedding-key",
      apiKeyMasked: "secr***-key"
    });

    const updated = await repository.upsertConfig({
      taskType: "embedding",
      provider: "openai",
      model: "text-embedding-3-small",
      baseUrl: "https://example-proxy.invalid/v1"
    });

    expect(updated.hasApiKey).toBe(false);
    expect(updated.apiKeyMasked).toBeNull();
    await expect(repository.getApiKey("embedding")).resolves.toBeUndefined();
  });
});
