import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { RagIndexBuilderService } from "../../src/modules/rag/index/rag-index-builder.service";
import { RagIndexRepository } from "../../src/modules/rag/index/rag-index.repository";

describe("rag index activation integration", () => {
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

  it("keeps previous active readable when activation fails in the same transaction window", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const repository = moduleRef.get(RagIndexRepository);
    const builder = moduleRef.get(RagIndexBuilderService);
    const datasourceId = "ds-rag-index-rollback";

    repository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-base-1",
        datasourceId,
        domain: "schema",
        content: "table users(id, email)"
      }
    ]);
    const baseline = await builder.buildAndActivate({
      datasourceId,
      sourceVersion: "source-v1",
      createdByRunId: "run-v1",
      activatedByRunId: "run-v1"
    });
    const activeBefore = await repository.getActiveVersion(datasourceId);
    expect(activeBefore?.id).toBe(baseline.indexVersionId);

    const candidate = await repository.createBuildingVersion({
      datasourceId,
      sourceVersion: "source-v2",
      buildReason: "candidate_build",
      createdByRunId: "run-v2"
    });
    expect(candidate.status).toBe("building");

    const now = new Date().toISOString();
    await repository.replaceEntriesForVersion(candidate.id, [
      {
        id: createHash("sha256")
          .update(`${candidate.id}|chunk-base-1|candidate`)
          .digest("hex"),
        indexVersionId: candidate.id,
        chunkId: "chunk-base-1",
        datasourceId,
        domain: "schema",
        lexicalContent: "table users(id, email, deleted_at)",
        denseVector: JSON.stringify([0.1, 0.2, 0.3, 0.4]),
        createdAt: now,
        updatedAt: now
      }
    ]);
    const ready = await repository.markVersionReady(candidate.id);
    expect(ready.status).toBe("ready");

    await expect(
      repository.activateVersion({
        datasourceId,
        indexVersionId: candidate.id,
        activatedByRunId: "run-v2",
        simulateFailure: "after_deprecating_current_active"
      })
    ).rejects.toThrow("simulated activation failure");

    const activeAfterFailure = await repository.getActiveVersion(datasourceId);
    const candidateAfterFailure = await repository.getVersionById(candidate.id);
    expect(activeAfterFailure?.id).toBe(activeBefore?.id);
    expect(candidateAfterFailure?.status).toBe("ready");

    await moduleRef.close();
  });

  it("allows concurrent builds but only one version ends as active", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const repository = moduleRef.get(RagIndexRepository);
    const builder = moduleRef.get(RagIndexBuilderService);
    const datasourceId = "ds-rag-index-concurrency";

    repository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-concurrency-1",
        datasourceId,
        domain: "sql_example",
        content: "SELECT COUNT(*) FROM orders"
      }
    ]);

    await Promise.all([
      builder.buildAndActivate({
        datasourceId,
        sourceVersion: "source-v1",
        buildReason: "concurrent-build-1",
        createdByRunId: "run-concurrency-1",
        activatedByRunId: "run-concurrency-1"
      }),
      builder.buildAndActivate({
        datasourceId,
        sourceVersion: "source-v2",
        buildReason: "concurrent-build-2",
        createdByRunId: "run-concurrency-2",
        activatedByRunId: "run-concurrency-2"
      })
    ]);

    const versions = await repository.listVersionsByDatasource(datasourceId);
    const active = versions.filter((item) => item.status === "active");
    const deprecated = versions.filter((item) => item.status === "deprecated");

    expect(versions).toHaveLength(2);
    expect(active).toHaveLength(1);
    expect(deprecated.length).toBeGreaterThanOrEqual(1);
    expect(
      versions.every((item) =>
        ["building", "ready", "active", "deprecated"].includes(item.status)
      )
    ).toBe(true);

    await moduleRef.close();
  });
});
