import { resolve } from "node:path";
import type { Request } from "express";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import {
  RagIngestionMetricsService,
  type RagIngestionMetricsSnapshot
} from "../../src/modules/rag/observability/rag-ingestion-metrics.service";
import { BuildRagIndexJob } from "../../src/modules/rag/jobs/build-rag-index.job";
import { RagIndexRepository } from "../../src/modules/rag/index/rag-index.repository";
import { HealthController } from "../../src/modules/system/health.controller";

type HealthPayload = {
  dependencies: {
    ragIngestionMetrics: {
      foundation: RagIngestionMetricsSnapshot;
    };
  };
};

describe("rag foundation observability integration", () => {
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

  it("returns degraded reason when active index is missing", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const controller = moduleRef.get(HealthController);
    const ingestionMetrics = moduleRef.get(RagIngestionMetricsService);
    ingestionMetrics.reset();
    const response = await controller.health({
      requestId: "req-rag-foundation-observability-empty"
    } as unknown as Request);
    expect(response.status).toBe("success");
    if (response.status !== "success") {
      throw new Error("health endpoint returned unexpected error response");
    }

    const payload = response.data as HealthPayload;
    const summary = payload.dependencies.ragIngestionMetrics.foundation;
    expect(summary.observedBuilds).toBe(0);
    expect(summary.activeIndexSummary.total).toBe(0);
    expect(summary.degradedReason).toBe("no_active_index");

    await moduleRef.close();
  });

  it("aggregates active index summary, build counters/rate and activation latency stats", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const controller = moduleRef.get(HealthController);
    const ingestionMetrics = moduleRef.get(RagIngestionMetricsService);
    ingestionMetrics.reset();
    ingestionMetrics.recordBuild({
      datasourceId: "ds-rag-foundation-a",
      status: "failure",
      failureReason: "activation_timeout"
    });
    ingestionMetrics.recordBuild({
      datasourceId: "ds-rag-foundation-a",
      status: "success",
      indexVersionId: "idx-rag-foundation-a-v2",
      sourceVersion: "source-v2",
      activationLatencyMs: 120
    });
    ingestionMetrics.recordBuild({
      datasourceId: "ds-rag-foundation-b",
      status: "success",
      indexVersionId: "idx-rag-foundation-b-v3",
      sourceVersion: "source-v3",
      activationLatencyMs: 320
    });
    const response = await controller.health({
      requestId: "req-rag-foundation-observability-aggregated"
    } as unknown as Request);
    expect(response.status).toBe("success");
    if (response.status !== "success") {
      throw new Error("health endpoint returned unexpected error response");
    }

    const payload = response.data as HealthPayload;
    const summary = payload.dependencies.ragIngestionMetrics.foundation;
    expect(summary.observedBuilds).toBe(3);
    expect(summary.buildSuccessCount).toBe(2);
    expect(summary.buildFailureCount).toBe(1);
    expect(summary.buildSuccessRate).toBeCloseTo(2 / 3);
    expect(summary.buildFailureRate).toBeCloseTo(1 / 3);
    expect(summary.failureReasons.activation_timeout).toBe(1);
    expect(summary.activationLatencyMs.count).toBe(2);
    expect(summary.activationLatencyMs.min).toBe(120);
    expect(summary.activationLatencyMs.max).toBe(320);
    expect(summary.activationLatencyMs.p50).toBe(120);
    expect(summary.activationLatencyMs.p95).toBe(320);
    expect(summary.activeIndexSummary.total).toBe(2);
    expect(summary.activeIndexSummary.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          datasourceId: "ds-rag-foundation-a",
          indexVersionId: "idx-rag-foundation-a-v2",
          sourceVersion: "source-v2"
        }),
        expect.objectContaining({
          datasourceId: "ds-rag-foundation-b",
          indexVersionId: "idx-rag-foundation-b-v3",
          sourceVersion: "source-v3"
        })
      ])
    );
    expect(summary.degradedReason).toBeUndefined();

    await moduleRef.close();
  });

  it("updates health summary from real build job events", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const controller = moduleRef.get(HealthController);
    const ingestionMetrics = moduleRef.get(RagIngestionMetricsService);
    const indexRepository = moduleRef.get(RagIndexRepository);
    const buildJob = moduleRef.get(BuildRagIndexJob);
    ingestionMetrics.reset();

    indexRepository.seedChunksForDatasource("ds-rag-observability-job", [
      {
        id: "chunk-observability-job-1",
        datasourceId: "ds-rag-observability-job",
        domain: "schema",
        content: "table users(id, email)"
      }
    ]);

    await buildJob.run({
      datasourceId: "ds-rag-observability-job",
      sourceVersion: "source-observability-v1",
      runId: "run-rag-observability-job"
    });

    const response = await controller.health({
      requestId: "req-rag-foundation-observability-from-job"
    } as unknown as Request);
    expect(response.status).toBe("success");
    if (response.status !== "success") {
      throw new Error("health endpoint returned unexpected error response");
    }
    const payload = response.data as HealthPayload;
    const summary = payload.dependencies.ragIngestionMetrics.foundation;

    expect(summary.observedBuilds).toBe(1);
    expect(summary.buildSuccessCount).toBe(1);
    expect(summary.buildFailureCount).toBe(0);
    expect(summary.activeIndexSummary.total).toBe(1);
    expect(summary.activeIndexSummary.items[0]?.datasourceId).toBe(
      "ds-rag-observability-job"
    );
    expect(summary.degradedReason).toBeUndefined();

    await moduleRef.close();
  });
});
