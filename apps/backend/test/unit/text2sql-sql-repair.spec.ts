import type {
  DatasourceType,
  Text2SqlEvalVersionTupleV1,
  Text2SqlQueryContractV1
} from "@text2sql/shared-types";
import { SqlRepairService } from "../../src/modules/conversation/adapters/sql-repair.service";
import { SqlCorrectionService } from "../../src/modules/conversation/adapters/sql-correction.service";
import { CorrectSqlNode } from "../../src/modules/conversation/nodes/correct-sql.node";
import { SqlDialectAnalyzerService } from "../../src/modules/platform/data/sql-analysis/sql-dialect-analyzer.service";
import type { DatasourceSchemaSnapshotV1 } from "../../src/modules/platform/data/schema/schema-snapshot.types";

describe("SqlRepairService", () => {
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

  const snapshot = (datasourceType: DatasourceType): DatasourceSchemaSnapshotV1 => ({
    version: "datasource-schema-snapshot.v1",
    snapshotId: "snapshot-v1",
    digest: "schema-v1",
    datasourceId: "datasource-1",
    datasourceType,
    workspaceId: "workspace-1",
    workspaceDatasourceBindingId: "binding-1",
    policyVersion: 1,
    policyDigest: "policy-v1",
    tables: [
      {
        name: "orders",
        columns: [
          { name: "id", dataType: "integer", nullable: false, primaryKey: true, ordinal: 0 },
          { name: "customer_id", dataType: "integer", nullable: false, primaryKey: false, ordinal: 1 },
          { name: "created_at", dataType: "timestamp", nullable: false, primaryKey: false, ordinal: 2 }
        ]
      },
      {
        name: "customers",
        columns: [
          { name: "id", dataType: "integer", nullable: false, primaryKey: true, ordinal: 0 }
        ]
      }
    ],
    relationships: [
      {
        fromTable: "orders",
        fromColumn: "customer_id",
        toTable: "customers",
        toColumn: "id"
      }
    ],
    allowedSchemaSet: {
      version: "allowed-schema-set.v1",
      datasourceId: "datasource-1",
      policyVersion: 1,
      schemaSnapshotDigest: "schema-v1",
      tables: ["orders", "customers"],
      columnsByTable: {
        orders: ["id", "customer_id", "created_at"],
        customers: ["id"]
      },
      digest: "allowed-schema-v1"
    },
    capturedAt: "2026-07-17T00:00:00.000Z"
  });

  const queryContract = (
    requiredColumns: string[],
    resultColumn = "id"
  ): Text2SqlQueryContractV1 => ({
    version: "query-contract.v1",
    id: "query-contract-1",
    digest: "query-contract-digest-1",
    runId: "run-1",
    questionDigest: "question-digest-1",
    route: "text_to_sql",
    metrics: [],
    dimensions: requiredColumns,
    requiredColumns,
    filters: [],
    grain: requiredColumns,
    sort: [],
    resultShape: {
      cardinality: "tabular",
      columns: [{ name: resultColumn, semanticType: "dimension" }]
    },
    frozenAt: "2026-07-17T00:00:00.000Z"
  });

  it("qualifies an ambiguous identifier only when the frozen QueryContract selects one table", () => {
    const service = new SqlRepairService();
    const result = service.repair({
      failedSql:
        "SELECT id FROM orders JOIN customers ON customers.id = orders.customer_id",
      failureCode: "SQL_CATALOG_REFERENCE_AMBIGUOUS",
      runId: "run-1",
      queryContract: queryContract(["orders.id"]),
      versions,
      datasourceType: "sqlite",
      schemaSnapshot: snapshot("sqlite"),
      attempt: 1
    });

    expect(result).toMatchObject({
      status: "applied",
      receipt: {
        patchKind: "identifier_qualification",
        equivalenceStatus: "proven",
        attempt: 1,
        changedSemanticDimensions: ["identifier_qualification"]
      }
    });
    expect(result.patchedSql).toMatch(/orders["`.]?\.?["`]?id/i);
    expect(result.receipt.parentSqlDigest).not.toBe(result.receipt.patchedSqlDigest);
  });

  it.each([
    ["postgresql", "strftime('%Y', created_at)", "to_char"],
    ["mysql", "strftime('%Y', created_at)", "date_format"],
    ["sqlite", "date_trunc('month', created_at)", "strftime"]
  ] as const)(
    "applies the allowlisted %s dialect equivalent and preserves the AST contract",
    (datasourceType, expression, expectedFunction) => {
      const service = new SqlRepairService();
      const result = service.repair({
        failedSql: `SELECT ${expression} AS month_key FROM orders`,
        failureCode: "SQL_DIALECT_MISMATCH",
        runId: "run-1",
        queryContract: queryContract(["orders.created_at"], "month_key"),
        versions,
        datasourceType,
        schemaSnapshot: snapshot(datasourceType),
        attempt: 1
      });

      expect(result.status).toBe("applied");
      expect(result.patchedSql?.toLowerCase()).toContain(expectedFunction);
      expect(result.receipt).toMatchObject({
        patchKind: "dialect_equivalent",
        equivalenceStatus: "proven",
        changedSemanticDimensions: ["dialect_equivalent"]
      });
    }
  );

  it("fails closed when an AST diff changes aggregation despite an allowlisted patch", () => {
    const realAnalyzer = new SqlDialectAnalyzerService();
    const analyzer = {
      analyze: jest.fn((input: { sql: string; datasourceType: DatasourceType }) => {
        const analyzed = realAnalyzer.analyze(input);
        if (input.sql.includes('"orders"."id"')) {
          return {
            ...analyzed,
            ast: {
              ...(analyzed.ast as Record<string, unknown>),
              columns: [
                {
                  expr: {
                    type: "aggr_func",
                    name: "AVG",
                    args: { expr: { type: "column_ref", table: "orders", column: "id" } }
                  },
                  as: "id"
                }
              ]
            }
          };
        }
        return analyzed;
      })
    };
    const service = new SqlRepairService(analyzer as never);
    const result = service.repair({
      failedSql: "SELECT id FROM orders",
      failureCode: "SQL_CATALOG_REFERENCE_AMBIGUOUS",
      runId: "run-1",
      queryContract: queryContract(["orders.id"]),
      versions,
      datasourceType: "sqlite",
      schemaSnapshot: snapshot("sqlite"),
      attempt: 1
    });

    expect(result.status).toBe("rejected");
    expect(result.failureCode).toContain("repair_semantic_drift");
    expect(result.receipt.equivalenceStatus).toBe("rejected");
  });

  it("detects no-progress cycles from prior SQL and failure signatures", () => {
    const service = new SqlRepairService();
    const failedSql = "SELECT id FROM orders";
    const digest = new SqlDialectAnalyzerService().analyze({
      sql: failedSql,
      datasourceType: "sqlite"
    }).normalizedSqlDigest;
    const result = service.repair({
      failedSql,
      failureCode: "SQL_CATALOG_REFERENCE_AMBIGUOUS",
      runId: "run-1",
      queryContract: queryContract(["orders.id"]),
      versions,
      datasourceType: "sqlite",
      schemaSnapshot: snapshot("sqlite"),
      attempt: 2,
      seenSqlDigests: [digest]
    });

    expect(result).toMatchObject({
      status: "rejected",
      failureCode: "repair_cycle_detected",
      receipt: { equivalenceStatus: "rejected", attempt: 2 }
    });
  });

  it("allows two distinct mechanical patch attempts and never invokes a third", () => {
    const repair = jest.fn((input: { attempt: 1 | 2 }) => ({
      status: "applied",
      patchedSql: `SELECT orders.id FROM orders /* patch-${input.attempt} */`,
      failureSignature: `failure-${input.attempt}`,
      receipt: {
        version: "repair-receipt.v1",
        receiptId: `repair:${input.attempt}`,
        receiptDigest: `repair-digest-${input.attempt}`,
        runId: "run-1",
        queryContractDigest: "query-contract-digest-1",
        versions,
        parentSqlDigest: `parent-${input.attempt}`,
        patchedSqlDigest: `patched-${input.attempt}`,
        patchId: `qualify:${input.attempt}`,
        patchKind: "identifier_qualification",
        equivalenceStatus: "proven",
        attempt: input.attempt,
        changedSemanticDimensions: ["identifier_qualification"],
        reasonCodes: ["repair_ast_equivalence_proven"],
        issuedAt: "2026-07-17T00:00:00.000Z"
      }
    }));
    const node = new CorrectSqlNode(
      new SqlCorrectionService(),
      { repair } as never
    );
    const base = {
      failedSql: "SELECT id FROM orders",
      validationArtifact: {
        status: "failed" as const,
        checks: [],
        correctable: true,
        failure: {
          code: "SQL_CATALOG_REFERENCE_AMBIGUOUS",
          message: "ambiguous id",
          category: "validation" as const,
          terminal: false,
          correctable: true
        }
      },
      semanticPlan: {
        route: "answer" as const,
        standaloneQuestion: "orders",
        selectedTables: ["orders"],
        selectedColumns: ["orders.id"],
        confidence: 1,
        evidenceRefs: [],
        queryContract: queryContract(["orders.id"])
      },
      runId: "run-1",
      versions,
      datasourceType: "sqlite" as const,
      schemaSnapshot: snapshot("sqlite")
    };

    expect(node.run({ ...base, attemptCount: 0 }).outcome).toBe("retry_validation");
    expect(node.run({ ...base, attemptCount: 1 }).outcome).toBe("retry_validation");
    expect(node.run({ ...base, attemptCount: 2 })).toMatchObject({
      outcome: "terminal",
      failure: { code: "SQL_CORRECTION_BUDGET_EXHAUSTED" }
    });
    expect(repair).toHaveBeenCalledTimes(2);
    expect(repair.mock.calls.map(([input]) => input.attempt)).toEqual([1, 2]);
  });
});
