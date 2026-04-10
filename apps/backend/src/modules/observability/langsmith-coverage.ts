export interface LangsmithCoverageInput {
  totalExecutableRequests: number;
  tracedRequests: number;
  threshold?: number;
  minSampleSize?: number;
}

export interface LangsmithCoverageResult {
  pass: boolean;
  coverage: number;
  tracedRequests: number;
  totalExecutableRequests: number;
  threshold: number;
  minSampleSize: number;
  sampleReady: boolean;
  reason?: string;
}

export const computeLangsmithCoverage = (
  input: LangsmithCoverageInput
): LangsmithCoverageResult => {
  const threshold = input.threshold ?? 0.95;
  const minSampleSize = input.minSampleSize ?? 1;
  const total = Math.max(0, input.totalExecutableRequests);
  const traced = Math.max(0, input.tracedRequests);

  if (total < minSampleSize) {
    return {
      pass: false,
      coverage: 0,
      tracedRequests: traced,
      totalExecutableRequests: total,
      threshold,
      minSampleSize,
      sampleReady: false,
      reason: `sample_too_small: total=${total}, required=${minSampleSize}`
    };
  }

  const coverage = total === 0 ? 0 : traced / total;
  return {
    pass: coverage >= threshold,
    coverage,
    tracedRequests: traced,
    totalExecutableRequests: total,
    threshold,
    minSampleSize,
    sampleReady: true
  };
};
