import { SqlOutputExtractor } from "../../src/modules/conversation/agent/sql/sql-output-extractor";

describe("SqlOutputExtractor", () => {
  const extractor = new SqlOutputExtractor();

  it("should extract sql from markdown code block", () => {
    const result = extractor.extract([
      "这是统计结果。",
      "```sql",
      "SELECT status, COUNT(*) AS count FROM orders GROUP BY status",
      "```"
    ].join("\n"));

    expect(result.sql).toBe("SELECT status, COUNT(*) AS count FROM orders GROUP BY status;");
    expect(result.explanation).toContain("这是统计结果");
  });

  it("should extract inline select statement when no code block exists", () => {
    const result = extractor.extract(
      "推荐查询是 SELECT * FROM orders WHERE status = 'paid'"
    );
    expect(result.sql.toLowerCase()).toContain("select * from orders");
  });
});
