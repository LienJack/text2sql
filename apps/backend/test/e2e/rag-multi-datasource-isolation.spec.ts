import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { RagIndexRepository } from "../../src/modules/rag/index/rag-index.repository";
import { RagDatasourceOrchestratorService } from "../../src/modules/rag/orchestration/rag-datasource-orchestrator.service";
import { createSeededSqliteFixture } from "../support/sqlite-fixture";

describe("rag multi datasource isolation e2e", () => {
  let app: INestApplication;
  let orchestrator: RagDatasourceOrchestratorService;
  let indexRepository: RagIndexRepository;
  let cleanupFixture: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const fixture = await createSeededSqliteFixture("rag-orchestrator-e2e");
    cleanupFixture = fixture.cleanup;
    process.env.SQLITE_PATH = fixture.dbPath;
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "true";

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    orchestrator = app.get(RagDatasourceOrchestratorService);
    indexRepository = app.get(RagIndexRepository);
  });

  afterAll(async () => {
    await app.close();
    if (cleanupFixture) {
      await cleanupFixture();
    }
  });

  it("keeps datasource boundaries and exposes orchestration metrics through /health", async () => {
    indexRepository.seedChunksForDatasource("ds-r6-e2e-a", [
      {
        id: "chunk-r6-e2e-a-1",
        datasourceId: "ds-r6-e2e-a",
        domain: "schema",
        content: "table product(id, category)"
      }
    ]);
    indexRepository.seedChunksForDatasource("ds-r6-e2e-b", [
      {
        id: "chunk-r6-e2e-b-1",
        datasourceId: "ds-r6-e2e-b",
        domain: "sql_example",
        content: "SELECT category, COUNT(*) FROM product GROUP BY category"
      }
    ]);

    await Promise.all([
      orchestrator.enqueueBuild({
        datasourceId: "ds-r6-e2e-a",
        workspaceId: "workspace-r6-e2e",
        sourceVersion: "source-v1"
      }),
      orchestrator.enqueueBuild({
        datasourceId: "ds-r6-e2e-b",
        workspaceId: "workspace-r6-e2e",
        sourceVersion: "source-v1"
      })
    ]);

    const response = await request(app.getHttpServer()).get("/health");
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("success");

    const gate = response.body.data.dependencies.ragQuality.gate;
    expect(gate.datasourceOrchestration).toBeTruthy();
    expect(gate.datasourceOrchestration.sampleSize24h).toBeGreaterThanOrEqual(2);
    expect(gate.datasourceOrchestration.datasourceIsolationViolationCount).toBe(0);
  });
});

