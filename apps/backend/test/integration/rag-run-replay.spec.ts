import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { RagReplayRepository } from "../../src/modules/rag/observability/rag-replay.repository";
import { RagQualityService } from "../../src/modules/rag/quality/rag-quality.service";

describe("rag run replay completeness integration", () => {
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

  it("reports replay as ready when all required stages are present", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const replay = moduleRef.get(RagReplayRepository);
    const quality = moduleRef.get(RagQualityService);
    const runId = "run-rag-replay-complete-v1";

    await replay.writeReplay({
      runId,
      replayKey: "retrieval:lane:lexical",
      datasourceId: "ds-rag-replay",
      stage: "retrieval_lane",
      payload: {}
    });
    await replay.writeReplay({
      runId,
      replayKey: "retrieval:fused",
      datasourceId: "ds-rag-replay",
      stage: "retrieval_fused",
      payload: {}
    });
    await replay.writeReplay({
      runId,
      replayKey: "rerank:primary",
      datasourceId: "ds-rag-replay",
      stage: "rerank_primary",
      payload: {}
    });
    await replay.writeReplay({
      runId,
      replayKey: "rerank:secondary",
      datasourceId: "ds-rag-replay",
      stage: "rerank_secondary",
      payload: {}
    });
    await replay.writeReplay({
      runId,
      replayKey: "rerank:final",
      datasourceId: "ds-rag-replay",
      stage: "rerank_finalized",
      payload: {}
    });

    const report = await quality.getReplayCompleteness(runId);
    expect(report.ready).toBe(true);
    expect(report.completeness).toBe(1);
    expect(report.missingStages).toHaveLength(0);

    await moduleRef.close();
  });

  it("reports replay as not ready when required stages are missing", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const replay = moduleRef.get(RagReplayRepository);
    const quality = moduleRef.get(RagQualityService);
    const runId = "run-rag-replay-incomplete-v1";

    await replay.writeReplay({
      runId,
      replayKey: "retrieval:lane:lexical",
      datasourceId: "ds-rag-replay",
      stage: "retrieval_lane",
      payload: {}
    });
    await replay.writeReplay({
      runId,
      replayKey: "rerank:primary",
      datasourceId: "ds-rag-replay",
      stage: "rerank_primary",
      payload: {}
    });

    const report = await quality.getReplayCompleteness(runId);
    expect(report.ready).toBe(false);
    expect(report.completeness).toBeLessThan(1);
    expect(report.missingStages).toEqual(
      expect.arrayContaining(["retrieval_fused", "rerank_secondary", "rerank_finalized"])
    );

    await moduleRef.close();
  });

  it("persists rerank metadata payload for replay diagnostics", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const replay = moduleRef.get(RagReplayRepository);
    const runId = "run-rag-replay-rerank-metadata-v1";

    await replay.writeReplay({
      runId,
      replayKey: "rerank:secondary",
      datasourceId: "ds-rag-replay",
      stage: "rerank_secondary",
      payload: {
        status: "degraded",
        reason: "secondary_rerank_unavailable_provider_config_missing",
        metadata: {
          status: "degraded",
          unavailable_reason: "secondary_rerank_unavailable_provider_config_missing",
          input_count: 4,
          output_count: 0
        }
      }
    });

    const events = await replay.listByRunId(runId);
    const secondary = events.find((item) => item.replayKey === "rerank:secondary");
    const payload = JSON.parse(secondary?.payload ?? "{}") as {
      metadata?: {
        unavailable_reason?: string;
        input_count?: number;
        output_count?: number;
      };
    };
    expect(payload.metadata?.unavailable_reason).toBe(
      "secondary_rerank_unavailable_provider_config_missing"
    );
    expect(payload.metadata?.input_count).toBe(4);
    expect(payload.metadata?.output_count).toBe(0);

    await moduleRef.close();
  });
});
