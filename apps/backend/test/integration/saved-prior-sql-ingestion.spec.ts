import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { SavedPriorSqlService } from "../../src/modules/knowledge/memory/saved-prior-sql.service";
import { RagIndexBuilderService } from "../../src/modules/rag/index/rag-index-builder.service";
import { RagIndexRepository } from "../../src/modules/rag/index/rag-index.repository";
import { RagRetrievalService } from "../../src/modules/knowledge/rag/retrieval/rag-retrieval.service";

describe("saved prior sql ingestion integration", () => {
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

  it("upserts saved prior SQL into active index and keeps duplicate capture idempotent", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const indexRepository = moduleRef.get(RagIndexRepository);
    const indexBuilder = moduleRef.get(RagIndexBuilderService);
    const savedPriorService = moduleRef.get(SavedPriorSqlService);
    const retrievalService = moduleRef.get(RagRetrievalService);

    const datasourceId = "ds-saved-prior-ingestion";
    const workspaceId = "ws-saved-prior-ingestion";

    indexRepository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-ingestion-schema-orders",
        datasourceId,
        domain: "schema",
        content: "table orders(id, amount, status)",
        metadata: JSON.stringify({
          tableNames: ["orders"],
          columnNames: ["id", "amount", "status"]
        })
      }
    ]);

    await indexBuilder.buildAndActivate({
      datasourceId,
      sourceVersion: "source-saved-prior-ingestion-bootstrap-v1",
      createdByRunId: "run-saved-prior-ingestion-bootstrap-v1",
      activatedByRunId: "run-saved-prior-ingestion-bootstrap-v1"
    });

    const first = await savedPriorService.captureFromSavedView({
      workspaceId,
      datasourceId,
      sourceRunId: "run-saved-prior-source-v1",
      sourceRunStatus: "executionResult",
      sourceRunCreatedAt: "2026-04-25T08:00:00.000Z",
      question: "orders paid gmv",
      sql: "SELECT SUM(amount) FROM orders WHERE status = 'paid'",
      viewId: "view.chat_run.run-saved-prior-source-v1",
      viewName: "orders_paid_gmv",
      viewSql: "SELECT SUM(amount) FROM orders WHERE status = 'paid'",
      tableNames: ["orders"],
      columnNames: ["amount", "status"],
      replayed: false,
      savedAt: "2026-04-25T08:00:00.000Z"
    });

    expect(first.outcome).toBe("captured");

    const response = await retrievalService.retrieve({
      query: "orders paid gmv",
      datasourceId,
      workspaceId,
      allowedTables: ["orders"],
      runId: "run-saved-prior-retrieve-v1"
    });

    expect(response.retrieval_bundle.prior_sql_lane?.status).toBe("hit");
    expect(response.retrieval_bundle.prior_sql_lane?.selected_count).toBe(1);
    expect(response.retrieval_bundle.candidates[0]?.chunk.metadata.domain).toBe("sql_example");

    const second = await savedPriorService.captureFromSavedView({
      workspaceId,
      datasourceId,
      sourceRunId: "run-saved-prior-source-v1",
      sourceRunStatus: "executionResult",
      question: "orders paid gmv",
      sql: "SELECT SUM(amount) FROM orders WHERE status = 'paid'",
      viewId: "view.chat_run.run-saved-prior-source-v1",
      viewName: "orders_paid_gmv",
      viewSql: "SELECT SUM(amount) FROM orders WHERE status = 'paid'",
      tableNames: ["orders"],
      columnNames: ["amount", "status"],
      replayed: false
    });

    expect(second.outcome).toBe("duplicate");

    const activeVersion = await indexRepository.getActiveVersion(datasourceId);
    expect(activeVersion).toBeDefined();
    const activeEntries = await indexRepository.listEntriesByVersion(activeVersion?.id ?? "");
    const priorChunkIds = activeEntries.filter((item) => item.domain === "sql_example");
    expect(priorChunkIds).toHaveLength(1);
    const priorMetadata = JSON.parse(priorChunkIds[0]?.metadata ?? "{}");
    expect(priorMetadata.sourceMetadata).toEqual(
      expect.objectContaining({
        assetFamily: "prior_question_sql",
        preparationStatus: "prepared",
        visibilityScope: "workspace",
        trusted: true,
        verified: true,
        viewStatus: "active",
        compatibilitySignals: expect.objectContaining({
          viewStatus: "active"
        })
      })
    );

    await moduleRef.close();
  });
});
