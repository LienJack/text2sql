import { SafetyCheckNode } from "../../src/modules/conversation/agent/nodes/safety-check.node";

describe("SafetyCheckNode", () => {
  const node = new SafetyCheckNode();

  it("accepts SELECT and WITH read-only SQL", async () => {
    await expect(
      node.run({
        sql: "SELECT * FROM orders",
        datasourceId: "sqlite_main"
      })
    ).resolves.toMatchObject({
      allowed: true,
      mode: "pass",
      riskLevel: "low",
      riskTags: []
    });

    await expect(
      node.run({
        sql: "WITH cte AS (SELECT * FROM orders) SELECT * FROM cte",
        datasourceId: "sqlite_main"
      })
    ).resolves.toMatchObject({
      allowed: true,
      mode: "pass",
      riskLevel: "low",
      riskTags: []
    });
  });

  it("rejects non-readonly SQL with SQL_READONLY_REJECTED", async () => {
    await expect(
      node.run({
        sql: "DELETE FROM orders",
        datasourceId: "sqlite_main"
      })
    ).resolves.toMatchObject({
      allowed: false,
      mode: "hard-block",
      riskLevel: "high",
      riskTags: ["readonly_violation"],
      reason: expect.stringContaining("只允许执行 SELECT 或 WITH ... SELECT 的只读查询")
    });
  });

  it("surfaces TABLE_PERMISSIONS_FORBIDDEN when allowed table set does not match", async () => {
    await expect(
      node.run({
        sql: "SELECT * FROM orders",
        datasourceId: "sqlite_main",
        accessContext: {
          actorId: "user-1",
          workspaceId: "ws-1",
          allowedTables: ["users"]
        }
      })
    ).resolves.toMatchObject({
      allowed: false,
      mode: "hard-block",
      riskLevel: "high",
      riskTags: ["table_access_denied"],
      reason: expect.stringContaining("无权访问表")
    });
  });

  it("uses AST extraction to authorize nested subqueries and still rejects inner unauthorized tables", async () => {
    await expect(
      node.run({
        sql: "SELECT * FROM (SELECT * FROM orders) o",
        datasourceId: "sqlite_main",
        accessContext: {
          actorId: "user-1",
          workspaceId: "ws-1",
          allowedTables: ["orders"]
        }
      })
    ).resolves.toMatchObject({
      allowed: true,
      mode: "pass",
      riskLevel: "low",
      riskTags: []
    });

    await expect(
      node.run({
        sql: "SELECT * FROM (SELECT * FROM users) u",
        datasourceId: "sqlite_main",
        accessContext: {
          actorId: "user-1",
          workspaceId: "ws-1",
          allowedTables: ["orders"]
        }
      })
    ).resolves.toMatchObject({
      allowed: false,
      mode: "hard-block",
      riskLevel: "high",
      riskTags: ["table_access_denied"]
    });
  });
});
