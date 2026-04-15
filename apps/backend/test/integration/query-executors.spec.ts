import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { DatasourceRepository } from "../../src/modules/data/persistence/datasource.repository";
import { QueryExecutorRouterService } from "../../src/modules/data/query/query-executor-router.service";

describe("query executors", () => {
  beforeAll(() => {
    process.env.SQLITE_PATH = resolve(
      __dirname,
      "../../../../data/sqlite/text2sql.db"
    );
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "true";
  });

  it("executes sqlite datasource query through router", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const datasourceRepository = moduleRef.get(DatasourceRepository);
    const router = moduleRef.get(QueryExecutorRouterService);

    const sqliteDatasource = await datasourceRepository.ensureBaselineSqliteDatasource(
      process.env.SQLITE_PATH ?? ""
    );

    const result = await router.execute({
      datasource: sqliteDatasource,
      sql: "SELECT 1 AS value"
    });

    expect(result.columns).toContain("value");
    expect(result.rows[0]?.value).toBe(1);
  });

  it("executes csv datasource query through file executor", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "text2sql-csv-executor-"));
    const csvPath = join(tempDir, "orders.csv");
    await writeFile(csvPath, "order_id,amount\n1,120\n2,350\n", "utf8");

    try {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule]
      }).compile();

      const datasourceRepository = moduleRef.get(DatasourceRepository);
      const router = moduleRef.get(QueryExecutorRouterService);

      const fileDatasource = await datasourceRepository.upsertDatasource({
        id: "ds-csv-executor",
        name: "CSV 执行器",
        type: "csv",
        status: "available",
        readonly: true,
        shared: true,
        config: {
          path: csvPath,
          tableName: "orders_csv"
        }
      });

      const result = await router.execute({
        datasource: fileDatasource,
        sql: "SELECT COUNT(*) AS total FROM orders_csv"
      });

      expect(result.rows.length).toBeGreaterThan(0);
      const firstValue = Number(Object.values(result.rows[0] ?? {})[0]);
      expect(firstValue).toBe(2);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
