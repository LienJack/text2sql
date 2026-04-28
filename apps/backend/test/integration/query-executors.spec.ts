import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { DatasourceRepository } from "../../src/modules/data/persistence/datasource.repository";
import { QueryExecutorRouterService } from "../../src/modules/data/query/query-executor-router.service";
import { createSeededSqliteFixture } from "../support/sqlite-fixture";

const execFileAsync = promisify(execFile);

async function createSimpleSqliteDb(path: string, rows: number): Promise<void> {
  const values = Array.from({ length: rows }, (_, index) => `(${index + 1})`).join(",");
  await execFileAsync("sqlite3", [
    path,
    `
DROP TABLE IF EXISTS metrics;
CREATE TABLE metrics (id INTEGER PRIMARY KEY);
INSERT INTO metrics (id) VALUES ${values};
    `.trim()
  ]);
}

describe("query executors", () => {
  let cleanupFixture: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const fixture = await createSeededSqliteFixture("query-executors");
    cleanupFixture = fixture.cleanup;
    process.env.SQLITE_PATH = fixture.dbPath;
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "true";
  });

  afterAll(async () => {
    if (cleanupFixture) {
      await cleanupFixture();
    }
  });

  it("executes sqlite datasource query through router", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    try {
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
    } finally {
      await moduleRef.close();
    }
  });

  it("executes csv datasource query through file executor", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "text2sql-csv-executor-"));
    const csvPath = join(tempDir, "orders.csv");
    await writeFile(csvPath, "order_id,amount\n1,120\n2,350\n", "utf8");

    try {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule]
      }).compile();

      try {
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
        await moduleRef.close();
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("isolates sqlite execution by datasource config.path", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "text2sql-sqlite-isolation-"));
    const dbA = join(tempDir, "a.db");
    const dbB = join(tempDir, "b.db");
    await createSimpleSqliteDb(dbA, 2);
    await createSimpleSqliteDb(dbB, 5);

    try {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule]
      }).compile();

      try {
        const datasourceRepository = moduleRef.get(DatasourceRepository);
        const router = moduleRef.get(QueryExecutorRouterService);

        const datasourceA = await datasourceRepository.upsertDatasource({
          id: "ds-sqlite-iso-a",
          name: "SQLite A",
          type: "sqlite",
          status: "available",
          readonly: true,
          shared: true,
          config: { path: dbA }
        });
        const datasourceB = await datasourceRepository.upsertDatasource({
          id: "ds-sqlite-iso-b",
          name: "SQLite B",
          type: "sqlite",
          status: "available",
          readonly: true,
          shared: true,
          config: { path: dbB }
        });

        const resultA = await router.execute({
          datasource: datasourceA,
          sql: "SELECT COUNT(*) AS total FROM metrics"
        });
        const resultB = await router.execute({
          datasource: datasourceB,
          sql: "SELECT COUNT(*) AS total FROM metrics"
        });

        expect(Number(resultA.rows[0]?.total)).toBe(2);
        expect(Number(resultB.rows[0]?.total)).toBe(5);
      } finally {
        await moduleRef.close();
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects sqlite datasource without config.path except sqlite_main fallback", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    try {
      const datasourceRepository = moduleRef.get(DatasourceRepository);
      const router = moduleRef.get(QueryExecutorRouterService);

      const invalidDatasource = await datasourceRepository.upsertDatasource({
        id: "ds-sqlite-missing-path",
        name: "SQLite 缺路径",
        type: "sqlite",
        status: "available",
        readonly: true,
        shared: true,
        config: {}
      });

      await expect(
        router.execute({
          datasource: invalidDatasource,
          sql: "SELECT 1 AS value"
        })
      ).rejects.toMatchObject({
        code: "SQLITE_DATASOURCE_PATH_MISSING"
      });

      const sqliteMain = await datasourceRepository.upsertDatasource({
        id: "sqlite_main",
        name: "SQLite 主数据源",
        type: "sqlite",
        status: "available",
        readonly: true,
        shared: true,
        config: {}
      });
      const mainResult = await router.execute({
        datasource: sqliteMain,
        sql: "SELECT 1 AS value"
      });
      expect(mainResult.rows[0]?.value).toBe(1);
    } finally {
      await moduleRef.close();
    }
  });
});
