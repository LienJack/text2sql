import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { v4 as uuidv4 } from "uuid";
import { AppModule } from "../../src/app.module";
import { ChatRepository } from "../../src/modules/data/persistence/chat.repository";
import { DatasourceRepository } from "../../src/modules/data/persistence/datasource.repository";

describe("datasource repository", () => {
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

  it("creates and queries multi-type datasource metadata", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const datasourceRepository = moduleRef.get(DatasourceRepository);

    await datasourceRepository.ensureBaselineSqliteDatasource(process.env.SQLITE_PATH ?? "");
    await datasourceRepository.upsertDatasource({
      id: "ds-mysql-test",
      name: "MySQL 测试源",
      type: "mysql",
      readonly: true,
      status: "available",
      shared: true,
      config: {
        host: "localhost",
        port: 3306
      }
    });
    await datasourceRepository.upsertDatasource({
      id: "ds-pg-test",
      name: "PostgreSQL 测试源",
      type: "postgresql",
      readonly: true,
      status: "available",
      shared: true
    });
    await datasourceRepository.upsertDatasource({
      id: "ds-csv-test",
      name: "CSV 文件源",
      type: "csv",
      readonly: true,
      status: "available",
      shared: true,
      fileMeta: {
        fileName: "orders.csv"
      }
    });

    const all = await datasourceRepository.listDatasources();
    const ids = all.map((item) => item.id);

    expect(ids).toContain("sqlite_main");
    expect(ids).toContain("ds-mysql-test");
    expect(ids).toContain("ds-pg-test");
    expect(ids).toContain("ds-csv-test");
  });

  it("supports soft delete visibility controls", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const datasourceRepository = moduleRef.get(DatasourceRepository);

    await datasourceRepository.upsertDatasource({
      id: "ds-soft-delete",
      name: "待删除数据源",
      type: "postgresql",
      status: "available",
      readonly: true,
      shared: true
    });

    await datasourceRepository.softDeleteDatasource("ds-soft-delete");

    const withoutDeleted = await datasourceRepository.listDatasources();
    const withDeleted = await datasourceRepository.listDatasources({
      includeDeleted: true
    });

    expect(withoutDeleted.some((item) => item.id === "ds-soft-delete")).toBe(false);
    expect(withDeleted.some((item) => item.id === "ds-soft-delete")).toBe(true);
  });

  it("keeps session binding readable with datasource entity", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const datasourceRepository = moduleRef.get(DatasourceRepository);
    const chatRepository = moduleRef.get(ChatRepository);

    await datasourceRepository.upsertDatasource({
      id: "ds-session-binding",
      name: "会话绑定测试源",
      type: "sqlite",
      status: "available",
      readonly: true,
      shared: true
    });

    const sessionId = `session-${uuidv4()}`;
    await chatRepository.createSession({
      id: sessionId,
      datasource: "ds-session-binding",
      createdAt: new Date().toISOString()
    });

    const session = await chatRepository.getSessionById(sessionId);
    const datasource = await datasourceRepository.getDatasourceById("ds-session-binding");

    expect(session?.datasource).toBe("ds-session-binding");
    expect(datasource?.id).toBe("ds-session-binding");
  });
});
