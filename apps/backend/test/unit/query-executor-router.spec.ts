import type { Datasource } from "@text2sql/shared-types";
import { DomainError } from "../../src/common/domain-error";
import { QueryExecutorRouterService } from "../../src/modules/data/query/query-executor-router.service";

describe("QueryExecutorRouterService", () => {
  const datasource = (type: Datasource["type"]): Datasource => ({
    id: `ds-${type}`,
    name: `${type} datasource`,
    type,
    status: "available",
    readonly: true,
    shared: true,
    config: {},
    fileMeta: null,
    unavailableAt: null,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  it("routes execution by datasource type", async () => {
    const sqliteExecutor = {
      execute: jest.fn(async () => ({ rows: [{ id: 1 }], columns: ["id"] }))
    };
    const mysqlExecutor = {
      execute: jest.fn(async () => ({ rows: [{ id: 2 }], columns: ["id"] }))
    };
    const postgresExecutor = {
      execute: jest.fn(async () => ({ rows: [{ id: 3 }], columns: ["id"] }))
    };
    const fileExecutor = {
      execute: jest.fn(async () => ({ rows: [{ id: 4 }], columns: ["id"] }))
    };

    const router = new QueryExecutorRouterService(
      sqliteExecutor as never,
      mysqlExecutor as never,
      postgresExecutor as never,
      fileExecutor as never
    );

    await router.execute({ datasource: datasource("sqlite"), sql: "SELECT 1" });
    await router.execute({ datasource: datasource("mysql"), sql: "SELECT 1" });
    await router.execute({ datasource: datasource("postgresql"), sql: "SELECT 1" });
    await router.execute({ datasource: datasource("csv"), sql: "SELECT 1" });

    expect(sqliteExecutor.execute).toHaveBeenCalledTimes(1);
    expect(mysqlExecutor.execute).toHaveBeenCalledTimes(1);
    expect(postgresExecutor.execute).toHaveBeenCalledTimes(1);
    expect(fileExecutor.execute).toHaveBeenCalledTimes(1);
  });

  it("rejects write statements before hitting executors", async () => {
    const router = new QueryExecutorRouterService(
      { execute: jest.fn() } as never,
      { execute: jest.fn() } as never,
      { execute: jest.fn() } as never,
      { execute: jest.fn() } as never
    );

    await expect(
      router.execute({ datasource: datasource("sqlite"), sql: "DELETE FROM orders" })
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("appends default LIMIT when query has no limit", async () => {
    const sqliteExecutor = {
      execute: jest.fn(async () => ({ rows: [], columns: [] }))
    };
    const router = new QueryExecutorRouterService(
      sqliteExecutor as never,
      { execute: jest.fn() } as never,
      { execute: jest.fn() } as never,
      { execute: jest.fn() } as never
    );

    await router.execute({ datasource: datasource("sqlite"), sql: "SELECT * FROM orders" });

    expect(sqliteExecutor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: "SELECT * FROM orders LIMIT 50"
      })
    );
  });

  it("clamps explicit LIMIT above max boundary", async () => {
    const sqliteExecutor = {
      execute: jest.fn(async () => ({ rows: [], columns: [] }))
    };
    const router = new QueryExecutorRouterService(
      sqliteExecutor as never,
      { execute: jest.fn() } as never,
      { execute: jest.fn() } as never,
      { execute: jest.fn() } as never
    );

    await router.execute({
      datasource: datasource("sqlite"),
      sql: "SELECT * FROM orders LIMIT 9999"
    });

    expect(sqliteExecutor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: "SELECT * FROM orders LIMIT 200"
      })
    );
  });
});
