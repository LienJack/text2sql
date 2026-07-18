import { SqlDialectAnalyzerService } from "../../src/modules/platform/data/sql-analysis/sql-dialect-analyzer.service";

describe("SqlDialectAnalyzerService", () => {
  const analyzer = new SqlDialectAnalyzerService();

  it.each([
    ["sqlite", "WITH recent AS (SELECT id, customer_id FROM orders) SELECT id FROM recent"],
    ["mysql", "SELECT `o`.`id` FROM `orders` AS `o` WHERE `o`.`id` > 0"],
    ["postgresql", 'SELECT "o"."id" FROM "orders" AS "o" WHERE "o"."id" > 0']
  ] as const)("parses the supported %s read-only subset", (datasourceType, sql) => {
    const result = analyzer.analyze({ sql, datasourceType });

    expect(result.status).toBe("ready");
    expect(result.readOnly).toBe(true);
    expect(result.statementCount).toBe(1);
    expect(result.tables.map((table) => table.normalizedName)).toContain("orders");
    expect(result.astNodeCount).toBeGreaterThan(0);
    expect(result.normalizedSqlDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("extracts base-table lineage from a CTE and excludes the CTE alias", () => {
    const result = analyzer.analyze({
      datasourceType: "sqlite",
      sql: "WITH recent AS (SELECT id FROM secret_orders) SELECT id FROM recent"
    });

    expect(result.status).toBe("ready");
    expect(result.tables.map((table) => table.normalizedName)).toEqual([
      "secret_orders"
    ]);
    expect(result.lineage.ctes).toEqual([
      {
        name: "recent",
        sourceTables: ["secret_orders"]
      }
    ]);
  });

  it("rejects multi-statement, locking, and unsupported dialect inputs", () => {
    expect(
      analyzer.analyze({
        datasourceType: "sqlite",
        sql: "SELECT 1; SELECT 2"
      }).diagnostics[0]?.code
    ).toBe("SQL_ANALYSIS_STATEMENT_BUDGET_EXCEEDED");
    expect(
      analyzer.analyze({
        datasourceType: "mysql",
        sql: "SELECT * FROM orders FOR UPDATE"
      }).readOnly
    ).toBe(false);
    expect(
      analyzer.analyze({ datasourceType: "csv", sql: "SELECT 1" })
    ).toMatchObject({
      status: "unavailable",
      diagnostics: [
        expect.objectContaining({ code: "SQL_ANALYSIS_DIALECT_UNAVAILABLE" })
      ]
    });
  });

  it("fails deterministically when structural resource budgets are exceeded", () => {
    const bytes = analyzer.analyze({
      datasourceType: "sqlite",
      sql: "SELECT 1",
      budget: { maxSqlBytes: 3 }
    });
    const depth = analyzer.analyze({
      datasourceType: "sqlite",
      sql: "SELECT id FROM orders",
      budget: { maxAstDepth: 2 }
    });

    expect(bytes.diagnostics[0]?.code).toBe("SQL_ANALYSIS_SQL_BYTES_EXCEEDED");
    expect(depth.diagnostics[0]?.code).toBe("SQL_ANALYSIS_AST_DEPTH_EXCEEDED");
  });

  it("produces a stable digest for insignificant whitespace and trailing semicolons", () => {
    const first = analyzer.analyze({
      datasourceType: "sqlite",
      sql: "SELECT id FROM orders"
    });
    const second = analyzer.analyze({
      datasourceType: "sqlite",
      sql: "  SELECT   id   FROM orders;  "
    });

    expect(second.normalizedSqlDigest).toBe(first.normalizedSqlDigest);
  });
});
