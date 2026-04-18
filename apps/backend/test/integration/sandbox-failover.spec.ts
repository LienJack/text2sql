import type { SqlRun } from "@text2sql/shared-types";
import { DeliveryContractMapper } from "../../src/modules/delivery/delivery-contract.mapper";
import {
  DELIVERY_SANDBOX_REPLAY_KEY,
  SandboxRuntimeService
} from "../../src/modules/delivery/sandbox/sandbox-runtime.service";

const createBaseRun = (override: Partial<SqlRun> = {}): SqlRun => ({
  runId: "run-sandbox-failover",
  sessionId: "session-sandbox-failover",
  question: "统计订单状态分布",
  status: "executionResult",
  provider: "volcengine",
  model: "mock-model",
  answer: "共 3 种订单状态。",
  sql: "SELECT status, COUNT(*) AS count FROM orders GROUP BY status",
  rows: [
    { status: "paid", count: 4 },
    { status: "pending", count: 2 },
    { status: "closed", count: 1 }
  ],
  columns: ["status", "count"],
  trace: {
    runId: "run-sandbox-failover",
    provider: "volcengine",
    retryCount: 0,
    steps: []
  },
  llmRaw: null,
  createdAt: "2026-04-18T00:00:00.000Z",
  ...override
});

describe("sandbox failover integration", () => {
  it("fails closed for sandbox operation while preserving the main answer and artifact", () => {
    const mapper = new DeliveryContractMapper(new SandboxRuntimeService());
    const run = createBaseRun();

    const delivery = mapper.map({
      run,
      replayRecords: [
        {
          replayKey: DELIVERY_SANDBOX_REPLAY_KEY,
          stage: "delivery_sandbox_postprocess",
          payload: JSON.stringify({
            operations: [
              {
                type: "network_request",
                host: "example.com",
                protocol: "https",
                port: 443
              },
              {
                type: "rows_preview_limit",
                maxRows: 1
              }
            ]
          }),
          createdAt: "2026-04-18T00:00:01.000Z"
        }
      ]
    });

    expect(delivery.answer.text).toBe("共 3 种订单状态。");
    expect(delivery.artifact?.rowCount).toBe(3);
    expect(delivery.artifact?.rowsPreview).toHaveLength(3);
    expect(delivery.evidence?.riskTags).toEqual(
      expect.arrayContaining(["sandbox_failed", "sandbox_network_denied"])
    );
  });

  it("degrades gracefully when sandbox runtime throws", () => {
    const mapper = new DeliveryContractMapper(({
      executeArtifactPostProcess: () => {
        throw new Error("sandbox crash");
      }
    } as unknown) as SandboxRuntimeService);

    const run = createBaseRun();
    const delivery = mapper.map({
      run,
      replayRecords: [
        {
          replayKey: DELIVERY_SANDBOX_REPLAY_KEY,
          stage: "delivery_sandbox_postprocess",
          payload: JSON.stringify({
            operations: [
              {
                type: "rows_preview_limit",
                maxRows: 1
              }
            ]
          }),
          createdAt: "2026-04-18T00:00:02.000Z"
        }
      ]
    });

    expect(delivery.answer.text).toBe("共 3 种订单状态。");
    expect(delivery.artifact?.rowsPreview).toHaveLength(3);
    expect(delivery.evidence?.riskTags).toEqual(
      expect.arrayContaining(["sandbox_failed", "sandbox_runtime_failed"])
    );
  });
});
