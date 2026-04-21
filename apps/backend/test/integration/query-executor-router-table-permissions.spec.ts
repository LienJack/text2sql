import { Test } from "@nestjs/testing";
import type { Datasource } from "@text2sql/shared-types";
import { AppModule } from "../../src/app.module";
import { DomainError } from "../../src/common/domain-error";
import { QueryExecutorRouterService } from "../../src/modules/data/query/query-executor-router.service";
import { createSeededSqliteFixture } from "../support/sqlite-fixture";

describe("query executor router table-permissions integration", () => {
  let router: QueryExecutorRouterService;
  let cleanupFixture: (() => Promise<void>) | undefined;
  let closeModuleRef: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const fixture = await createSeededSqliteFixture("query-router-table-permissions");
    cleanupFixture = fixture.cleanup;
    process.env.SQLITE_PATH = fixture.dbPath;
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "true";

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    router = moduleRef.get(QueryExecutorRouterService);
    closeModuleRef = () => moduleRef.close();
  });

  afterAll(async () => {
    if (closeModuleRef) {
      await closeModuleRef();
    }
    if (cleanupFixture) {
      await cleanupFixture();
    }
  });

  const datasource = (type: Datasource["type"]): Datasource => ({
    id: `ds-table-permissions-${type}`,
    name: `Datasource ${type}`,
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

  const accessContext = {
    actorId: "user-1",
    workspaceId: "ws-1"
  };

  it("allows execution when all referenced tables are authorized", async () => {
    await expect(
      router.execute({
        datasource: datasource("sqlite"),
        sql: "SELECT status, COUNT(*) AS total FROM orders GROUP BY status",
        tablePermissions: {
          accessContext,
          resolveAllowedTables: async () => ["orders"]
        }
      })
    ).resolves.toMatchObject({
      columns: expect.any(Array),
      rows: expect.any(Array)
    });
  });

  it("returns TABLE_PERMISSIONS_FORBIDDEN for unauthorized table before executor dispatch", async () => {
    await expect(
      router.execute({
        datasource: datasource("sqlite"),
        sql: "SELECT * FROM orders",
        tablePermissions: {
          accessContext,
          allowedTables: ["users"]
        }
      })
    ).rejects.toMatchObject({
      code: "TABLE_PERMISSIONS_FORBIDDEN"
    } satisfies Partial<DomainError>);
  });

  it("returns TABLE_PERMISSIONS_PARSE_REJECTED for unsupported extraction pattern", async () => {
    await expect(
      router.execute({
        datasource: datasource("sqlite"),
        sql: "SELECT * FROM (SELECT * FROM orders) o",
        tablePermissions: {
          accessContext,
          allowedTables: ["orders"]
        }
      })
    ).rejects.toMatchObject({
      code: "TABLE_PERMISSIONS_PARSE_REJECTED"
    } satisfies Partial<DomainError>);
  });

  it("keeps fail-closed behavior when row filter rewrite cannot safely handle SQL", async () => {
    await expect(
      router.execute({
        datasource: datasource("sqlite"),
        sql: "SELECT id FROM orders UNION SELECT id FROM orders",
        tablePermissions: {
          accessContext: {
            ...accessContext,
            rowFiltersByTable: {
              orders: "1 = 1"
            }
          },
          allowedTables: ["orders"]
        }
      })
    ).rejects.toMatchObject({
      code: "TABLE_PERMISSIONS_PARSE_REJECTED"
    } satisfies Partial<DomainError>);
  });

  it("applies table-permissions gate consistently across datasource types", async () => {
    const types: Datasource["type"][] = [
      "sqlite",
      "mysql",
      "postgresql",
      "csv",
      "excel"
    ];

    for (const type of types) {
      // table-permissions check runs before executor dispatch for every datasource type.
      await expect(
        router.execute({
          datasource: datasource(type),
          sql: "SELECT * FROM orders",
          tablePermissions: {
            accessContext,
            allowedTables: ["users"]
          }
        })
      ).rejects.toMatchObject({
        code: "TABLE_PERMISSIONS_FORBIDDEN"
      } satisfies Partial<DomainError>);
    }
  });
});
