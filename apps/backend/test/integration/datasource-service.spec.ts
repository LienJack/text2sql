import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { DomainError } from "../../src/common/domain-error";
import { DatasourceService } from "../../src/modules/governance/datasource/datasource.service";

const execFileAsync = promisify(execFile);
const SYSTEM_ADMIN_ACTOR = {
  id: "system-admin",
  role: "admin" as const,
  isSystemAdmin: true
};

async function createSqliteFile(path: string, rows = 1): Promise<void> {
  const values = Array.from({ length: rows }, (_, index) => `(${index + 1})`).join(",");
  await execFileAsync("sqlite3", [
    path,
    `
DROP TABLE IF EXISTS orders;
CREATE TABLE orders (id INTEGER PRIMARY KEY);
INSERT INTO orders (id) VALUES ${values};
    `.trim()
  ]);
}

describe("datasource service", () => {
  beforeAll(() => {
    process.env.SQLITE_PATH = resolve(
      __dirname,
      "../../../../data/sqlite/text2sql.db"
    );
    process.env.SQLITE_ALLOWED_DIRS = [
      resolve(__dirname, "../../../../data/sqlite"),
      resolve(__dirname, "../../../../data/uploads/datasources")
    ].join(",");
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "true";
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("creates mysql/postgresql datasources and lists them", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    try {
      const datasourceService = moduleRef.get(DatasourceService);
      jest
        .spyOn(datasourceService as any, "loadMysqlModule")
        .mockResolvedValue({
          createConnection: jest.fn().mockResolvedValue({
            end: jest.fn().mockResolvedValue(undefined)
          })
        });
      class FakePgClient {
        async connect(): Promise<void> {}
        async end(): Promise<void> {}
      }
      jest
        .spyOn(datasourceService as any, "loadPostgresModule")
        .mockResolvedValue({
          Client: FakePgClient
        });

      await datasourceService.createDatasource({
        name: "MySQL 业务库",
        type: "mysql",
        host: "127.0.0.1",
        port: 3306,
        database: "biz",
        username: "root",
        password: "secret"
      });

      await datasourceService.createDatasource({
        name: "PostgreSQL 行为库",
        type: "postgresql",
        host: "127.0.0.1",
        port: 5432,
        database: "analytics",
        username: "postgres",
        password: "secret"
      });

      const list = await datasourceService.listDatasources();

      expect(list.some((item) => item.type === "mysql")).toBe(true);
      expect(list.some((item) => item.type === "postgresql")).toBe(true);
    } finally {
      await moduleRef.close();
    }
  });

  it("rejects invalid connection config before creating datasource", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    try {
      const datasourceService = moduleRef.get(DatasourceService);

      await expect(
        datasourceService.createDatasource({
          name: "无效配置",
          type: "mysql",
          host: "127.0.0.1"
        })
      ).rejects.toBeInstanceOf(DomainError);
    } finally {
      await moduleRef.close();
    }
  });

  it("creates reusable csv datasource metadata from uploaded file", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    try {
      const datasourceService = moduleRef.get(DatasourceService);

      const datasource = await datasourceService.createDatasourceFromUpload({
        uploadedFile: {
          originalname: "orders.csv",
          mimetype: "text/csv",
          size: 1024,
          path: "/tmp/orders.csv"
        }
      });

      expect(datasource.type).toBe("csv");
      expect(datasource.shared).toBe(true);
      expect(datasource.fileMeta?.originalName).toBe("orders.csv");
    } finally {
      await moduleRef.close();
    }
  });

  it("rejects sqlite create/preview paths outside SQLITE_ALLOWED_DIRS", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "text2sql-sqlite-allowed-"));
    const allowedDir = join(tempRoot, "allowed");
    const blockedDir = join(tempRoot, "blocked");
    await mkdir(allowedDir, { recursive: true });
    await mkdir(blockedDir, { recursive: true });
    const blockedPath = join(blockedDir, "blocked.db");
    await createSqliteFile(blockedPath, 2);

    process.env.SQLITE_ALLOWED_DIRS = allowedDir;
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    try {
      const datasourceService = moduleRef.get(DatasourceService);

      await expect(
        datasourceService.createDatasource({
          name: "blocked-sqlite",
          type: "sqlite",
          filePath: blockedPath
        })
      ).rejects.toMatchObject({
        code: "SQLITE_PATH_NOT_ALLOWED"
      });

      await expect(
        datasourceService.previewDatasourceTables(SYSTEM_ADMIN_ACTOR, {
          mode: "create",
          datasource: {
            type: "sqlite",
            name: "blocked-preview",
            filePath: blockedPath
          }
        })
      ).rejects.toMatchObject({
        code: "SQLITE_PATH_NOT_ALLOWED"
      });
    } finally {
      await moduleRef.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("blocks symlink escape when realpath points outside SQLITE_ALLOWED_DIRS", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "text2sql-sqlite-symlink-"));
    const allowedDir = join(tempRoot, "allowed");
    const blockedDir = join(tempRoot, "blocked");
    await mkdir(allowedDir, { recursive: true });
    await mkdir(blockedDir, { recursive: true });
    const blockedPath = join(blockedDir, "blocked.db");
    await createSqliteFile(blockedPath, 1);
    const symlinkPath = join(allowedDir, "through-link.db");
    await symlink(blockedPath, symlinkPath);

    process.env.SQLITE_ALLOWED_DIRS = allowedDir;
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    try {
      const datasourceService = moduleRef.get(DatasourceService);

      await expect(
        datasourceService.createDatasource({
          name: "symlink-escape",
          type: "sqlite",
          filePath: symlinkPath
        })
      ).rejects.toMatchObject({
        code: "SQLITE_PATH_NOT_ALLOWED"
      });
    } finally {
      await moduleRef.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps sqlite config unchanged when update preflight fails", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "text2sql-sqlite-update-"));
    const allowedDir = join(tempRoot, "allowed");
    await mkdir(allowedDir, { recursive: true });
    const validDbPath = join(allowedDir, "valid.db");
    await createSqliteFile(validDbPath, 2);
    const invalidDbPath = join(allowedDir, "invalid.db");
    await writeFile(invalidDbPath, "not-a-sqlite-file", "utf8");

    process.env.SQLITE_ALLOWED_DIRS = allowedDir;
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    try {
      const datasourceService = moduleRef.get(DatasourceService);
      const datasource = await datasourceService.createDatasource({
        name: "sqlite-update-target",
        type: "sqlite",
        filePath: validDbPath
      });

      await expect(
        datasourceService.updateDatasource(SYSTEM_ADMIN_ACTOR, datasource.id, {
          filePath: invalidDbPath
        })
      ).rejects.toMatchObject({
        code: "SQLITE_PRECHECK_FAILED"
      });

      const persisted = await datasourceService.getDatasourceOrThrow(datasource.id);
      expect((persisted.config as Record<string, unknown>)?.path).toBe(validDbPath);
    } finally {
      await moduleRef.close();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
