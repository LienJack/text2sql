import type { SqlRun } from "@text2sql/shared-types";
import {
  MemoryPromotionPolicy,
  type MemoryPromotionRecord
} from "../../src/modules/memory/memory-promotion-policy";

function createRun(override: Partial<SqlRun> = {}): SqlRun {
  return {
    runId: "run-memory-policy-1",
    sessionId: "session-memory-policy-1",
    question: "统计订单总量",
    status: "executionResult",
    provider: "volcengine",
    model: "mock-model",
    sql: "SELECT COUNT(*) AS total FROM orders",
    answer: "订单总量为 10",
    rows: [{ total: 10 }],
    columns: ["total"],
    trace: {
      runId: "run-memory-policy-1",
      provider: "volcengine",
      retryCount: 0,
      steps: []
    },
    llmRaw: null,
    createdAt: "2026-04-18T00:00:00.000Z",
    ...override
  };
}

function createRecord(
  override: Partial<MemoryPromotionRecord> = {}
): MemoryPromotionRecord {
  return {
    candidateId: "memory-candidate-policy",
    status: "candidate",
    evidence: {
      sampleCount: 0,
      successCount: 0,
      riskFlagCount: 0,
      successRate: 0
    },
    version: 0,
    lastRunId: null,
    lastTransitionKey: null,
    updatedAt: "2026-04-18T00:00:00.000Z",
    ...override
  };
}

describe("MemoryPromotionPolicy", () => {
  it("transitions candidate to verified when thresholds are met", () => {
    const policy = new MemoryPromotionPolicy();
    const run = createRun();
    const record = createRecord({
      status: "candidate"
    });

    const result = policy.evaluate({
      record,
      run,
      riskTags: []
    });

    expect(result.transition?.from).toBe("candidate");
    expect(result.transition?.to).toBe("verified");
    expect(result.transition?.transitionKey).toBe(
      "memory-candidate-policy:candidate->verified"
    );
    expect(result.rejectionReasons).toEqual([]);
    expect(result.nextEvidence.sampleCount).toBe(1);
    expect(result.nextEvidence.successCount).toBe(1);
    expect(result.nextEvidence.riskFlagCount).toBe(0);
    expect(result.nextEvidence.successRate).toBe(1);
  });

  it("keeps candidate when evidence is insufficient and returns structured reasons", () => {
    const policy = new MemoryPromotionPolicy({
      minSamplesForVerified: 2,
      minSuccessesForVerified: 2
    });
    const run = createRun({
      status: "failed",
      sql: undefined,
      error: "execution failed"
    });
    const record = createRecord({
      status: "candidate"
    });

    const result = policy.evaluate({
      record,
      run,
      riskTags: ["delivery_mapper_failed"]
    });

    expect(result.transition).toBeUndefined();
    expect(result.rejectionReasons).toEqual(
      expect.arrayContaining([
        "insufficient_samples_for_verified",
        "insufficient_successes_for_verified",
        "risk_threshold_exceeded_for_verified"
      ])
    );
    expect(result.nextEvidence.sampleCount).toBe(1);
    expect(result.nextEvidence.successCount).toBe(0);
    expect(result.nextEvidence.riskFlagCount).toBe(1);
    expect(result.nextEvidence.successRate).toBe(0);
  });

  it("transitions verified to production only when production thresholds are met", () => {
    const policy = new MemoryPromotionPolicy();
    const run = createRun({
      runId: "run-memory-policy-2"
    });
    const record = createRecord({
      status: "verified",
      evidence: {
        sampleCount: 2,
        successCount: 2,
        riskFlagCount: 0,
        successRate: 1
      },
      version: 2,
      lastRunId: "run-memory-policy-1"
    });

    const result = policy.evaluate({
      record,
      run,
      riskTags: []
    });

    expect(result.transition?.from).toBe("verified");
    expect(result.transition?.to).toBe("production");
    expect(result.rejectionReasons).toEqual([]);
    expect(result.nextEvidence.sampleCount).toBe(3);
    expect(result.nextEvidence.successCount).toBe(3);
    expect(result.nextEvidence.successRate).toBe(1);
  });

  it("keeps production unchanged and returns already_production reason", () => {
    const policy = new MemoryPromotionPolicy();
    const run = createRun({
      runId: "run-memory-policy-production"
    });
    const record = createRecord({
      status: "production",
      evidence: {
        sampleCount: 3,
        successCount: 3,
        riskFlagCount: 0,
        successRate: 1
      },
      version: 3
    });

    const result = policy.evaluate({
      record,
      run,
      riskTags: []
    });

    expect(result.transition).toBeUndefined();
    expect(result.rejectionReasons).toEqual(["already_production"]);
    expect(result.nextEvidence.sampleCount).toBe(4);
    expect(result.nextEvidence.successCount).toBe(4);
    expect(result.nextEvidence.successRate).toBe(1);
  });

  it("rejects invalid transition key construction", () => {
    const policy = new MemoryPromotionPolicy();
    expect(() =>
      policy.buildTransitionKey({
        candidateId: "memory-candidate-policy",
        from: "production",
        to: "verified"
      })
    ).toThrow("非法记忆状态迁移");
  });
});
