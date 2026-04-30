import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { RagIndexBuilderService } from "../../src/modules/rag/index/rag-index-builder.service";
import { RagIndexRepository } from "../../src/modules/rag/index/rag-index.repository";

describe("rag index builder integration", () => {
  beforeAll(() => {
    process.env.SQLITE_PATH = resolve(
      __dirname,
      "../../../../data/sqlite/text2sql.db"
    );
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "true";
  });

  it("builds lexical + dense entries in one snapshot and activates the new version", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const repository = moduleRef.get(RagIndexRepository);
    const builder = moduleRef.get(RagIndexBuilderService);
    const datasourceId = "ds-rag-index-builder";
    repository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-orders-1",
        datasourceId,
        domain: "schema",
        content: "table orders(id, amount, status)",
        metadata: JSON.stringify({ table: "orders" })
      },
      {
        id: "chunk-sql-1",
        datasourceId,
        domain: "sql_example",
        content: "SELECT SUM(amount) FROM orders WHERE status = 'paid'"
      }
    ]);

    const result = await builder.buildAndActivate({
      datasourceId,
      sourceVersion: "source-v1",
      buildReason: "initial_build",
      createdByRunId: "run-build-v1",
      activatedByRunId: "run-build-v1"
    });

    const version = await repository.getVersionById(result.indexVersionId);
    const entries = await repository.listEntriesByVersion(result.indexVersionId);

    expect(result.status).toBe("active");
    expect(result.archivedChannels).toEqual(["lexical", "dense"]);
    expect(result.activation.replacedVersionIds).toEqual([]);
    expect(["mock_provider", "external_provider", "dense_unavailable"]).toContain(
      result.denseMode
    );
    expect(result.entryCount).toBe(2);
    expect(version?.status).toBe("active");
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.lexicalContent.length > 0)).toBe(true);
    if (result.denseMode === "dense_unavailable") {
      expect(entries.every((entry) => entry.denseVector === undefined)).toBe(true);
    } else {
      expect(entries.every((entry) => typeof entry.denseVector === "string")).toBe(true);
      const parsedVector = JSON.parse(entries[0]?.denseVector ?? "[]");
      expect(Array.isArray(parsedVector)).toBe(true);
      expect(parsedVector.length).toBeGreaterThan(0);
    }

    await moduleRef.close();
  });

  it("returns activation evidence when replacing a previous active version", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const repository = moduleRef.get(RagIndexRepository);
    const builder = moduleRef.get(RagIndexBuilderService);
    const datasourceId = "ds-rag-index-builder-activation-evidence";

    repository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-orders-activation-1",
        datasourceId,
        domain: "schema",
        content: "table orders(id, amount)"
      }
    ]);

    const first = await builder.buildAndActivate({
      datasourceId,
      sourceVersion: "semantic-assets-builder-v1:mock",
      buildReason: "initial_build",
      createdByRunId: "run-builder-activation-v1",
      activatedByRunId: "run-builder-activation-v1",
      manifest: {
        fingerprint: "semantic-assets-builder-v1",
        summary: {
          entryCount: 1,
          preparedEntryCount: 1,
          familyCounts: { full_schema: 1 },
          reasonCodes: ["prepared"]
        }
      }
    });
    const second = await builder.buildAndActivate({
      datasourceId,
      sourceVersion: "semantic-assets-builder-v2:mock",
      buildReason: "refresh_build",
      createdByRunId: "run-builder-activation-v2",
      activatedByRunId: "run-builder-activation-v2",
      manifest: {
        fingerprint: "semantic-assets-builder-v2",
        summary: {
          entryCount: 1,
          preparedEntryCount: 1,
          familyCounts: { full_schema: 1 },
          reasonCodes: ["prepared"]
        }
      }
    });

    expect(second.manifestFingerprint).toBe("semantic-assets-builder-v2");
    expect(second.activation.replacedVersionIds).toContain(first.indexVersionId);
    expect(second.activation.replacedSourceVersions).toContain(
      "semantic-assets-builder-v1:mock"
    );

    await moduleRef.close();
  });
});
