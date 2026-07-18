import type {
  Text2SqlAccuracyGateReceiptV1,
  Text2SqlEvalVersionTupleV1,
  Text2SqlQueryContractV1
} from "@text2sql/shared-types";
import { ResultValidationService } from "../../src/modules/conversation/adapters/result-validation.service";
import { createText2SqlAccuracyGateReceipt } from "../../src/modules/conversation/contracts/text2sql-v2.types";
import { FormatAnswerNode } from "../../src/modules/conversation/agent/nodes/format-answer.node";
import { AnswerNode } from "../../src/modules/conversation/nodes/answer.node";
import { BoundedQueryExecutionService } from "../../src/modules/platform/data/query/bounded-query-execution.service";
import { SqlDialectAnalyzerService } from "../../src/modules/platform/data/sql-analysis/sql-dialect-analyzer.service";

describe("text2sql deterministic result oracle flow", () => {
  const runId = "run-oracle-1";
  const sql = "SELECT COUNT(*) AS total FROM orders";
  const queryContract: Text2SqlQueryContractV1 = {
    version: "query-contract.v1",
    id: "query-contract-count-orders",
    digest: "query-contract-count-orders-digest",
    runId,
    questionDigest: "question-digest",
    route: "text_to_sql",
    metrics: ["count"],
    dimensions: [],
    requiredColumns: [],
    filters: [],
    grain: [],
    sort: [],
    resultShape: {
      cardinality: "scalar",
      columns: [{ name: "count", semanticType: "metric", nullable: false }]
    },
    frozenAt: "2026-07-17T00:00:00.000Z"
  };
  const versions: Text2SqlEvalVersionTupleV1 = {
    questionSet: "q-v1",
    semantic: "sem-v1",
    schema: "schema-v1",
    policy: "policy-v1",
    data: "data-v1",
    model: "model-v1",
    prompt: "prompt-v1",
    workflow: "workflow-v1",
    code: "code-v1"
  };
  const analyzer = new SqlDialectAnalyzerService();
  const sqlDigest = analyzer.analyze({ sql, datasourceType: "sqlite" }).normalizedSqlDigest;

  const preExecutionGates = (): Text2SqlAccuracyGateReceiptV1[] => {
    const receipts: Text2SqlAccuracyGateReceiptV1[] = [];
    for (const gate of ["intent", "semantic", "structural", "policy"] as const) {
      receipts.push(
        createText2SqlAccuracyGateReceipt({
          runId,
          queryContractDigest: queryContract.digest,
          sqlDigest,
          versions,
          gate,
          status: "passed",
          capability: "available",
          parentReceiptDigests: receipts.map((receipt) => receipt.receiptDigest),
          issuedAt: "2026-07-17T00:00:00.000Z"
        })
      );
    }
    return receipts;
  };

  const execute = async (columns: string[], rows: Array<Record<string, unknown>>) => {
    const gates = preExecutionGates();
    const bounded = await new BoundedQueryExecutionService().execute({
      runId,
      datasourceId: "sqlite_main",
      datasourceType: "sqlite",
      sql,
      queryContractDigest: queryContract.digest,
      versions,
      gateReceipts: gates,
      execute: jest.fn().mockResolvedValue({ columns, rows })
    });
    return { gates, bounded };
  };

  it("seals final validation only when every mandatory deterministic oracle passes", async () => {
    const { gates, bounded } = await execute(["total"], [{ total: 8 }]);
    const result = new ResultValidationService().validate({
      queryContract,
      columns: bounded.columns,
      rows: bounded.rows,
      gateReceipts: [
        ...gates,
        bounded.resourceGateReceipt,
        bounded.sandboxGateReceipt
      ],
      executionPermit: bounded.executionPermit,
      executionReceipt: bounded.executionReceipt,
      issuedAt: "2026-07-17T00:00:01.000Z"
    });

    expect(result.status).toBe("passed");
    expect(result.resultReceipt.oracleVerdicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ oracleId: "schema-shape.v1", passed: true }),
        expect.objectContaining({ oracleId: "cardinality.v1", passed: true })
      ])
    );
    expect(result.validationReceipt).toMatchObject({
      status: "passed",
      executionReceiptDigest: bounded.executionReceipt.receiptDigest,
      resultReceiptDigest: result.resultReceipt.receiptDigest
    });
  });

  it("detects silent result-shape errors even when SQL execution succeeded", async () => {
    const { gates, bounded } = await execute(["customer_name"], [
      { customer_name: "example" }
    ]);
    const result = new ResultValidationService().validate({
      queryContract,
      columns: bounded.columns,
      rows: bounded.rows,
      gateReceipts: [
        ...gates,
        bounded.resourceGateReceipt,
        bounded.sandboxGateReceipt
      ],
      executionPermit: bounded.executionPermit,
      executionReceipt: bounded.executionReceipt
    });

    expect(result.status).toBe("failed");
    expect(result.reasonCodes).toContain("result_schema_mismatch");
    expect(result.validationReceipt).toBeUndefined();
  });

  it("does not let AnswerNode treat rows or ExecutionReceipt alone as final proof", async () => {
    const { bounded } = await execute(["total"], [{ total: 8 }]);
    const answer = new AnswerNode(new FormatAnswerNode()).run({
      question: "订单数是多少",
      semanticPlan: {
        route: "answer",
        standaloneQuestion: "订单数是多少",
        selectedTables: ["orders"],
        selectedColumns: [],
        confidence: 1,
        evidenceRefs: [],
        filters: ["route_kind:text_to_sql"],
        queryContract
      },
      executionResult: {
        rows: bounded.rows,
        columns: bounded.columns,
        rowCount: bounded.rowCount,
        byteCount: bounded.byteCount,
        emptyResult: false,
        executionPermit: bounded.executionPermit,
        executionReceipt: bounded.executionReceipt
      }
    });

    expect(answer).toMatchObject({
      mode: "fail_closed",
      status: "rejected",
      failure: { code: "FINAL_VALIDATION_RECEIPT_REQUIRED" }
    });
  });
});
