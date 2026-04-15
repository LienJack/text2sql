import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { v4 as uuidv4 } from "uuid";
import { AppModule } from "../../src/app.module";
import { ChatRepository } from "../../src/modules/data/persistence/chat.repository";

describe("workspace datasource acl schema baseline", () => {
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

  it("defines workspace datasource binding and table acl models in schema and migration", () => {
    const schemaPath = resolve(__dirname, "../../prisma/schema.prisma");
    const migrationPath = resolve(
      __dirname,
      "../../prisma/migrations/202604150002_workspace_datasource_table_acl/migration.sql"
    );

    const schema = readFileSync(schemaPath, "utf-8");
    const migration = readFileSync(migrationPath, "utf-8");

    expect(schema).toContain("model WorkspaceDatasourceBinding");
    expect(schema).toContain("model WorkspaceDatasourceTableAcl");
    expect(schema).toMatch(/workspaceId\s+String\?/);
    expect(schema).toMatch(/createdByUserId\s+String\?/);
    expect(schema).toContain(
      '@@map("workspace_datasource_bindings")'
    );
    expect(schema).toContain(
      '@@map("workspace_datasource_table_acls")'
    );

    expect(migration).toContain('ALTER TABLE "sessions"');
    expect(migration).toContain('"workspaceId" TEXT');
    expect(migration).toContain('"createdByUserId" TEXT');
    expect(migration).toContain('CREATE TABLE "workspace_datasource_bindings"');
    expect(migration).toContain('CREATE TABLE "workspace_datasource_table_acls"');
    expect(migration).toContain(
      "workspace_datasource_table_acls_subject_type_check"
    );
    expect(migration).toContain(
      "workspace_datasource_table_acls_non_empty_table_name_check"
    );
  });

  it("supports workspace scoped session listing while preserving backward compatibility", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    try {
      const repository = moduleRef.get(ChatRepository);
      const workspaceA = `workspace-a-${uuidv4()}`;
      const workspaceB = `workspace-b-${uuidv4()}`;

      await repository.createSession({
        id: `session-a-${uuidv4()}`,
        datasource: "sqlite_main",
        workspaceId: workspaceA,
        createdByUserId: "user-a",
        createdAt: new Date().toISOString()
      });
      await repository.createSession({
        id: `session-b-${uuidv4()}`,
        datasource: "sqlite_main",
        workspaceId: workspaceB,
        createdByUserId: "user-b",
        createdAt: new Date().toISOString()
      });
      await repository.createSession({
        id: `session-legacy-${uuidv4()}`,
        datasource: "sqlite_main",
        createdAt: new Date().toISOString()
      });

      const all = await repository.listSessions({
        datasource: "sqlite_main"
      });
      const workspaceOnly = await repository.listSessions({
        datasource: "sqlite_main",
        workspaceId: workspaceA
      });

      expect(all.length).toBeGreaterThanOrEqual(3);
      expect(workspaceOnly.every((item) => item.workspaceId === workspaceA)).toBe(
        true
      );
      expect(
        all.some((item) => item.workspaceId === null || item.workspaceId === undefined)
      ).toBe(true);
    } finally {
      await moduleRef.close();
    }
  });
});
