import { DomainError } from "../../src/common/domain-error";
import { SqlTableAccessGuardService } from "../../src/modules/data/query/sql-table-access-guard.service";

describe("SqlTableAccessGuardService", () => {
  const guard = new SqlTableAccessGuardService();

  it("keeps readonly guard behavior for SELECT / WITH", () => {
    expect(() => guard.assertReadOnlySql("SELECT * FROM orders")).not.toThrow();
    expect(() =>
      guard.assertReadOnlySql(
        "WITH recent AS (SELECT * FROM orders) SELECT * FROM recent"
      )
    ).not.toThrow();
    expect(() => guard.assertReadOnlySql("DELETE FROM orders")).toThrow(
      expect.objectContaining({
        code: "SQL_READONLY_REJECTED"
      })
    );
  });

  it("extracts table refs for CTE + JOIN and excludes CTE alias", () => {
    const result = guard.extractReferencedTables(
      [
        "WITH recent_orders AS (",
        "  SELECT * FROM orders",
        ")",
        "SELECT u.id FROM recent_orders ro",
        "JOIN users u ON u.id = ro.user_id"
      ].join("\n")
    );

    expect(result.complete).toBe(true);
    expect(result.tables).toEqual(["orders", "users"]);
  });

  it("extracts schema-qualified and quoted identifiers", () => {
    const result = guard.extractReferencedTables(
      'SELECT * FROM "public"."Orders" o JOIN `crm`.`customers` c ON c.id=o.customer_id'
    );

    expect(result.complete).toBe(true);
    expect(result.tables).toEqual(["public.orders", "crm.customers"]);
  });

  it("fails closed on derived table syntax it cannot fully parse", () => {
    const result = guard.extractReferencedTables(
      "SELECT * FROM (SELECT * FROM orders) o"
    );

    expect(result.complete).toBe(false);
    expect(result.reason).toContain("无法穷尽引用表");
  });

  it("returns ACL_PARSE_REJECTED for incomplete extraction", async () => {
    await expect(
      guard.assertTableAccess({
        sql: "SELECT * FROM (SELECT * FROM orders) o",
        datasourceId: "sqlite_main",
        accessContext: {
          actorId: "user-1",
          workspaceId: "ws-1",
          allowedTables: ["orders"]
        }
      })
    ).rejects.toMatchObject({
      code: "ACL_PARSE_REJECTED"
    } satisfies Partial<DomainError>);
  });

  it("returns ACL_FORBIDDEN for unauthorized table", async () => {
    await expect(
      guard.assertTableAccess({
        sql: "SELECT * FROM orders",
        datasourceId: "sqlite_main",
        accessContext: {
          actorId: "user-1",
          workspaceId: "ws-1",
          allowedTables: ["users"]
        }
      })
    ).rejects.toMatchObject({
      code: "ACL_FORBIDDEN"
    } satisfies Partial<DomainError>);
  });

  it("allows query when all referenced tables are authorized", async () => {
    const result = await guard.assertTableAccess({
      sql: "SELECT o.id, u.name FROM orders o JOIN users u ON u.id = o.user_id",
      datasourceId: "sqlite_main",
      accessContext: {
        actorId: "user-1",
        workspaceId: "ws-1",
        allowedTables: ["orders", "users"]
      }
    });

    expect(result.sql).toBe(
      "SELECT o.id, u.name FROM orders o JOIN users u ON u.id = o.user_id"
    );
    expect(result.referencedTables).toEqual(["orders", "users"]);
    expect(result.rowFilterApplied).toBe(false);
  });

  it("rewrites single-table query with row filter hook when available", async () => {
    const result = await guard.assertTableAccess({
      sql: "SELECT id FROM orders",
      datasourceId: "sqlite_main",
      accessContext: {
        actorId: "user-1",
        workspaceId: "ws-1",
        allowedTables: ["orders"],
        rowFiltersByTable: {
          orders: "tenant_id = 'ws-1'"
        }
      }
    });

    expect(result.rowFilterApplied).toBe(true);
    expect(result.sql).toBe(
      "SELECT id FROM orders WHERE (tenant_id = 'ws-1')"
    );
  });

  it("keeps fail-closed behavior for wildcard projection under column policy hook", async () => {
    await expect(
      guard.assertTableAccess({
        sql: "SELECT * FROM orders",
        datasourceId: "sqlite_main",
        accessContext: {
          actorId: "user-1",
          workspaceId: "ws-1",
          allowedTables: ["orders"],
          allowedColumnsByTable: {
            orders: ["id"]
          }
        }
      })
    ).rejects.toMatchObject({
      code: "ACL_PARSE_REJECTED"
    } satisfies Partial<DomainError>);
  });
});
