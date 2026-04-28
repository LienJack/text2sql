import { SqlValidationService } from "../../src/modules/conversation/adapters/sql-validation.service";

describe("text2sql v2 sql validation", () => {
  const createService = (overrides?: {
    dryRun?: boolean;
    dryPlan?: boolean;
    dryRunComplete?: boolean;
    dryRunReason?: string;
    dryPlanPass?: boolean;
    dryPlanReason?: string;
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

  it("returns correctable validation failure for parse errors", async () => {
    const result = await service.validate({
      sql: "show tables"
    });

    expect(result.status).toBe("failed");
    expect(result.correctable).toBe(true);
    expect(service.resolveOutcome(result)).toBe("correctable");
    expect(result.failure?.category).toBe("validation");
    expect(result.failure?.terminal).toBe(false);
    expect(result.failure?.code).toBe("SQL_PARSE_UNSUPPORTED_STATEMENT");
  });

  it("fails multi-statement parse without attempting dry-run", async () => {
    const result = await service.validate({
      sql: "SELECT * FROM orders; SELECT * FROM invoices"
    });

    expect(result.failure?.code).toBe("SQL_PARSE_MULTI_STATEMENT");
    expect(result.correctable).toBe(true);
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

  it("fails plan coverage correctably when SQL references a table outside selected tables", async () => {
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
    expect(result.failure?.terminal).toBe(false);
    expect(result.correctable).toBe(true);
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
    expect(result.correctable).toBe(true);
  });

  it("reports failed ledger obligation ids as correctable fulfillment misses", async () => {
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
    expect(result.correctable).toBe(true);
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

  it.each([
    ["sqlite", "SELECT show tables FROM orders", "SQLite 不支持 SHOW TABLES 语法"],
    ["mysql", "SELECT * FROM pragma", "MySQL 不支持 PRAGMA 语法"],
    ["postgresql", "SELECT strftime('%Y', created_at) FROM orders", "PostgreSQL 不支持 strftime 函数"]
  ] as const)("fails %s dialect mismatches correctably", async (datasourceType, sql, message) => {
    const result = await service.validate({
      sql,
      datasourceType,
      semanticPlan: plan({
        selectedTables: datasourceType === "mysql" ? ["pragma"] : ["orders"],
        selectedColumns: [],
        allowedTables: ["orders", "pragma"]
      })
    });

    expect(result.status).toBe("failed");
    expect(result.failure?.code).toBe("SQL_DIALECT_MISMATCH");
    expect(result.failure?.message).toBe(message);
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

  it("fails dry-run parse rejection correctably", async () => {
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
    expect(result.failure?.terminal).toBe(false);
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

  it("fails dry-plan relationship mismatch correctably", async () => {
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
    expect(result.failure?.terminal).toBe(false);
  });
});
