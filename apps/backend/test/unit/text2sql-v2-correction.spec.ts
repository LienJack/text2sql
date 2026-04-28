import type { Text2SqlV2FailureSemantic } from "@text2sql/shared-types";
import { DomainError } from "../../src/common/domain-error";
import { SqlCorrectionService } from "../../src/modules/conversation/adapters/sql-correction.service";
import { CorrectSqlNode } from "../../src/modules/conversation/nodes/correct-sql.node";

describe("text2sql v2 sql correction decision", () => {
  const service = new SqlCorrectionService();

  function validationError(failure: Text2SqlV2FailureSemantic) {
    return new DomainError(
      "SQL_VALIDATION_FAILED",
      failure.message,
      422,
      {
        validationFailure: failure
      }
    );
  }

  function artifactError(failure: Text2SqlV2FailureSemantic) {
    return new DomainError(
      "SQL_VALIDATION_FAILED",
      failure.message,
      422,
      {
        validationArtifact: {
          status: "failed",
          correctable: Boolean(failure.correctable),
          checks: [
            {
              check: "parse",
              status: "failed",
              code: failure.code,
              message: failure.message
            }
          ],
          failure
        }
      }
    );
  }

  it.each([
    ["SQL_PARSE_UNSUPPORTED_STATEMENT", "syntax failure"],
    ["SQL_MISSING_COLUMN", "missing column `orders.city`"],
    ["SQL_DIALECT_MISMATCH", "dialect mismatch"],
    ["SQL_RELATIONSHIP_PATH_MISMATCH", "join path mismatch"]
  ])("marks %s validation failure as correctable", (code, message) => {
    const decision = service.decide(
      validationError({
        code,
        message,
        category: "validation"
      })
    );

    expect(decision).toMatchObject({
      correctable: true,
      maxAttempts: service.maxAttempts,
      category: "validation",
      source: "validation",
      failureCode: code
    });
  });

  it("reads validation artifacts before generic domain error classification", () => {
    const decision = service.decide(
      artifactError({
        code: "SQL_DRY_PLAN_RELATIONSHIP_MISMATCH",
        message: "dry-plan relationship consistency check failed",
        category: "validation",
        terminal: false
      })
    );

    expect(decision).toMatchObject({
      correctable: true,
      source: "validation",
      failureCode: "SQL_DRY_PLAN_RELATIONSHIP_MISMATCH"
    });
  });

  it.each([
    ["SQL_READ_ONLY_VIOLATION", "governance", "read-only failure"],
    ["SQL_TABLE_PERMISSION_DENIED", "governance", "table permission failure"],
    ["SQL_COLUMN_PERMISSION_DENIED", "governance", "column permission failure"],
    ["SQL_PLAN_FAIL_CLOSED", "validation", "fail-closed plan"],
    ["SQL_PLAN_REQUIRES_CLARIFICATION", "validation", "clarification required"]
  ] as const)(
    "skips correction for terminal %s",
    (code, category, message) => {
      const decision = service.decide(
        validationError({
          code,
          message,
          category,
          terminal: true,
          correctable: false
        })
      );

      expect(decision.correctable).toBe(false);
      expect(decision.maxAttempts).toBe(0);
      expect(decision.source).toBe("validation");
      expect(decision.failureCode).toBe(code);
    }
  );

  it.each([
    ["LLM_PROVIDER_UNAVAILABLE", "provider unavailable"],
    ["DATASOURCE_UNAVAILABLE", "datasource unavailable"]
  ])("treats %s domain errors as provider failures", (code, message) => {
    const decision = service.decide(new DomainError(code, message, 503));

    expect(decision).toMatchObject({
      correctable: false,
      maxAttempts: 0,
      category: "provider",
      source: "execution",
      failureCode: code
    });
  });

  it.each([
    "SQL syntax error near FROM",
    "unknown column `orders.city`",
    "dialect error: strftime unsupported",
    "cannot resolve join path for relationship binding"
  ])("keeps execution marker '%s' inside bounded retry budget", (message) => {
    const decision = service.decide(new Error(message));

    expect(decision.correctable).toBe(true);
    expect(decision.maxAttempts).toBe(service.maxAttempts);
    expect(decision.category).toBe("execution");
    expect(decision.source).toBe("execution");
  });

  it("does not retry opaque execution errors", () => {
    const decision = service.decide(new Error("network timeout"));

    expect(decision).toMatchObject({
      correctable: false,
      maxAttempts: 0,
      category: "unknown",
      source: "execution"
    });
  });

  it("tracks correction budget explicitly for graph loop control", () => {
    expect(
      service.resolveBudget({
        attemptCount: 1
      })
    ).toEqual({
      attemptCount: 1,
      maxAttempts: 2,
      remainingAttempts: 1,
      exhausted: false
    });

    expect(
      service.resolveBudget({
        attemptCount: 2
      }).exhausted
    ).toBe(true);
  });

  it("carries failed ledger obligation ids into correction grounding", () => {
    const node = new CorrectSqlNode(service);
    const result = node.run({
      failedSql: "SELECT COUNT(*) FROM orders",
      attemptCount: 0,
      semanticPlan: {
        route: "answer",
        standaloneQuestion: "统计客户订单",
        selectedTables: ["orders", "customers"],
        selectedColumns: [],
        confidence: 0.8,
        evidenceRefs: ["relationship-orders-customers"],
        filters: ["route_kind:text_to_sql"],
        snapshotId: "semantic-plan-v1"
      },
      validationArtifact: {
        status: "failed",
        correctable: true,
        failedObligationIds: ["ledger:join-path:orders-customers"],
        checks: [
          {
            check: "ledger-fulfillment",
            status: "failed",
            code: "SQL_LEDGER_FULFILLMENT_FAILED",
            message: "SQL does not fulfill all required ledger obligations",
            failedObligationIds: ["ledger:join-path:orders-customers"],
            reasonCodes: ["ledger_join_path_not_used"]
          }
        ],
        failure: {
          code: "SQL_LEDGER_FULFILLMENT_FAILED",
          message: "SQL does not fulfill all required ledger obligations",
          category: "validation",
          terminal: false,
          correctable: true
        }
      }
    });

    expect(result.outcome).toBe("retry_generation");
    expect(result.artifact.grounding.failedObligationIds).toEqual([
      "ledger:join-path:orders-customers"
    ]);
  });
});
