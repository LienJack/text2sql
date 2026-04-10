import { computeLangsmithCoverage } from "../../src/modules/observability/langsmith-coverage";

describe("langsmith coverage", () => {
  it("should pass when coverage is above threshold", () => {
    const result = computeLangsmithCoverage({
      totalExecutableRequests: 100,
      tracedRequests: 97,
      threshold: 0.95
    });
    expect(result.sampleReady).toBe(true);
    expect(result.pass).toBe(true);
    expect(result.coverage).toBeCloseTo(0.97);
  });

  it("should fail when sample is below minimum size", () => {
    const result = computeLangsmithCoverage({
      totalExecutableRequests: 5,
      tracedRequests: 5,
      threshold: 0.95,
      minSampleSize: 10
    });
    expect(result.sampleReady).toBe(false);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("sample_too_small");
  });
});
