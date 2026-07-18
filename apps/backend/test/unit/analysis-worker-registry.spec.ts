import { AnalysisWorkerRegistryService } from "../../src/modules/conversation/analysis/workers/worker-registry.service";
import type { AnalysisWorker } from "../../src/modules/conversation/analysis/workers/worker-contract.types";

describe("AnalysisWorkerRegistryService", () => {
  const worker = {
    workerId: "text2sql.v1",
    workerVersion: "1",
    workKinds: ["text2sql"],
    capabilities: ["datasource.read", "artifact.propose"],
    execute: jest.fn()
  } as AnalysisWorker;

  it("resolves by declared work kind and denies capability escalation", () => {
    const registry = new AnalysisWorkerRegistryService([worker]);
    expect(registry.resolve("text2sql.v1", "text2sql")).toBe(worker);
    expect(() => registry.resolve("text2sql.v1", "research")).toThrow(
      expect.objectContaining({ code: "ANALYSIS_WORKER_NOT_AVAILABLE" })
    );
    expect(() =>
      registry.assertCapabilitySubset(worker.capabilities, ["web.search"])
    ).toThrow(
      expect.objectContaining({ code: "ANALYSIS_CAPABILITY_ESCALATION_DENIED" })
    );
  });
});
