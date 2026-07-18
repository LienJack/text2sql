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

  it("uses AST lineage to resolve derived-table references", () => {
    const result = guard.extractReferencedTables(
      "SELECT * FROM (SELECT * FROM orders) o"
    );

    expect(result.complete).toBe(true);
    expect(result.tables).toEqual(["orders"]);
  });

  it("rejects an unauthorized table hidden in a derived query", async () => {
    await expect(
      guard.assertTableAccess({
        sql: "SELECT id FROM (SELECT id FROM secret_orders) o",
        datasourceId: "sqlite_main",
        accessContext: {
          actorId: "user-1",
          workspaceId: "ws-1",
          allowedTables: ["orders"]
        }
      })
    ).rejects.toMatchObject({
      code: "TABLE_PERMISSIONS_FORBIDDEN"
    } satisfies Partial<DomainError>);
  });

  it("returns TABLE_PERMISSIONS_FORBIDDEN for unauthorized table", async () => {
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
      code: "TABLE_PERMISSIONS_FORBIDDEN"
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
      code: "TABLE_PERMISSIONS_PARSE_REJECTED"
    } satisfies Partial<DomainError>);
  });

  it("rejects denied columns without exposing their names in the error payload", async () => {
    const promise = guard.assertTableAccess({
      sql: "SELECT secret_amount FROM orders",
      datasourceId: "sqlite_main",
      accessContext: {
        actorId: "user-1",
        workspaceId: "ws-1",
        allowedTables: ["orders"],
        allowedColumnsByTable: {
          orders: ["id"]
        }
      }
    });

    await expect(promise).rejects.toMatchObject({
      code: "TABLE_PERMISSIONS_FORBIDDEN"
    } satisfies Partial<DomainError>);
    await expect(promise).rejects.not.toMatchObject({
      message: expect.stringContaining("secret_amount")
    });
  });
});
