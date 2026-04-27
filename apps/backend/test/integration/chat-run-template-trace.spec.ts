import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { SqlRun } from "@text2sql/shared-types";
import { AppModule } from "../../src/app.module";
import { requestActorMiddleware } from "../../src/modules/auth/request-actor.middleware";
import { requestIdMiddleware } from "../../src/modules/middleware/request-id.middleware";
import { ChatRepository } from "../../src/modules/data/persistence/chat.repository";
import { RunViewUsecase } from "../../src/modules/conversation/chat/application/run-view.usecase";
import { createSeededSqliteFixture } from "../support/sqlite-fixture";

describe("chat run prompt-template trace integration", () => {
  let app: INestApplication;
  let repository: ChatRepository;
  let runViewUsecase: RunViewUsecase;
  let cleanupFixture: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const fixture = await createSeededSqliteFixture("chat-run-template-trace");
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
    app.use(requestIdMiddleware);
    app.use(requestActorMiddleware);
    await app.init();

    repository = app.get(ChatRepository);
    runViewUsecase = app.get(RunViewUsecase, {
      strict: false
    });
  });

  afterAll(async () => {
    await app.close();
    if (cleanupFixture) {
      await cleanupFixture();
    }
  });

  it("returns prompt-template evidence on /api/v1/runs/:runId", async () => {
    await repository.createSession({
      id: "session-template-trace-1",
      datasource: "sqlite_main",
      createdAt: "2026-04-18T00:00:00.000Z",
      workspaceId: "ws_001"
    });

    const run: SqlRun = {
      runId: "run-template-trace-1",
      sessionId: "session-template-trace-1",
      question: "统计订单状态分布",
      status: "executionResult",
      provider: "mock-provider",
      model: "mock-model",
      sql: "SELECT status, COUNT(*) AS cnt FROM orders GROUP BY status;",
      answer: "按状态聚合完成。",
      trace: {
        runId: "run-template-trace-1",
        provider: "mock-provider",
        retryCount: 0,
        steps: [],
        v2: {
          version: "v2",
          stageOrder: [
            "intake",
            "retrieve",
            "assemble-context",
            "semantic-plan",
            "generate-sql",
            "validate",
            "correct",
            "execute",
            "answer"
          ],
          stages: [
            { stage: "intake", status: "success" },
            { stage: "retrieve", status: "success" },
            { stage: "assemble-context", status: "success" },
            { stage: "semantic-plan", status: "success" },
            { stage: "generate-sql", status: "success" },
            { stage: "validate", status: "success" },
            { stage: "correct", status: "skipped" },
            { stage: "execute", status: "success" },
            { stage: "answer", status: "success" }
          ]
        },
        promptTemplate: {
          templateId: "pt_ds_001",
          scene: "sql",
          scope: "datasource",
          version: 3
        }
      },
      createdAt: "2026-04-18T00:00:00.000Z"
    };

    await repository.persistRun(run);

    const runById = await runViewUsecase.getRunById("run-template-trace-1");

    expect(runById.trace.promptTemplate?.templateId).toBe("pt_ds_001");
    expect(runById.trace.promptTemplate?.scope).toBe("datasource");
    expect(runById.delivery?.evidence?.promptTemplate?.templateId).toBe("pt_ds_001");
    expect(runById.delivery?.evidence?.promptTemplate?.version).toBe(3);
  });

  it("returns deterministic hard-cut semantics for legacy prompt_template trace payload", async () => {
    await repository.createSession({
      id: "session-template-trace-legacy",
      datasource: "sqlite_main",
      createdAt: "2026-04-18T00:00:00.000Z"
    });

    const legacyRun = {
      runId: "run-template-trace-legacy",
      sessionId: "session-template-trace-legacy",
      question: "统计订单状态分布",
      status: "executionResult" as const,
      provider: "mock-provider",
      model: "mock-model",
      sql: "SELECT status FROM orders;",
      answer: "legacy format",
      trace: {
        runId: "run-template-trace-legacy",
        provider: "mock-provider",
        retryCount: 0,
        steps: [],
        prompt_template: {
          template_id: "pt_legacy",
          template_scope: "workspace",
          template_version: 5,
          fallback_reason: "legacy_source"
        }
      },
      createdAt: "2026-04-18T00:00:00.000Z"
    } as unknown as SqlRun;

    await repository.persistRun(legacyRun);

    const persistedLegacyRun = await repository.getRunById("run-template-trace-legacy");
    expect(persistedLegacyRun?.trace.promptTemplate).toBeUndefined();

    await expect(
      runViewUsecase.getRunById("run-template-trace-legacy")
    ).rejects.toMatchObject({
      code: "LEGACY_RUN_UNSUPPORTED",
      statusCode: 410,
      details: expect.objectContaining({
        runId: "run-template-trace-legacy",
        migrationRunbook:
          "docs/runbooks/text2sql-v2-hardcut-read-model-migration.md"
      })
    });
  });
});
