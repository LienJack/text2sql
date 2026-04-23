import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { SemanticSpineShadowService } from "../../src/modules/knowledge/semantic-spine/semantic-spine-shadow.service";

describe("semantic spine shadow gate integration", () => {
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

  it("passes shadow gate when thresholds are met with sufficient samples", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const shadow = moduleRef.get(SemanticSpineShadowService);
    shadow.reset();

    for (let index = 0; index < 36; index += 1) {
      shadow.recordSample({
        runId: `run-shadow-pass-${index}`,
        datasourceId: "ds-shadow-pass",
        accuracyLift: 0.14,
        semanticConsistencyLift: 0.13,
        latencyOverheadMs: 120,
        degradeRate: 0.06
      });
    }

    const report = shadow.snapshot();
    expect(report.sampleReady).toBe(true);
    expect(report.gatePass).toBe(true);
    expect(report.reasons).toEqual([]);

    await moduleRef.close();
  });

  it("blocks shadow gate when latency overhead exceeds threshold", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const shadow = moduleRef.get(SemanticSpineShadowService);
    shadow.reset();

    for (let index = 0; index < 32; index += 1) {
      shadow.recordSample({
        runId: `run-shadow-fail-${index}`,
        datasourceId: "ds-shadow-fail",
        accuracyLift: 0.15,
        semanticConsistencyLift: 0.14,
        latencyOverheadMs: 260,
        degradeRate: 0.04
      });
    }

    const report = shadow.snapshot();
    expect(report.sampleReady).toBe(true);
    expect(report.gatePass).toBe(false);
    expect(report.reasons).toEqual(
      expect.arrayContaining(["latency_overhead_p95_exceeded"])
    );

    await moduleRef.close();
  });
});
