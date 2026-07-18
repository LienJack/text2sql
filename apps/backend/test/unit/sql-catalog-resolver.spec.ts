import { SqlCatalogResolverService } from "../../src/modules/platform/data/sql-analysis/sql-catalog-resolver.service";
import { SqlDialectAnalyzerService } from "../../src/modules/platform/data/sql-analysis/sql-dialect-analyzer.service";
import type { DatasourceSchemaSnapshotV1 } from "../../src/modules/platform/data/schema/schema-snapshot.types";

describe("SqlCatalogResolverService", () => {
  const analyzer = new SqlDialectAnalyzerService();
  const resolver = new SqlCatalogResolverService();
  const snapshot: DatasourceSchemaSnapshotV1 = {
    version: "datasource-schema-snapshot.v1",
    snapshotId: "snapshot-1",
    digest: "schema-digest-1",
    datasourceId: "sqlite_main",
    datasourceType: "sqlite",
    workspaceId: "ws-1",
    workspaceDatasourceBindingId: "binding-1",
    policyVersion: 3,
    policyDigest: "policy-digest-3",
    tables: [
      {
        name: "orders",
        columns: [
          { name: "id", dataType: "integer", nullable: false, primaryKey: true, ordinal: 0 },
          { name: "customer_id", dataType: "integer", nullable: false, primaryKey: false, ordinal: 1 },
          { name: "amount", dataType: "numeric", nullable: false, primaryKey: false, ordinal: 2 }
        ]
      },
      {
        name: "customers",
        columns: [
          { name: "id", dataType: "integer", nullable: false, primaryKey: true, ordinal: 0 },
          { name: "name", dataType: "text", nullable: false, primaryKey: false, ordinal: 1 }
        ]
      }
    ],
    relationships: [],
    allowedSchemaSet: {
      version: "allowed-schema-set.v1",
      datasourceId: "sqlite_main",
      policyVersion: 3,
      schemaSnapshotDigest: "schema-digest-1",
      tables: ["orders", "customers"],
      columnsByTable: {
        orders: ["id", "customer_id", "amount"],
        customers: ["id", "name"]
      },
      digest: "allowed-schema-digest-1"
    },
    capturedAt: "2026-07-17T00:00:00.000Z"
  };

  it("resolves aliases and qualified columns against the frozen allowed schema", () => {
    const analysis = analyzer.analyze({
      datasourceType: "sqlite",
      sql: "SELECT o.amount, c.name FROM orders o JOIN customers c ON c.id = o.customer_id"
    });
    const result = resolver.resolve({ analysis, schemaSnapshot: snapshot, requireSnapshot: true });

    expect(result.status).toBe("resolved");
    expect(result.tables).toEqual(["orders", "customers"]);
    expect(result.columns.map((column) => column.qualifiedName)).toEqual(
      expect.arrayContaining([
        "orders.amount",
        "customers.name",
        "customers.id",
        "orders.customer_id"
      ])
    );
    expect(result.schemaSnapshotId).toBe("snapshot-1");
  });

  it("fails closed for an ambiguous unqualified column", () => {
    const analysis = analyzer.analyze({
      datasourceType: "sqlite",
      sql: "SELECT id FROM orders JOIN customers ON customers.id = orders.customer_id"
    });
    const result = resolver.resolve({ analysis, schemaSnapshot: snapshot, requireSnapshot: true });

    expect(result.status).toBe("failed");
    expect(result.reasonCodes).toContain("catalog_reference_ambiguous");
    expect(result.ambiguousReferences).toEqual(["column_reference_ambiguous"]);
  });

  it("does not expose an unauthorized hidden reference and requires the frozen snapshot", () => {
    const hidden = analyzer.analyze({
      datasourceType: "sqlite",
      sql: "WITH hidden AS (SELECT secret_value FROM secrets) SELECT secret_value FROM hidden"
    });
    const denied = resolver.resolve({ analysis: hidden, schemaSnapshot: snapshot, requireSnapshot: true });
    const missing = resolver.resolve({ analysis: hidden, requireSnapshot: true });

    expect(denied.status).toBe("failed");
    expect(denied.unknownReferences).toEqual(
      expect.arrayContaining(["table_reference_unresolved"])
    );
    expect(JSON.stringify(denied)).not.toContain("secret_value");
    expect(missing).toMatchObject({
      status: "failed",
      reasonCodes: ["schema_snapshot_unavailable"]
    });
  });
});
