import type {
  Text2SqlAccuracyGateKindV1,
  Text2SqlAccuracyGateReceiptV1,
  Text2SqlEvalVersionTupleV1,
  Text2SqlExecutionReceiptV1,
  Text2SqlResultReceiptV1
} from "@text2sql/shared-types";
import {
  assertText2SqlExecutionPermitBinding,
  createText2SqlAccuracyGateReceipt,
  createText2SqlClosureReceipt,
  createText2SqlExecutionPermitReceipt,
  createText2SqlPolicyReceipt,
  sealPassedText2SqlValidationReceipt
} from "../../src/modules/conversation/contracts/text2sql-v2.types";

const versions: Text2SqlEvalVersionTupleV1 = {
  questionSet: "questions-v1",
  semantic: "semantic-v1",
  schema: "schema-v1",
  policy: "policy-v1",
  data: "data-v1",
  model: "model-v1",
  prompt: "prompt-v1",
  workflow: "workflow-v1",
  code: "code-v1"
};

const binding = {
  runId: "run-1",
  queryContractDigest: "query-contract-1",
  sqlDigest: "sql-1",
  versions
};

function gateReceipt(
  gate: Text2SqlAccuracyGateKindV1,
  overrides: Partial<
    Pick<Text2SqlAccuracyGateReceiptV1, "status" | "capability" | "sqlDigest">
  > = {}
): Text2SqlAccuracyGateReceiptV1 {
  return createText2SqlAccuracyGateReceipt({
    ...binding,
    gate,
    status: "passed",
    capability: "available",
    issuedAt: "2026-07-17T01:00:00.000Z",
    ...overrides
  });
}

const preExecutionGates = (): Text2SqlAccuracyGateReceiptV1[] =>
  (["intent", "semantic", "structural", "policy", "resource"] as const).map(
    (gate) => gateReceipt(gate)
  );

describe("Text2SQL accuracy receipt contracts", () => {
  it("binds trusted policy and dependency closure to the frozen run versions", () => {
    const policy = createText2SqlPolicyReceipt({
      runId: binding.runId,
      queryContractDigest: binding.queryContractDigest,
      versions,
      workspaceId: "workspace-1",
      datasourceId: "datasource-1",
      workspaceDatasourceBindingId: "binding-1",
      policyVersion: "3",
      allowedTables: ["orders"],
      schemaSnapshotDigest: "schema-v1",
      status: "passed",
      reasonCodes: ["frozen_policy_schema_bound"],
      issuedAt: "2026-07-17T01:00:00.000Z"
    });
    const closure = createText2SqlClosureReceipt({
      runId: binding.runId,
      queryContractDigest: binding.queryContractDigest,
      versions,
      status: "passed",
      joinClosure: ["orders.customer_id=customers.id"],
      mandatoryEvidenceRefs: ["relationship:orders-customers"],
      reasonCodes: [],
      issuedAt: "2026-07-17T01:00:00.000Z"
    });

    expect(policy).toMatchObject({
      status: "passed",
      policyVersion: "3",
      schemaSnapshotDigest: "schema-v1"
    });
    expect(closure).toMatchObject({
      status: "passed",
      joinClosure: ["orders.customer_id=customers.id"]
    });
    expect(policy.receiptDigest).toHaveLength(64);
    expect(closure.receiptDigest).toHaveLength(64);
  });

  it("seals a permit only when every pre-execution hard Gate passed", () => {
    const permit = createText2SqlExecutionPermitReceipt({
      ...binding,
      gateReceipts: preExecutionGates(),
      issuedAt: "2026-07-17T01:00:01.000Z",
      expiresAt: "2026-07-17T01:05:01.000Z"
    });

    expect(permit.status).toBe("passed");
    expect(Object.keys(permit.gateReceiptDigests).sort()).toEqual([
      "intent",
      "policy",
      "resource",
      "semantic",
      "structural"
    ]);
    expect(() =>
      assertText2SqlExecutionPermitBinding(permit, {
        ...binding,
        now: new Date("2026-07-17T01:01:00.000Z")
      })
    ).not.toThrow();
  });

  it("rejects unavailable, skipped-shaped, missing, and SQL-mismatched Gate evidence", () => {
    const unavailable = preExecutionGates();
    unavailable[2] = gateReceipt("structural", {
      status: "unavailable",
      capability: "unavailable"
    });
    expect(() =>
      createText2SqlExecutionPermitReceipt({
        ...binding,
        gateReceipts: unavailable,
        issuedAt: "2026-07-17T01:00:01.000Z",
        expiresAt: "2026-07-17T01:05:01.000Z"
      })
    ).toThrow("execution_permit_gate_not_passed:structural");

    const skippedShaped = preExecutionGates();
    skippedShaped[2] = gateReceipt("structural", {
      status: "skipped" as never
    });
    expect(() =>
      createText2SqlExecutionPermitReceipt({
        ...binding,
        gateReceipts: skippedShaped,
        issuedAt: "2026-07-17T01:00:01.000Z",
        expiresAt: "2026-07-17T01:05:01.000Z"
      })
    ).toThrow();

    expect(() =>
      createText2SqlExecutionPermitReceipt({
        ...binding,
        gateReceipts: preExecutionGates().slice(0, 4),
        issuedAt: "2026-07-17T01:00:01.000Z",
        expiresAt: "2026-07-17T01:05:01.000Z"
      })
    ).toThrow("execution_permit_gate_missing:resource");

    const mismatched = preExecutionGates();
    mismatched[4] = gateReceipt("resource", { sqlDigest: "sql-2" });
    expect(() =>
      createText2SqlExecutionPermitReceipt({
        ...binding,
        gateReceipts: mismatched,
        issuedAt: "2026-07-17T01:00:01.000Z",
        expiresAt: "2026-07-17T01:05:01.000Z"
      })
    ).toThrow();
  });

  it("seals final validation only after sandbox execution and Result Gate pass", () => {
    const preGates = preExecutionGates();
    const permit = createText2SqlExecutionPermitReceipt({
      ...binding,
      gateReceipts: preGates,
      issuedAt: "2026-07-17T01:00:01.000Z",
      expiresAt: "2026-07-17T01:05:01.000Z"
    });
    const executionReceipt: Text2SqlExecutionReceiptV1 = {
      version: "execution-receipt.v1",
      receiptId: "execution-1",
      receiptDigest: "execution-digest-1",
      ...binding,
      executionPermitDigest: permit.receiptDigest,
      sandboxGateReceiptDigest: "sandbox-digest-1",
      status: "passed",
      readOnlyEnforced: true,
      authorizationRechecked: true,
      timeoutMs: 1000,
      cancelled: false,
      rowCount: 1,
      byteCount: 12,
      resultDigest: "result-payload-1",
      reasonCodes: [],
      startedAt: "2026-07-17T01:00:02.000Z",
      completedAt: "2026-07-17T01:00:03.000Z"
    };
    const resultReceipt: Text2SqlResultReceiptV1 = {
      version: "result-receipt.v1",
      receiptId: "result-1",
      receiptDigest: "result-digest-1",
      ...binding,
      executionReceiptDigest: executionReceipt.receiptDigest,
      resultContractDigest: "result-contract-1",
      status: "passed",
      resultDigest: executionReceipt.resultDigest,
      schemaMatched: true,
      oracleVerdicts: [
        {
          oracleId: "golden-result",
          kind: "golden_result",
          mandatory: true,
          passed: true,
          evidenceRefs: ["golden:1"]
        }
      ],
      reasonCodes: [],
      issuedAt: "2026-07-17T01:00:04.000Z"
    };
    const finalReceipt = sealPassedText2SqlValidationReceipt({
      permit,
      gateReceipts: [...preGates, gateReceipt("sandbox"), gateReceipt("result")],
      executionReceipt,
      resultReceipt,
      sealedAt: "2026-07-17T01:00:05.000Z"
    });

    expect(finalReceipt.status).toBe("passed");
    expect(finalReceipt.gateReceiptDigests).toHaveLength(7);
    expect(finalReceipt.executionPermitDigest).toBe(permit.receiptDigest);
  });
});
