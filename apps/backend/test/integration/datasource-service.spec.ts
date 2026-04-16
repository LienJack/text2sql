import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { DomainError } from "../../src/common/domain-error";
import { DatasourceService } from "../../src/modules/datasource/datasource.service";

describe("datasource service", () => {
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

  it("creates mysql/postgresql datasources and lists them", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

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
  });

  it("rejects invalid connection config before creating datasource", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const datasourceService = moduleRef.get(DatasourceService);

    await expect(
      datasourceService.createDatasource({
        name: "无效配置",
        type: "mysql",
        host: "127.0.0.1"
      })
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("creates reusable csv datasource metadata from uploaded file", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

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
  });
});
