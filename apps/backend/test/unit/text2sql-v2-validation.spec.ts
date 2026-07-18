import { SqlValidationService } from "../../src/modules/conversation/adapters/sql-validation.service";
import { DomainError } from "../../src/common/domain-error";
import type { DatasourceSchemaSnapshotV1 } from "../../src/modules/platform/data/schema/schema-snapshot.types";

describe("text2sql v2 sql validation", () => {
  const createService = (overrides?: {
    dryRun?: boolean;
    dryPlan?: boolean;
    dryRunComplete?: boolean;
    dryRunReason?: string;
    dryPlanPass?: boolean;
    dryPlanReason?: string;
    sqliteDryRunError?: DomainError;
  }) =>
    new SqlValidationService(
      {
        getValidationCapabilities: jest.fn(() => ({
          dryRun: overrides?.dryRun ?? true,
          dryPlan: overrides?.dryPlan ?? true,
          reason: "capability disabled by test"
        })),
        buildDryPlan: jest.fn(() => ({
          complete: overrides?.dryRunComplete ?? true,
          referencedTables: ["orders"],
          reason: overrides?.dryRunReason
        }))
      } as never,
      {
        evaluateJoinPathConsistency: jest.fn(() => ({
          pass: overrides?.dryPlanPass ?? true,
          missingTables: overrides?.dryPlanPass === false ? ["customers"] : [],
          reason: overrides?.dryPlanReason
        }))
      } as never,
      {
        getDatasourceById: jest.fn().mockResolvedValue({
          id: "sqlite_main",
          type: "sqlite"
        })
      } as never,
      {
        dbPath: "/tmp/text2sql.db",
        dryRun: overrides?.sqliteDryRunError
          ? jest.fn().mockRejectedValue(overrides.sqliteDryRunError)
          : jest.fn().mockResolvedValue(undefined)
      } as never
    );

  const service = createService();

  const plan = (overrides: Record<string, unknown> = {}) =>
    ({
      route: "answer",
      standaloneQuestion: "统计订单",
      selectedTables: ["orders"],
      selectedColumns: ["orders.id", "orders.amount", "orders.customer_id"],
      allowedTables: ["orders"],
      confidence: 0.88,
      evidenceRefs: ["chunk-orders-1"],
      filters: ["route_kind:text_to_sql"],
      ...overrides
    }) as never;

  const schemaSnapshot: DatasourceSchemaSnapshotV1 = {
    version: "datasource-schema-snapshot.v1",
    snapshotId: "snapshot-orders-v1",
    digest: "schema-orders-v1",
    datasourceId: "sqlite_main",
    datasourceType: "sqlite",
    workspaceId: "ws-1",
    workspaceDatasourceBindingId: "binding-1",
    policyVersion: 1,
    policyDigest: "policy-1",
    tables: [
      {
        name: "orders",
        columns: [
          { name: "id", dataType: "integer", nullable: false, primaryKey: true, ordinal: 0 },
          { name: "amount", dataType: "numeric", nullable: false, primaryKey: false, ordinal: 1 },
          { name: "customer_id", dataType: "integer", nullable: false, primaryKey: false, ordinal: 2 }
        ]
      }
    ],
    relationships: [],
    allowedSchemaSet: {
      version: "allowed-schema-set.v1",
      datasourceId: "sqlite_main",
      policyVersion: 1,
      schemaSnapshotDigest: "schema-orders-v1",
      tables: ["orders"],
      columnsByTable: {
        orders: ["id", "amount", "customer_id"]
      },
      digest: "allowed-orders-v1"
    },
    capturedAt: "2026-07-17T00:00:00.000Z"
  };

  it("returns terminal governance failure for read-only violations", async () => {
    const result = await service.validate({
      sql: "DELETE FROM orders WHERE id = 1"
    });

    expect(result.status).toBe("failed");
    expect(result.correctable).toBe(false);
    expect(service.resolveOutcome(result)).toBe("terminal");
    expect(result.failure?.category).toBe("governance");
    expect(result.failure?.terminal).toBe(true);
    expect(result.failure?.code).toBe("SQL_READ_ONLY_VIOLATION");
  });

  it("passes only after AST and frozen authorized Catalog both resolve", async () => {
    const result = await service.validate({
      sql: "SELECT SUM(amount) AS total FROM orders",
      datasourceId: "sqlite_main",
      datasourceType: "sqlite",
      semanticPlan: plan({ selectedColumns: ["orders.amount"] }),
      schemaSnapshot,
      requiresCatalog: true
    });

    expect(result.status).toBe("passed");
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ check: "structural", status: "passed" }),
        expect.objectContaining({ check: "catalog", status: "passed" })
      ])
    );
    expect(result.sqlAnalysis).toMatchObject({
      status: "ready",
      tables: ["orders"],
      columns: ["orders.amount"]
    });
    expect(result.catalogResolution).toMatchObject({
      status: "resolved",
      schemaSnapshotId: "snapshot-orders-v1",
      allowedSchemaDigest: "allowed-orders-v1"
    });
  });

  it("fails closed without leaking hidden CTE columns when frozen Catalog denies them", async () => {
    const result = await service.validate({
      sql: "WITH hidden AS (SELECT secret_value FROM secrets) SELECT secret_value FROM hidden",
      datasourceId: "sqlite_main",
      datasourceType: "sqlite",
      semanticPlan: plan({ selectedColumns: ["orders.id"] }),
      schemaSnapshot,
      requiresCatalog: true
    });

    expect(result.status).toBe("failed");
    expect(result.failure?.terminal).toBe(true);
    expect(result.checks.find((check) => check.check === "catalog")).toMatchObject({
      status: "failed"
    });
    expect(JSON.stringify(result)).not.toContain("secret_value");
    expect(JSON.stringify(result)).not.toContain("secrets");
  });

  it("fails closed when trusted Catalog evidence is required but missing", async () => {
    const result = await service.validate({
      sql: "SELECT amount FROM orders",
      datasourceType: "sqlite",
      semanticPlan: plan({ selectedColumns: ["orders.amount"] }),
      requiresCatalog: true
    });

    expect(result.status).toBe("failed");
    expect(result.failure?.code).toBe("SQL_CATALOG_SNAPSHOT_UNAVAILABLE");
    expect(result.correctable).toBe(false);
  });

  it("fails closed for parse errors that have no mechanical AST patch", async () => {
    const result = await service.validate({
      sql: "show tables"
    });

    expect(result.status).toBe("failed");
    expect(result.correctable).toBe(false);
    expect(service.resolveOutcome(result)).toBe("terminal");
    expect(result.failure?.category).toBe("validation");
    expect(result.failure?.terminal).toBe(true);
    expect(result.failure?.code).toBe("SQL_PARSE_UNSUPPORTED_STATEMENT");
  });

  it("fails multi-statement parse without attempting dry-run", async () => {
    const result = await service.validate({
      sql: "SELECT * FROM orders; SELECT * FROM invoices"
    });

    expect(result.failure?.code).toBe("SQL_PARSE_MULTI_STATEMENT");
    expect(result.correctable).toBe(false);
    expect(result.checks.find((check) => check.check === "dry-run")).toMatchObject({
      status: "skipped",
      message: "dry-run skipped because parse/read-only check already failed"
    });
  });

  it("fails permission and plan-coverage when SQL goes beyond semantic plan", async () => {
    const result = await service.validate({
      sql: "SELECT amount FROM invoices",
      semanticPlan: plan({ selectedColumns: ["orders.amount"] })
    });

    expect(result.status).toBe("failed");
    expect(result.failure?.code).toBe("SQL_TABLE_PERMISSION_DENIED");
    expect(result.failure?.terminal).toBe(true);
    expect(result.checks.find((check) => check.check === "plan-coverage")?.status).toBe(
      "failed"
    );
  });

  it("fails terminally when selected columns do not allow referenced columns", async () => {
    const result = await service.validate({
      sql: "SELECT orders.secret_amount FROM orders",
      semanticPlan: plan({ selectedColumns: ["orders.id"] })
    });

    expect(result.status).toBe("failed");
    expect(result.failure?.code).toBe("SQL_COLUMN_PERMISSION_DENIED");
    expect(result.failure?.category).toBe("governance");
    expect(result.failure?.terminal).toBe(true);
    expect(result.correctable).toBe(false);
  });

  it("fails plan coverage terminally instead of allowing semantic replanning", async () => {
    const result = await createService().validate({
      sql: "SELECT COUNT(*) FROM invoices",
      semanticPlan: plan({
        allowedTables: ["orders", "invoices"],
        selectedTables: ["orders"],
        selectedColumns: []
      })
    });

    expect(result.status).toBe("failed");
    expect(result.failure?.code).toBe("SQL_PLAN_COVERAGE_OUTSIDE_SELECTED_TABLES");
    expect(result.failure?.terminal).toBe(true);
    expect(result.correctable).toBe(false);
  });

  it("fails terminally when semantic plan requires clarification", async () => {
    const result = await service.validate({
      sql: "SELECT COUNT(*) FROM orders",
      semanticPlan: plan({
        route: "clarify",
        confidence: 0.32,
        filters: ["route_kind:clarify"]
      })
    });

    expect(result.status).toBe("failed");
    expect(result.correctable).toBe(false);
    expect(result.failure?.code).toBe("SQL_PLAN_REQUIRES_CLARIFICATION");
    expect(result.failure?.terminal).toBe(true);
  });

  it("allows metadata and general route SQL prechecks without requiring selected tables", async () => {
    const result = await service.validate({
      sql: "SELECT 1",
      semanticPlan: plan({
        selectedTables: [],
        selectedColumns: [],
        filters: ["route_kind:metadata"]
      }),
      datasourceType: "sqlite"
    });

    expect(result.status).toBe("passed");
    expect(service.resolveOutcome(result)).toBe("pass");
    expect(result.checks.find((check) => check.check === "plan-coverage")).toMatchObject({
      status: "passed",
      message: "non text-to-sql route"
    });
    expect(result.checks.find((check) => check.check === "dry-plan")).toMatchObject({
      status: "skipped",
      message: "dry-plan skipped: non text-to-sql route"
    });
  });

  it("fails relationship path when multiple selected tables are not joined", async () => {
    const result = await service.validate({
      sql: "SELECT COUNT(*) FROM orders",
      semanticPlan: plan({
        selectedTables: ["orders", "customers"],
        selectedColumns: [],
        allowedTables: ["orders", "customers"],
        joinPath: ["orders.customer_id=customers.id"]
      })
    });

    expect(result.status).toBe("failed");
    expect(result.failure?.code).toBe("SQL_RELATIONSHIP_PATH_MISSING_JOIN");
    expect(result.correctable).toBe(false);
  });

  it("reports failed ledger obligation ids without allowing semantic repair", async () => {
    const result = await service.validate({
      sql: "SELECT COUNT(*) FROM orders",
      semanticPlan: plan({
        selectedTables: ["orders", "customers"],
        selectedColumns: [],
        allowedTables: ["orders", "customers"],
        joinPath: ["orders.customer_id=customers.id"],
        snapshotId: "semantic-plan-v1",
        planLedger: {
          version: "plan-ledger.v1",
          snapshotId: "semantic-plan-v1",
          obligations: [
            {
              id: "ledger:join-path:orders-customers",
              kind: "join_path",
              summary: "orders join customers",
              criticality: "hard_blocker",
              status: "grounded",
              evidenceRefs: ["relationship-orders-customers"],
              reasonCodes: ["join_path_grounded"],
              subject: "orders->customers"
            }
          ],
          summary: {
            snapshotId: "semantic-plan-v1",
            total: 1,
            hardBlockerCount: 1,
            warningCount: 0,
            failedHardBlockerIds: []
          }
        }
      })
    });

    expect(result.status).toBe("failed");
    expect(result.correctable).toBe(false);
    expect(result.failedObligationIds).toEqual(["ledger:join-path:orders-customers"]);
    expect(result.checks.find((check) => check.check === "ledger-fulfillment")).toMatchObject({
      status: "failed",
      code: "SQL_LEDGER_FULFILLMENT_FAILED",
      failedObligationIds: ["ledger:join-path:orders-customers"],
      reasonCodes: ["ledger_join_path_not_used"]
    });
    expect(result.ledgerFulfillment?.failedHardBlockerIds).toEqual([
      "ledger:join-path:orders-customers"
    ]);
  });

  it("passes grouped count proportion SQL when only the required schema column is used", async () => {
    const result = await service.validate({
      sql: [
        "SELECT method AS group_value,",
        "  COUNT(*) AS item_count,",
        "  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) AS item_percentage",
        "FROM payments",
        "GROUP BY method",
        "ORDER BY item_count DESC;"
      ].join("\n"),
      semanticPlan: plan({
        standaloneQuestion: "有多少种支付方式，他们比例是如何",
        selectedTables: ["payments"],
        selectedColumns: [
          "payments.id",
          "payments.payment_no",
          "payments.order_id",
          "payments.method",
          "payments.status",
          "payments.amount",
          "payments.created_at",
          "payments.paid_at"
        ],
        allowedTables: ["payments"],
        metrics: ["count"],
        snapshotId: "semantic-plan-payments",
        planLedger: {
          version: "plan-ledger.v1",
          snapshotId: "semantic-plan-payments",
          obligations: [
            {
              id: "ledger:table:payments",
              kind: "table",
              summary: "payments table",
              criticality: "hard_blocker",
              status: "grounded",
              evidenceRefs: ["schema-supplement:payments"],
              reasonCodes: ["selected_table_grounded"],
              subject: "payments"
            },
            {
              id: "ledger:column:payments.method",
              kind: "column",
              summary: "payments method",
              criticality: "hard_blocker",
              status: "grounded",
              evidenceRefs: ["schema-supplement:payments"],
              reasonCodes: ["selected_column_grounded"],
              subject: "payments.method"
            },
            {
              id: "ledger:metric:count",
              kind: "metric",
              summary: "count metric",
              criticality: "hard_blocker",
              status: "grounded",
              evidenceRefs: ["schema-supplement:payments"],
              reasonCodes: ["metric_grounded"],
              subject: "count"
            }
          ],
          summary: {
            snapshotId: "semantic-plan-payments",
            total: 3,
            hardBlockerCount: 3,
            warningCount: 0,
            failedHardBlockerIds: []
          }
        }
      }),
      sqlArtifact: {
        sql: "SELECT method AS group_value, COUNT(*) AS item_count FROM payments GROUP BY method",
        usedTables: ["payments"],
        usedColumns: ["method"],
        cause: "initial",
        dialect: "sqlite",
        claimedObligationIds: [
          "ledger:table:payments",
          "ledger:column:payments.method",
          "ledger:metric:count"
        ]
      } as never
    });

    expect(result.status).toBe("passed");
    expect(result.checks.find((check) => check.check === "ledger-fulfillment")).toMatchObject({
      status: "passed",
      reasonCodes: ["ledger_fulfilled"]
    });
  });

  it.each([
    ["sqlite", "SELECT date_trunc('month', created_at) FROM orders"],
    ["mysql", "SELECT strftime('%Y', created_at) FROM orders"],
    ["postgresql", "SELECT strftime('%Y', created_at) FROM orders"]
  ] as const)("fails %s dialect mismatches correctably", async (datasourceType, sql) => {
    const result = await service.validate({
      sql,
      datasourceType,
      semanticPlan: plan({
        selectedTables: ["orders"],
        selectedColumns: [],
        allowedTables: ["orders"]
      })
    });

    expect(result.status).toBe("failed");
    expect(result.failure?.code).toBe("SQL_DIALECT_MISMATCH");
    expect(result.failure?.message).toBe(
      "SQL could not be proven valid for the target datasource dialect."
    );
    expect(result.failure?.terminal).toBe(false);
  });

  it("records dry-run unsupported as explicit skipped warning", async () => {
    const result = await createService({ dryRun: false }).validate({
      sql: "SELECT COUNT(*) FROM orders",
      datasourceType: "csv",
      semanticPlan: plan()
    });

    expect(result.status).toBe("passed");
    expect(result.checks.find((check) => check.check === "dry-run")).toMatchObject({
      status: "skipped",
      code: "SQL_DRY_RUN_UNSUPPORTED",
      message: "capability disabled by test"
    });
  });

  it("fails dry-run parse rejection terminally", async () => {
    const result = await createService({
      dryRunComplete: false,
      dryRunReason: "unable to extract referenced tables"
    }).validate({
      sql: "SELECT COUNT(*) FROM orders",
      datasourceType: "sqlite",
      semanticPlan: plan()
    });

    expect(result.status).toBe("failed");
    expect(result.failure?.code).toBe("SQL_DRY_RUN_PARSE_REJECTED");
    expect(result.failure?.terminal).toBe(true);
  });

  it("fails sqlite dry-run missing columns as correctable validation errors", async () => {
    const result = await createService({
      sqliteDryRunError: new DomainError(
        "SQL_MISSING_COLUMN",
        "missing column order_date",
        400,
        {
          originalMessage: "Error: in prepare, no such column: order_date"
        }
      )
    }).validate({
      sql: "SELECT SUM(total_amount) FROM orders WHERE order_date >= DATE('now', '-30 days')",
      datasourceId: "sqlite_main",
      datasourceType: "sqlite",
      semanticPlan: plan({ selectedColumns: [] })
    });

    expect(result.status).toBe("failed");
    expect(result.correctable).toBe(true);
    expect(result.failure).toMatchObject({
      code: "SQL_MISSING_COLUMN",
      message: "missing column order_date",
      terminal: false,
      correctable: true
    });
    expect(result.checks.find((check) => check.check === "dry-run")).toMatchObject({
      status: "failed",
      code: "SQL_MISSING_COLUMN",
      message: "missing column order_date"
    });
  });

  it("records dry-plan unsupported as explicit skipped warning", async () => {
    const result = await createService({ dryPlan: false }).validate({
      sql: "SELECT COUNT(*) FROM orders",
      datasourceType: "sqlite",
      semanticPlan: plan()
    });

    expect(result.status).toBe("passed");
    expect(result.checks.find((check) => check.check === "dry-plan")).toMatchObject({
      status: "skipped",
      code: "SQL_DRY_PLAN_UNSUPPORTED",
      message: "capability disabled by test"
    });
  });

  it("fails dry-plan relationship mismatch terminally", async () => {
    const result = await createService({
      dryPlanPass: false,
      dryPlanReason: "missing tables from relationship plan: customers"
    }).validate({
      sql: "SELECT COUNT(*) FROM orders JOIN customers ON customers.id = orders.customer_id",
      datasourceType: "sqlite",
      semanticPlan: plan({
        selectedTables: ["orders", "customers"],
        selectedColumns: [],
        allowedTables: ["orders", "customers"],
        joinPath: ["orders.customer_id=customers.id"]
      })
    });

    expect(result.status).toBe("failed");
    expect(result.failure?.code).toBe("SQL_DRY_PLAN_RELATIONSHIP_MISMATCH");
    expect(result.failure?.terminal).toBe(true);
  });
});
