import { Test } from "@nestjs/testing";
import { ObservabilityModule } from "../../src/modules/observability/observability.module";
import { TraceService } from "../../src/modules/observability/trace.service";

describe("trace lineage", () => {
  it("should record and retrieve trace by runId", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ObservabilityModule]
    }).compile();
    const traceService = moduleRef.get(TraceService);
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
    });
    const trace = traceService.get("run-x");
    expect(trace?.steps.length).toBe(1);
  });
});

