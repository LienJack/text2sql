import { Test, type TestingModule } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { BuildRagIndexJob } from "../../src/modules/rag/jobs/build-rag-index.job";
import { RagDatasourceOrchestratorService } from "../../src/modules/rag/orchestration/rag-datasource-orchestrator.service";
import { RagQualityService } from "../../src/modules/rag/quality/rag-quality.service";
import { RagIndexRepository } from "../../src/modules/rag/index/rag-index.repository";
import { createSeededSqliteFixture } from "../support/sqlite-fixture";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("rag datasource gate metrics integration", () => {
  let moduleRef: TestingModule;
  let orchestrator: RagDatasourceOrchestratorService;
  let qualityService: RagQualityService;
  let buildJob: BuildRagIndexJob;
  let indexRepository: RagIndexRepository;
  let cleanupFixture: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    const fixture = await createSeededSqliteFixture("rag-gate-metrics");
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
    qualityService = moduleRef.get(RagQualityService, {
      strict: false
    });
    buildJob = moduleRef.get(BuildRagIndexJob, {
      strict: false
    });
    indexRepository = moduleRef.get(RagIndexRepository, {
      strict: false
    });
    qualityService.reset();
  });

  afterEach(async () => {
    await moduleRef.close();
    if (cleanupFixture) {
      await cleanupFixture();
    }
  });

  it("reports queue wait p95 and zero isolation violations for healthy multi-build flow", async () => {
    indexRepository.seedChunksForDatasource("ds-r6-metrics", [
      {
        id: "chunk-r6-metrics-1",
        datasourceId: "ds-r6-metrics",
        domain: "schema",
        content: "table customers(id, level)"
      }
    ]);

    const originalRun = buildJob.run.bind(buildJob);
    const runSpy = jest
      .spyOn(buildJob, "run")
      .mockImplementation(async (input) => {
        if (input.datasourceId === "ds-r6-metrics" && input.sourceVersion === "source-v1") {
          await sleep(35);
        }
        return originalRun(input);
      });

    await Promise.all([
      orchestrator.enqueueBuild({
        datasourceId: "ds-r6-metrics",
        workspaceId: "workspace-r6-metrics",
        sourceVersion: "source-v1"
      }),
      orchestrator.enqueueBuild({
        datasourceId: "ds-r6-metrics",
        workspaceId: "workspace-r6-metrics",
        sourceVersion: "source-v2"
      })
    ]);

    const snapshot = qualityService.snapshot();
    expect(snapshot.datasourceOrchestration.sampleSize24h).toBeGreaterThanOrEqual(2);
    expect(snapshot.datasourceOrchestration.orchestratorQueueWaitP95Ms).toBeGreaterThan(0);
    expect(snapshot.datasourceOrchestration.datasourceIsolationViolationCount).toBe(0);

    runSpy.mockRestore();
  });

  it("increments isolation violation metric when build result datasource mismatches request", async () => {
    indexRepository.seedChunksForDatasource("ds-r6-metrics-mismatch", [
      {
        id: "chunk-r6-metrics-mismatch-1",
        datasourceId: "ds-r6-metrics-mismatch",
        domain: "schema",
        content: "table returns(id, reason)"
      }
    ]);

    const originalRun = buildJob.run.bind(buildJob);
    const runSpy = jest
      .spyOn(buildJob, "run")
      .mockImplementationOnce(async (input) => {
        const result = await originalRun(input);
        return {
          ...result,
          datasourceId: "mismatch-datasource"
        };
      });

    await orchestrator.enqueueBuild({
      datasourceId: "ds-r6-metrics-mismatch",
      workspaceId: "workspace-r6-metrics",
      sourceVersion: "source-v1"
    });

    const snapshot = qualityService.snapshot();
    expect(snapshot.datasourceOrchestration.datasourceIsolationViolationCount).toBeGreaterThanOrEqual(
      1
    );

    runSpy.mockRestore();
  });
});

