import type { WriteRagReplayInput } from "../../src/modules/knowledge/rag/observability/rag-replay.repository";
import { SavedPriorSqlService } from "../../src/modules/knowledge/memory/saved-prior-sql.service";
import type { RagDocumentBuildResult } from "../../src/modules/rag/ingestion/rag-document.factory";

const createService = (override?: {
  writeReplay?: (input: WriteRagReplayInput) => Promise<unknown>;
}) => {
  const writeReplay =
    override?.writeReplay ??
    (async (input: WriteRagReplayInput) => ({
      runId: input.runId,
      replayKey: input.replayKey,
      datasourceId: input.datasourceId,
      stage: input.stage,
      payload: JSON.stringify(input.payload),
      createdAt: input.createdAt ?? new Date().toISOString()
    }));
  const replayRepository = {
    writeReplay: jest.fn(writeReplay)
  };
  const buildResult: RagDocumentBuildResult = {
    document: {
      id: "doc-prior-1",
      datasourceId: "ds-1",
      domain: "sql_example",
      sourceType: "sql_example",
      sourceRef: "saved_prior_sql:prior-1",
      sourceVersion: "saved_prior_sql:prior-1:v1",
      contentChecksum: "checksum-1",
      title: "Saved Prior SQL",
      content: "Question: q\nSQL: select 1",
      tableNames: ["orders"],
      columnNames: ["id"],
      metadata: JSON.stringify({
        trusted: true,
        verified: true,
        priorSql: true
      })
    },
    chunks: [
      {
        id: "chunk-prior-1",
        documentId: "doc-prior-1",
        datasourceId: "ds-1",
        domain: "sql_example",
        chunkProfile: "sql_example",
        chunkOrder: 0,
        content: "Question: q\nSQL: select 1",
        contentChecksum: "checksum-1",
        tableNames: ["orders"],
        columnNames: ["id"],
        metadata: JSON.stringify({
          trusted: true,
          verified: true,
          priorSql: true
        })
      }
    ]
  };
  const documentFactory = {
    create: jest.fn().mockReturnValue(buildResult)
  };
  const documentRepository = {
    upsertDocumentWithChunks: jest.fn().mockResolvedValue({
      documentId: "doc-prior-1",
      insertedDocument: true,
      insertedChunkCount: 1
    })
  };
  const indexRepository = {
    upsertChunksForDatasource: jest.fn()
  };
  const buildRagIndexJob = {
    run: jest.fn().mockResolvedValue({
      indexVersionId: "idx-prior-1",
      datasourceId: "ds-1",
      status: "active",
      entryCount: 1,
      archivedChannels: ["lexical", "dense"],
      denseMode: "mock_provider",
      activation: {
        replacedVersionIds: [],
        replacedSourceVersions: []
      }
    })
  };
  const service = new SavedPriorSqlService(
    replayRepository as never,
    documentFactory as never,
    documentRepository as never,
    indexRepository as never,
    buildRagIndexJob as never
  );
  return {
    service,
    replayRepository,
    documentRepository,
    buildRagIndexJob
  };
};

describe("saved prior sql capture integration", () => {
  it("captures trusted prior SQL once and preserves idempotency on duplicate capture", async () => {
    const { service, replayRepository, documentRepository, buildRagIndexJob } =
      createService();
    const first = await service.captureFromSavedView({
      workspaceId: "ws-1",
      datasourceId: "ds-1",
      sourceRunId: "run-1",
      sourceRunStatus: "executionResult",
      sourceRunCreatedAt: "2026-04-25T08:00:00.000Z",
      question: "recent paid orders",
      sql: "SELECT o.id, o.status FROM orders o JOIN users u ON u.id = o.user_id WHERE o.status = 'paid'",
      viewId: "view.chat_run.run-1",
      viewName: "orders_paid_recent",
      viewSql: "SELECT o.id, o.status FROM orders o JOIN users u ON u.id = o.user_id WHERE o.status = 'paid'",
      replayed: false,
      savedAt: "2026-04-25T09:00:00.000Z"
    });

    expect(first.outcome).toBe("captured");
    expect(first.record).toEqual(
      expect.objectContaining({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        sourceRunId: "run-1",
        viewId: "view.chat_run.run-1",
        question: "recent paid orders",
        sql: expect.stringContaining("FROM orders"),
        savedAt: "2026-04-25T09:00:00.000Z",
        metadata: {
          trusted: true,
          verified: true,
          priorSql: true
        }
      })
    );
    expect(first.record?.tableNames).toEqual(
      expect.arrayContaining(["orders", "users"])
    );
    expect(first.record?.columnNames).toEqual(
      expect.arrayContaining(["id", "status"])
    );
    expect(replayRepository.writeReplay).toHaveBeenCalledTimes(1);
    expect(documentRepository.upsertDocumentWithChunks).toHaveBeenCalledTimes(1);
    expect(buildRagIndexJob.run).toHaveBeenCalledTimes(1);

    const second = await service.captureFromSavedView({
      workspaceId: "ws-1",
      datasourceId: "ds-1",
      sourceRunId: "run-1",
      sourceRunStatus: "executionResult",
      question: "recent paid orders",
      sql: "SELECT o.id, o.status FROM orders o JOIN users u ON u.id = o.user_id WHERE o.status = 'paid'",
      viewId: "view.chat_run.run-1",
      viewName: "orders_paid_recent",
      viewSql: "SELECT o.id, o.status FROM orders o JOIN users u ON u.id = o.user_id WHERE o.status = 'paid'",
      replayed: false
    });

    expect(second.outcome).toBe("duplicate");
    expect(second.reason).toBe("prior_already_captured");
    expect(second.priorId).toBe(first.priorId);
    expect(replayRepository.writeReplay).toHaveBeenCalledTimes(2);
    expect(service.listRecords()).toHaveLength(1);
  });

  it("marks replayed save request as duplicate no-op", async () => {
    const { service, documentRepository, buildRagIndexJob } = createService();
    const result = await service.captureFromSavedView({
      workspaceId: "ws-1",
      datasourceId: "ds-1",
      sourceRunId: "run-1",
      sourceRunStatus: "executionResult",
      question: "recent paid orders",
      sql: "SELECT * FROM orders",
      viewId: "view.chat_run.run-1",
      viewName: "orders_recent",
      viewSql: "SELECT * FROM orders",
      replayed: true
    });

    expect(result.outcome).toBe("duplicate");
    expect(result.reason).toBe("save_replayed");
    expect(result.record).toBeUndefined();
    expect(service.listRecords()).toHaveLength(0);
    expect(documentRepository.upsertDocumentWithChunks).toHaveBeenCalledTimes(0);
    expect(buildRagIndexJob.run).toHaveBeenCalledTimes(0);
  });

  it("skips capture for ineligible source run status", async () => {
    const { service, documentRepository, buildRagIndexJob } = createService();
    const result = await service.captureFromSavedView({
      workspaceId: "ws-1",
      datasourceId: "ds-1",
      sourceRunId: "run-1",
      sourceRunStatus: "failed",
      question: "recent paid orders",
      sql: "SELECT * FROM orders",
      viewId: "view.chat_run.run-1",
      viewName: "orders_recent",
      viewSql: "SELECT * FROM orders",
      replayed: false
    });

    expect(result.outcome).toBe("skipped_ineligible");
    expect(result.reason).toBe("source_run_not_execution_result");
    expect(service.getRecord(result.priorId)).toBeUndefined();
    expect(documentRepository.upsertDocumentWithChunks).toHaveBeenCalledTimes(0);
    expect(buildRagIndexJob.run).toHaveBeenCalledTimes(0);
  });
});
