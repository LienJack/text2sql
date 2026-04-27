import { DomainError } from "../../src/common/domain-error";
import { RagTaskHealthProbeService } from "../../src/modules/llm/rag-task-health-probe.service";

describe("RagTaskHealthProbeService", () => {
  it("returns dimension_mismatch when embedding vector length differs from expected", async () => {
    const service = new RagTaskHealthProbeService();

    const result = await service.probeEmbedding({
      runtimeDimensions: 3,
      expectedDimensions: 4
    });

    expect(result.status).toBe("failed");
    expect(result.reasonCode).toBe("dimension_mismatch");
    expect(result.details?.expectedDimensions).toBe(4);
    expect(result.details?.actualDimensions).toBe(3);
  });

  it("returns sample_not_ready for rerank challenge when candidates are insufficient", async () => {
    const service = new RagTaskHealthProbeService();

    const result = await service.probeRerank({
      sampleCandidates: ["only one"]
    });

    expect(result.status).toBe("degraded");
    expect(result.reasonCode).toBe("sample_not_ready");
    expect(result.challenge.status).toBe("sample_not_ready");
  });

  it("maps provider unavailable errors into stable reason code", async () => {
    const service = new RagTaskHealthProbeService();
    const result = await (service as unknown as { mapProbeFailure: (error: unknown) => { status: string; reasonCode: string } })
      .mapProbeFailure(new DomainError("EMBEDDING_PROVIDER_UNAVAILABLE", "provider unavailable", 503));
    expect(result.status).toBe("degraded");
    expect(result.reasonCode).toBe("provider_unavailable");
  });
});
