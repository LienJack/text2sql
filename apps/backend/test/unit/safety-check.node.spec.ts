import { SafetyCheckNode } from "../../src/modules/agent/nodes/safety-check.node";

describe("SafetyCheckNode", () => {
  const node = new SafetyCheckNode();

  it("accepts SELECT and WITH read-only SQL", async () => {
    await expect(
      node.run({
        sql: "SELECT * FROM orders",
        datasourceId: "sqlite_main"
      })
    ).resolves.toEqual({ safe: true });

    await expect(
      node.run({
        sql: "WITH cte AS (SELECT * FROM orders) SELECT * FROM cte",
        datasourceId: "sqlite_main"
      })
    ).resolves.toEqual({ safe: true });
  });

  it("rejects non-readonly SQL with SQL_READONLY_REJECTED", async () => {
    await expect(
      node.run({
        sql: "DELETE FROM orders",
        datasourceId: "sqlite_main"
      })
    ).resolves.toMatchObject({
      safe: false,
      code: "SQL_READONLY_REJECTED"
    });
  });

  it("surfaces ACL_FORBIDDEN when allowed table set does not match", async () => {
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
      safe: false,
      code: "ACL_FORBIDDEN"
    });
  });

  it("surfaces ACL_PARSE_REJECTED for unsupported table extraction pattern", async () => {
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
      safe: false,
      code: "ACL_PARSE_REJECTED"
    });
  });
});
