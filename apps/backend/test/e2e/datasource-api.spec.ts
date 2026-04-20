import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { DatasourceService } from "../../src/modules/governance/datasource/datasource.service";

describe("datasource api (e2e)", () => {
  let app: INestApplication;
  let tempDir: string;
  let datasourceService: DatasourceService;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "text2sql-datasource-upload-"));
    process.env.SQLITE_PATH = resolve(
      __dirname,
      "../../../../data/sqlite/text2sql.db"
    );
    process.env.DATASOURCE_UPLOAD_DIR = tempDir;
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "true";

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    datasourceService = app.get(DatasourceService);
  });

  afterAll(async () => {
    await app.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("creates datasource and returns list when mysql preflight passes", async () => {
    const mysqlCreateConnection = jest.fn().mockResolvedValue({
      end: jest.fn().mockResolvedValue(undefined)
    });
    jest
      .spyOn(datasourceService as any, "loadMysqlModule")
      .mockResolvedValue({
        createConnection: mysqlCreateConnection
      });

    const createRes = await request(app.getHttpServer())
      .post("/api/v1/datasources")
      .send({
        name: "行为分析 PostgreSQL",
        type: "mysql",
        host: "127.0.0.1",
        port: 3306,
        database: "analytics",
        username: "root",
        password: "secret"
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.status).toBe("success");
    expect(createRes.body.data.type).toBe("mysql");
    expect(mysqlCreateConnection).toHaveBeenCalledTimes(1);

    const listRes = await request(app.getHttpServer())
      .get("/api/v1/datasources")
      .send();

    expect(listRes.status).toBe(200);
    expect(listRes.body.status).toBe("success");
    expect(
      listRes.body.data.some((item: { type: string }) => item.type === "mysql")
    ).toBe(true);
  });

  it("supports csv upload and creates reusable file datasource", async () => {
    const filePath = join(tempDir, "orders.csv");
    await writeFile(filePath, "order_id,amount\n1,120\n2,350\n", "utf8");

    const uploadRes = await request(app.getHttpServer())
      .post("/api/v1/datasources/upload")
      .field("name", "订单 CSV")
      .attach("file", filePath);

    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.status).toBe("success");
    expect(uploadRes.body.data.type).toBe("csv");
    expect(uploadRes.body.data.name).toBe("订单 CSV");
  });

  it("classifies auth failure as CONNECTION_AUTH_FAILED", async () => {
    jest
      .spyOn(datasourceService as any, "loadMysqlModule")
      .mockResolvedValue({
        createConnection: jest.fn().mockRejectedValue({
          code: "ER_ACCESS_DENIED_ERROR",
          errno: 1045,
          message: "Access denied for user"
        })
      });

    const createRes = await request(app.getHttpServer())
      .post("/api/v1/datasources")
      .send({
        name: "鉴权失败连接",
        type: "mysql",
        host: "127.0.0.1",
        port: 3306,
        database: "analytics",
        username: "root",
        password: "wrong-password"
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.status).toBe("error");
    expect(createRes.body.error.code).toBe("CONNECTION_AUTH_FAILED");
    expect(createRes.body.error.details.suggestedAction).toBe("retry");
  });

  it("classifies network failure as CONNECTION_NETWORK_UNREACHABLE", async () => {
    const connect = jest.fn().mockRejectedValue({
      code: "ECONNREFUSED",
      message: "connect ECONNREFUSED 127.0.0.1:5432"
    });
    const end = jest.fn().mockResolvedValue(undefined);

    class FakePgClient {
      async connect(): Promise<void> {
        await connect();
      }

      async end(): Promise<void> {
        await end();
      }
    }

    jest
      .spyOn(datasourceService as any, "loadPostgresModule")
      .mockResolvedValue({
        Client: FakePgClient
      });

    const createRes = await request(app.getHttpServer())
      .post("/api/v1/datasources")
      .send({
        name: "网络失败连接",
        type: "postgresql",
        host: "127.0.0.1",
        port: 5432,
        database: "analytics",
        username: "postgres",
        password: "secret"
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.status).toBe("error");
    expect(createRes.body.error.code).toBe("CONNECTION_NETWORK_UNREACHABLE");
    expect(createRes.body.error.details.suggestedAction).toBe("retry");
  });

  it("classifies database-not-found failure as CONNECTION_DATABASE_NOT_FOUND", async () => {
    jest
      .spyOn(datasourceService as any, "loadMysqlModule")
      .mockResolvedValue({
        createConnection: jest.fn().mockRejectedValue({
          code: "ER_BAD_DB_ERROR",
          errno: 1049,
          message: "Unknown database 'missing_db'"
        })
      });

    const createRes = await request(app.getHttpServer())
      .post("/api/v1/datasources")
      .send({
        name: "数据库不存在",
        type: "mysql",
        host: "127.0.0.1",
        port: 3306,
        database: "missing_db",
        username: "root",
        password: "secret"
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.status).toBe("error");
    expect(createRes.body.error.code).toBe("CONNECTION_DATABASE_NOT_FOUND");
    expect(createRes.body.error.details.suggestedAction).toBe("previous");
  });

  it("classifies invalid config as CONNECTION_CONFIG_INVALID", async () => {
    const createRes = await request(app.getHttpServer())
      .post("/api/v1/datasources")
      .send({
        name: "错误连接",
        type: "mysql",
        host: "127.0.0.1"
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.status).toBe("error");
    expect(createRes.body.error.code).toBe("CONNECTION_CONFIG_INVALID");
    expect(createRes.body.error.details.suggestedAction).toBe("previous");
  });

  it("keeps datasource list unchanged when create-stage validation fails", async () => {
    const failedName = "工作流创建阶段失败-无副作用";
    const createRes = await request(app.getHttpServer())
      .post("/api/v1/datasources")
      .send({
        name: failedName,
        type: "postgresql",
        host: "127.0.0.1",
        port: 5432,
        username: "postgres",
        password: "secret"
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.status).toBe("error");
    expect(createRes.body.error.code).toBe("CONNECTION_CONFIG_INVALID");

    const listRes = await request(app.getHttpServer())
      .get("/api/v1/datasources")
      .send();

    expect(listRes.status).toBe(200);
    expect(listRes.body.status).toBe("success");
    expect(
      listRes.body.data.some((item: { name: string }) => item.name === failedName)
    ).toBe(false);
  });

  it("returns table preview list for table-permissions checked selection", async () => {
    jest.spyOn(datasourceService, "previewDatasourceTables").mockResolvedValue({
      mode: "create",
      items: ["orders", "users"]
    });

    const previewRes = await request(app.getHttpServer())
      .post("/api/v1/datasources/table-preview")
      .set("x-user-role", "admin")
      .set("x-user-id", "admin-preview")
      .send({
        mode: "create",
        datasource: {
          type: "mysql",
          name: "预览数据源",
          host: "127.0.0.1",
          port: 3306,
          database: "analytics",
          username: "root",
          password: "secret"
        }
      });

    expect(previewRes.status).toBe(201);
    expect(previewRes.body.status).toBe("success");
    expect(previewRes.body.data.items).toEqual(["orders", "users"]);
  });
});
