import { SqlValidationService } from "../../src/modules/conversation/agent/v2/sql-validation.service";

describe("text2sql v2 sql validation", () => {
  const service = new SqlValidationService();

  it("returns terminal governance failure for read-only violations", () => {
    const result = service.validate({
      sql: "DELETE FROM orders WHERE id = 1"
    });

    expect(result.status).toBe("failed");
    expect(result.correctable).toBe(false);
    expect(result.failure?.category).toBe("governance");
    expect(result.failure?.terminal).toBe(true);
    expect(result.failure?.code).toBe("SQL_READ_ONLY_VIOLATION");
  });

  it("returns correctable validation failure for parse errors", () => {
    const result = service.validate({
      sql: "show tables"
    });

    expect(result.status).toBe("failed");
    expect(result.correctable).toBe(true);
    expect(result.failure?.category).toBe("validation");
    expect(result.failure?.terminal).toBe(false);
    expect(result.failure?.code).toBe("SQL_PARSE_UNSUPPORTED_STATEMENT");
  });

  it("fails permission and plan-coverage when SQL goes beyond semantic plan", () => {
    const result = service.validate({
      sql: "SELECT amount FROM invoices",
      semanticPlan: {
        route: "answer",
        standaloneQuestion: "查询金额",
        selectedTables: ["orders"],
        selectedColumns: ["orders.amount"],
        allowedTables: ["orders"],
        confidence: 0.88,
        evidenceRefs: ["chunk-orders-1"]
      }
    });

    expect(result.status).toBe("failed");
    expect(result.failure?.code).toBe("SQL_TABLE_PERMISSION_DENIED");
    expect(result.failure?.terminal).toBe(true);
    expect(result.checks.find((check) => check.check === "plan-coverage")?.status).toBe(
      "failed"
    );
  });
});
