import { Test, type TestingModule } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { RagIndexRepository } from "../../src/modules/rag/index/rag-index.repository";
import { RagDatasourceOrchestratorService } from "../../src/modules/rag/orchestration/rag-datasource-orchestrator.service";
import { createSeededSqliteFixture } from "../support/sqlite-fixture";

describe("rag multi datasource orchestrator integration", () => {
  let moduleRef: TestingModule;
  let orchestrator: RagDatasourceOrchestratorService;
  let indexRepository: RagIndexRepository;
  let cleanupFixture: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    const fixture = await createSeededSqliteFixture("rag-orchestrator");
    cleanupFixture = fixture.cleanup;
    process.env.SQLITE_PATH = fixture.dbPath;
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "true";

    moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    orchestrator = moduleRef.get(RagDatasourceOrchestratorService, {
      strict: false
    });
    indexRepository = moduleRef.get(RagIndexRepository, {
      strict: false
    });
  });

  afterEach(async () => {
    await moduleRef.close();
    if (cleanupFixture) {
      await cleanupFixture();
    }
  });

  it("builds multiple datasources in parallel without cross-source entry pollution", async () => {
    indexRepository.seedChunksForDatasource("ds-r6-a", [
      {
        id: "chunk-r6-a-1",
        datasourceId: "ds-r6-a",
        domain: "schema",
        content: "table orders(id, status)"
      }
    ]);
    indexRepository.seedChunksForDatasource("ds-r6-b", [
      {
        id: "chunk-r6-b-1",
        datasourceId: "ds-r6-b",
        domain: "schema",
        content: "table payments(id, channel)"
      }
    ]);
    indexRepository.seedChunksForDatasource("ds-r6-c", [
      {
        id: "chunk-r6-c-1",
        datasourceId: "ds-r6-c",
        domain: "semantic_term",
        content: "GMV means gross merchandise volume"
      }
    ]);

    const [a, b, c] = await Promise.all([
      orchestrator.enqueueBuild({
        datasourceId: "ds-r6-a",
        workspaceId: "workspace-r6-1",
        sourceVersion: "source-v1"
      }),
      orchestrator.enqueueBuild({
        datasourceId: "ds-r6-b",
        workspaceId: "workspace-r6-1",
        sourceVersion: "source-v1"
      }),
      orchestrator.enqueueBuild({
        datasourceId: "ds-r6-c",
        workspaceId: "workspace-r6-2",
        sourceVersion: "source-v1"
      })
    ]);

    expect(a.status).toBe("active");
    expect(b.status).toBe("active");
    expect(c.status).toBe("active");
    expect(a.isolationViolation).toBe(false);
    expect(b.isolationViolation).toBe(false);
    expect(c.isolationViolation).toBe(false);

    const aEntries = await indexRepository.listEntriesByVersion(a.indexVersionId);
    const bEntries = await indexRepository.listEntriesByVersion(b.indexVersionId);
    const cEntries = await indexRepository.listEntriesByVersion(c.indexVersionId);

    expect(aEntries.every((item) => item.datasourceId === "ds-r6-a")).toBe(true);
    expect(bEntries.every((item) => item.datasourceId === "ds-r6-b")).toBe(true);
    expect(cEntries.every((item) => item.datasourceId === "ds-r6-c")).toBe(true);
  });

  it("serializes concurrent builds for the same datasource", async () => {
    indexRepository.seedChunksForDatasource("ds-r6-serial", [
      {
        id: "chunk-r6-serial-1",
        datasourceId: "ds-r6-serial",
        domain: "schema",
        content: "table inventory(id, sku, qty)"
      }
    ]);

    const firstPromise = orchestrator.enqueueBuild({
      datasourceId: "ds-r6-serial",
      workspaceId: "workspace-r6-serial",
      sourceVersion: "source-v1"
    });
    const secondPromise = orchestrator.enqueueBuild({
      datasourceId: "ds-r6-serial",
      workspaceId: "workspace-r6-serial",
      sourceVersion: "source-v2"
    });

    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(second.queueWaitMs).toBeGreaterThanOrEqual(0);
    expect(Date.parse(second.startedAt)).toBeGreaterThanOrEqual(Date.parse(first.startedAt));

    const versions = await indexRepository.listVersionsByDatasource("ds-r6-serial");
    const active = versions.filter((item) => item.status === "active");
    expect(active).toHaveLength(1);
    expect(versions.length).toBeGreaterThanOrEqual(2);
  });
});

