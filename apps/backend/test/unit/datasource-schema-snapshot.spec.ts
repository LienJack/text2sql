import type { Datasource } from "@text2sql/shared-types";
import { DatasourceSchemaSnapshotService } from "../../src/modules/platform/data/schema/datasource-schema-snapshot.service";

describe("DatasourceSchemaSnapshotService", () => {
  const datasource: Datasource = {
    id: "ds-1",
    name: "orders",
    type: "sqlite",
    readonly: true,
    shared: false,
    status: "available",
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z"
  };

  it("freezes only policy-authorized tables and derives deterministic allowed columns", async () => {
    const execute = jest.fn(async ({ sql }: { sql: string }) => ({
      rows: sql.includes("orders")
        ? [
            {
              columnName: "id",
              dataType: "INTEGER",
              isNullable: "NO",
              columnKey: 1,
              ordinalPosition: 1
            },
            {
              columnName: "amount",
              dataType: "NUMERIC",
              isNullable: "NO",
              columnKey: 0,
              ordinalPosition: 2
            }
          ]
        : [],
      columns: [],
      rowCount: 2
    }));
    const service = new DatasourceSchemaSnapshotService({ execute } as never);
    const input = {
      datasource,
      policy: {
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        workspaceDatasourceBindingId: "binding-1",
        policyVersion: 7,
        policyDigest: "policy-digest-7",
        allowedTables: ["orders"]
      },
      capturedAt: "2026-07-17T01:00:00.000Z"
    };

    const first = await service.capture(input);
    const second = await service.capture({
      ...input,
      capturedAt: "2026-07-17T02:00:00.000Z"
    });

    expect(first.tables.map((table) => table.name)).toEqual(["orders"]);
    expect(first.allowedSchemaSet.columnsByTable).toEqual({
      orders: ["id", "amount"]
    });
    expect(first.allowedSchemaSet.policyVersion).toBe(7);
    expect(first.allowedSchemaSet.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.digest).toBe(second.digest);
    expect(first.allowedSchemaSet.digest).toBe(second.allowedSchemaSet.digest);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the authorized table set is empty", async () => {
    const service = new DatasourceSchemaSnapshotService({ execute: jest.fn() } as never);
    await expect(
      service.capture({
        datasource,
        policy: {
          workspaceId: "ws-1",
          datasourceId: "ds-1",
          workspaceDatasourceBindingId: "binding-1",
          policyVersion: 1,
          policyDigest: "policy-1",
          allowedTables: []
        }
      })
    ).rejects.toMatchObject({ code: "ALLOWED_SCHEMA_EMPTY" });
  });
});
