import { SqlSafetyGuard } from "../../src/modules/conversation/agent/sql/tools/sql-safety.guard";

describe("SqlSafetyGuard", () => {
  const guard = new SqlSafetyGuard({
    sqlSafetySoftWarnMaxLength: 120
  } as any);

  it("should allow read-only select sql", () => {
    expect(() =>
      guard.assertReadOnlySql("SELECT status, COUNT(*) FROM orders GROUP BY status")
    ).not.toThrow();
  });

  it("should reject write sql", () => {
    expect(() => guard.assertReadOnlySql("DELETE FROM orders")).toThrow(
      expect.objectContaining({
        code: "TOOL_INPUT_INVALID"
      })
    );
  });

  it("should mark cte as soft warning instead of hard reject", () => {
    const decision = guard.evaluate(
      "WITH top_orders AS (SELECT * FROM orders) SELECT * FROM top_orders"
    );
    expect(decision.allowed).toBe(true);
    expect(decision.mode).toBe("soft-warn");
    expect(decision.riskTags).toContain("cte_query");
  });
});
