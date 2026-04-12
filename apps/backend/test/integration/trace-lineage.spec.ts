import { Test } from "@nestjs/testing";
import { GateMetricsService } from "../../src/modules/observability/gate-metrics.service";
import { ObservabilityModule } from "../../src/modules/observability/observability.module";
import { TraceService } from "../../src/modules/observability/trace.service";

describe("trace lineage", () => {
  it("should record and retrieve trace by runId", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ObservabilityModule]
    }).compile();
    const traceService = moduleRef.get(TraceService);
    const gateMetrics = moduleRef.get(GateMetricsService);
    gateMetrics.reset();
    traceService.record({
      runId: "run-x",
      provider: "volcengine",
      retryCount: 0,
      steps: [
        {
          node: "clarify",
          status: "success",
          at: new Date().toISOString()
        }
      ]
    }, {
      status: "executionResult"
    });
    const trace = traceService.get("run-x");
    expect(trace?.steps.length).toBe(1);
    const snapshot = gateMetrics.snapshot();
    expect(snapshot.observedRuns).toBe(1);
    expect(snapshot.successRate).toBe(1);
  });
});
