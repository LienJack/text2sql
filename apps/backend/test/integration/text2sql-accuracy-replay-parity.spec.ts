import type {
  SqlRun,
  Text2SqlAccuracyEvidenceV1,
  Text2SqlEvalVersionTupleV1,
  Text2SqlQueryContractV1
} from "@text2sql/shared-types";
import {
  createText2SqlAccuracyGateReceipt,
  createText2SqlExecutionPermitReceipt,
  createText2SqlExecutionReceipt,
  createText2SqlResultReceipt,
  sealPassedText2SqlValidationReceipt
} from "../../src/modules/conversation/contracts/text2sql-v2.types";
import {
  buildText2SqlAccuracyDeliverySummary,
  withoutRawAccuracyEvidence
} from "../../src/modules/platform/read-model/text2sql-accuracy-evidence.projection";
import { DeliveryContractMapper } from "../../src/modules/conversation/delivery/delivery-contract.mapper";
import { SandboxRuntimeService } from "../../src/modules/conversation/delivery/sandbox/sandbox-runtime.service";

describe("Text2SQL accuracy sync/delivery/replay parity", () => {
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
  const queryContract: Text2SqlQueryContractV1 = {
    version: "query-contract.v1",
    id: "query-contract-1",
    digest: "query-contract-digest-1",
    runId: "run-accuracy-parity",
    questionDigest: "question-digest-1",
    route: "text_to_sql",
    metrics: ["order_count"],
    dimensions: [],
    requiredColumns: ["orders.id"],
    filters: ["workspace-secret-filter"],
    grain: [],
    sort: [],
    resultShape: {
      cardinality: "scalar",
      columns: [{ name: "total", semanticType: "metric" }]
    },
    frozenAt: "2026-07-17T00:00:00.000Z"
  };

  const buildEvidence = (): Text2SqlAccuracyEvidenceV1 => {
    const issuedAt = "2026-07-17T00:00:00.000Z";
    const sqlDigest = "sql-digest-1";
    const gates = [] as ReturnType<typeof createText2SqlAccuracyGateReceipt>[];
    for (const gate of ["intent", "semantic", "structural", "policy", "resource"] as const) {
      gates.push(
        createText2SqlAccuracyGateReceipt({
          runId: queryContract.runId,
          queryContractDigest: queryContract.digest,
          sqlDigest,
          versions,
          gate,
          status: "passed",
          capability: "available",
          reasonCodes: [`${gate}_passed`],
          evidenceRefs: [`${gate}:evidence`],
          parentReceiptDigests: gates.map((receipt) => receipt.receiptDigest),
          issuedAt
        })
      );
    }
    const permit = createText2SqlExecutionPermitReceipt({
      runId: queryContract.runId,
      queryContractDigest: queryContract.digest,
      sqlDigest,
      versions,
      gateReceipts: gates,
      issuedAt,
      expiresAt: "2099-07-17T00:00:00.000Z"
    });
    const sandboxGate = createText2SqlAccuracyGateReceipt({
      runId: queryContract.runId,
      queryContractDigest: queryContract.digest,
      sqlDigest,
      versions,
      gate: "sandbox",
      status: "passed",
      capability: "available",
      reasonCodes: ["sandbox_passed"],
      evidenceRefs: ["sandbox:evidence"],
      parentReceiptDigests: [permit.receiptDigest],
      issuedAt
    });
    const executionReceipt = createText2SqlExecutionReceipt({
      permit,
      sandboxGateReceipt: sandboxGate,
      status: "passed",
      readOnlyEnforced: true,
      authorizationRechecked: true,
      timeoutMs: 1_000,
      cancelled: false,
      rowCount: 1,
      byteCount: 12,
      resultDigest: "result-digest-1",
      reasonCodes: [],
      startedAt: issuedAt,
      completedAt: "2026-07-17T00:00:00.100Z"
    });
    const resultReceipt = createText2SqlResultReceipt({
      permit,
      executionReceipt,
      resultContractDigest: "result-contract-digest-1",
      status: "passed",
      resultDigest: "result-digest-1",
      schemaMatched: true,
      oracleVerdicts: [
        {
          oracleId: "schema-shape.v1",
          kind: "business_invariant",
          mandatory: true,
          passed: true,
          evidenceRefs: ["result-digest-1"]
        }
      ],
      issuedAt
    });
    const resultGate = createText2SqlAccuracyGateReceipt({
      runId: queryContract.runId,
      queryContractDigest: queryContract.digest,
      sqlDigest,
      versions,
      gate: "result",
      status: "passed",
      capability: "available",
      reasonCodes: ["result_passed"],
      evidenceRefs: [resultReceipt.receiptId],
      parentReceiptDigests: [executionReceipt.receiptDigest],
      issuedAt
    });
    const gateReceipts = [...gates, sandboxGate, resultGate];
    const validationReceipt = sealPassedText2SqlValidationReceipt({
      permit,
      gateReceipts,
      executionReceipt,
      resultReceipt,
      sealedAt: issuedAt
    });
    return {
      version: "text2sql-accuracy-evidence.v1",
      queryContract,
      versions,
      gateReceipts,
      executionPermit: permit,
      executionReceipt,
      resultReceipt,
      validationReceipt
    };
  };

  const buildRun = (accuracy: Text2SqlAccuracyEvidenceV1): SqlRun => ({
    runId: queryContract.runId,
    sessionId: "session-1",
    question: "统计订单数",
    status: "executionResult",
    provider: "test",
    sql: "SELECT COUNT(*) AS total FROM orders",
    answer: "10",
    columns: ["total"],
    rows: [{ total: 10 }],
    trace: {
      runId: queryContract.runId,
      provider: "test",
      retryCount: 0,
      steps: [],
      v2: {
        version: "v2",
        stageOrder: [
          "intake", "retrieve", "assemble-context", "semantic-plan",
          "generate-sql", "validate", "correct", "execute", "answer"
        ],
        stages: [{ stage: "answer", status: "success" }],
        semanticPlan: {
          route: "answer",
          standaloneQuestion: "统计订单数",
          selectedTables: ["orders"],
          selectedColumns: ["orders.id"],
          confidence: 1,
          evidenceRefs: [],
          queryContract
        },
        accuracy
      }
    },
    llmRaw: null,
    createdAt: "2026-07-17T00:00:00.000Z"
  });

  it("projects identical safe evidence across sync trace, delivery/finish, and replay", () => {
    const evidence = buildEvidence();
    const run = buildRun(evidence);
    const syncSummary = buildText2SqlAccuracyDeliverySummary({ evidence });
    const delivery = new DeliveryContractMapper(new SandboxRuntimeService()).map({ run });
    const replaySummary = buildText2SqlAccuracyDeliverySummary({
      evidence: run.trace.v2?.accuracy,
      currentVersions: versions
    });
    const replayTrace = withoutRawAccuracyEvidence(run.trace);

    expect(syncSummary).toMatchObject({
      finalStatus: "passed",
      sqlDigest: "sql-digest-1",
      repairCount: 0,
      evidenceValid: true,
      stale: false,
      finalReceiptRef: evidence.validationReceipt?.receiptId,
      gateStatuses: {
        intent: "passed",
        semantic: "passed",
        structural: "passed",
        policy: "passed",
        resource: "passed",
        sandbox: "passed",
        result: "passed"
      }
    });
    expect(delivery.evidence?.v2?.accuracy).toEqual(syncSummary);
    expect(replaySummary).toEqual(syncSummary);
    expect(replayTrace.v2?.accuracy).toBeUndefined();
    expect(JSON.stringify(delivery.evidence?.v2)).not.toContain("workspace-secret-filter");
  });

  it("marks digest tampering invalid and version drift stale on every safe projection", () => {
    const evidence = buildEvidence();
    evidence.gateReceipts![0] = {
      ...evidence.gateReceipts![0],
      reasonCodes: ["tampered"]
    };
    const currentVersions = { ...versions, semantic: "semantic-v2" };
    const summary = buildText2SqlAccuracyDeliverySummary({
      evidence,
      currentVersions
    });

    expect(summary).toMatchObject({
      evidenceValid: false,
      stale: true,
      staleReasonCodes: ["accuracy_version_tuple_stale"]
    });
    expect(summary?.reasonCodes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("accuracy_receipt_digest_invalid")
      ])
    );
  });
});
