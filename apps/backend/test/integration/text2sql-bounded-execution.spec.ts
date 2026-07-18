import type {
  Text2SqlAccuracyGateReceiptV1,
  Text2SqlAccuracyGateKindV1,
  Text2SqlEvalVersionTupleV1
} from "@text2sql/shared-types";
import { DomainError } from "../../src/common/domain-error";
import {
  createText2SqlAccuracyGateReceipt
} from "../../src/modules/conversation/contracts/text2sql-v2.types";
import { BoundedQueryExecutionService } from "../../src/modules/platform/data/query/bounded-query-execution.service";
import { SqlDialectAnalyzerService } from "../../src/modules/platform/data/sql-analysis/sql-dialect-analyzer.service";

describe("text2sql bounded execution", () => {
  const service = new BoundedQueryExecutionService();
  const analyzer = new SqlDialectAnalyzerService();
  const versions: Text2SqlEvalVersionTupleV1 = {
    questionSet: "online-runtime.v1",
    semantic: "semantic-v1",
    schema: "schema-v1",
    policy: "policy-v1",
    data: "data-v1",
    model: "model-v1",
    prompt: "prompt-v1",
    workflow: "workflow-v1",
    code: "code-v1"
  };
  const sql = "SELECT amount FROM orders";
  const sqlDigest = analyzer.analyze({
    sql,
    datasourceType: "sqlite"
  }).normalizedSqlDigest;
  const gates = () => {
    const receipts: Text2SqlAccuracyGateReceiptV1[] = [];
    for (const gate of ["intent", "semantic", "structural", "policy"] as const satisfies readonly Text2SqlAccuracyGateKindV1[]) {
      receipts.push(
        createText2SqlAccuracyGateReceipt({
          runId: "run-bounded-1",
          queryContractDigest: "query-contract-digest-1",
          sqlDigest,
          versions,
          gate,
          status: "passed",
          capability: "available",
          reasonCodes: [`${gate}_passed`],
          evidenceRefs: [],
          parentReceiptDigests: receipts.map((receipt) => receipt.receiptDigest),
          issuedAt: "2026-07-17T00:00:00.000Z"
        })
      );
    }
    return receipts;
  };
  const baseInput = () => ({
    runId: "run-bounded-1",
    datasourceId: "sqlite_main",
    datasourceType: "sqlite" as const,
    sql,
    queryContractDigest: "query-contract-digest-1",
    versions,
    gateReceipts: gates(),
    accessContext: {
      actorId: "user-1",
      workspaceId: "ws-1",
      enforcementMode: "enforce" as const,
      allowedTables: ["orders"],
      policyVersion: 1,
      policyDigest: "policy-v1"
    }
  });

  it("binds resource, permit, sandbox and execution receipts to one SQL", async () => {
    const result = await service.execute({
      ...baseInput(),
      execute: jest.fn().mockResolvedValue({
        columns: ["amount"],
        rows: [{ amount: 10 }, { amount: 20 }]
      })
    });

    expect(result.rows).toHaveLength(2);
    expect(result.resourceGateReceipt).toMatchObject({
      gate: "resource",
      status: "passed",
      sqlDigest
    });
    expect(result.executionPermit.sqlDigest).toBe(sqlDigest);
    expect(result.sandboxGateReceipt).toMatchObject({
      gate: "sandbox",
      status: "passed"
    });
    expect(result.executionReceipt).toMatchObject({
      status: "passed",
      readOnlyEnforced: true,
      authorizationRechecked: true,
      rowCount: 2,
      cancelled: false
    });
  });

  it("discards all partial output when row or byte caps are exceeded", async () => {
    const promise = service.execute({
      ...baseInput(),
      limits: { maxRows: 1 },
      execute: jest.fn().mockResolvedValue({
        columns: ["amount"],
        rows: [{ amount: 10 }, { amount: 20 }]
      })
    });

    await expect(promise).rejects.toMatchObject({
      code: "SQL_BOUNDED_EXECUTION_FAILED",
      details: {
        reasonCode: "execution_row_cap_exceeded",
        executionReceipt: expect.objectContaining({
          status: "failed",
          rowCount: 0,
          byteCount: 0,
          reasonCodes: expect.arrayContaining(["partial_output_discarded"])
        })
      }
    } satisfies Partial<DomainError>);
  });

  it("cancels timed-out work and emits a terminal receipt", async () => {
    const promise = service.execute({
      ...baseInput(),
      limits: { timeoutMs: 5 },
      execute: jest.fn().mockReturnValue(new Promise(() => undefined))
    });

    await expect(promise).rejects.toMatchObject({
      code: "SQL_BOUNDED_EXECUTION_FAILED",
      details: {
        reasonCode: "execution_timeout",
        executionReceipt: expect.objectContaining({
          status: "failed",
          cancelled: true
        })
      }
    } satisfies Partial<DomainError>);
  });

  it("rejects a gate receipt bound to a different SQL digest", async () => {
    const mismatched = gates();
    mismatched[0] = createText2SqlAccuracyGateReceipt({
      runId: "run-bounded-1",
      queryContractDigest: "query-contract-digest-1",
      sqlDigest: "different-sql-digest",
      versions,
      gate: "intent",
      status: "passed",
      capability: "available",
      issuedAt: "2026-07-17T00:00:00.000Z"
    });

    await expect(
      service.execute({
        ...baseInput(),
        gateReceipts: mismatched,
        execute: jest.fn()
      })
    ).rejects.toThrow("accuracy_receipt_sql_mismatch");
  });
});
