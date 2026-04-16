import { Test } from "@nestjs/testing";
import type { Datasource } from "@text2sql/shared-types";
import { AppModule } from "../../src/app.module";
import { DomainError } from "../../src/common/domain-error";
import { QueryExecutorRouterService } from "../../src/modules/data/query/query-executor-router.service";

describe("query executor router acl integration", () => {
  let router: QueryExecutorRouterService;

  beforeAll(async () => {
    process.env.SQLITE_PATH = process.env.SQLITE_PATH ?? "./data/sqlite/text2sql.db";
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "true";

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    router = moduleRef.get(QueryExecutorRouterService);
  });

  const datasource = (type: Datasource["type"]): Datasource => ({
    id: `ds-acl-${type}`,
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
        acl: {
          accessContext,
          resolveAllowedTables: async () => ["orders"]
        }
      })
    ).resolves.toMatchObject({
      columns: expect.any(Array),
      rows: expect.any(Array)
    });
  });

  it("returns ACL_FORBIDDEN for unauthorized table before executor dispatch", async () => {
    await expect(
      router.execute({
        datasource: datasource("sqlite"),
        sql: "SELECT * FROM orders",
        acl: {
          accessContext,
          allowedTables: ["users"]
        }
      })
    ).rejects.toMatchObject({
      code: "ACL_FORBIDDEN"
    } satisfies Partial<DomainError>);
  });

  it("returns ACL_PARSE_REJECTED for unsupported extraction pattern", async () => {
    await expect(
      router.execute({
        datasource: datasource("sqlite"),
        sql: "SELECT * FROM (SELECT * FROM orders) o",
        acl: {
          accessContext,
          allowedTables: ["orders"]
        }
      })
    ).rejects.toMatchObject({
      code: "ACL_PARSE_REJECTED"
    } satisfies Partial<DomainError>);
  });

  it("keeps fail-closed behavior when row filter rewrite cannot safely handle SQL", async () => {
    await expect(
      router.execute({
        datasource: datasource("sqlite"),
        sql: "SELECT id FROM orders UNION SELECT id FROM orders",
        acl: {
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
      code: "ACL_PARSE_REJECTED"
    } satisfies Partial<DomainError>);
  });

  it("applies ACL gate consistently across datasource types", async () => {
    const types: Datasource["type"][] = [
      "sqlite",
      "mysql",
      "postgresql",
      "csv",
      "excel"
    ];

    for (const type of types) {
      // ACL check runs before executor dispatch for every datasource type.
      await expect(
        router.execute({
          datasource: datasource(type),
          sql: "SELECT * FROM orders",
          acl: {
            accessContext,
            allowedTables: ["users"]
          }
        })
      ).rejects.toMatchObject({
        code: "ACL_FORBIDDEN"
      } satisfies Partial<DomainError>);
    }
  });
});
