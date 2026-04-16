import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("prisma graph semantic baseline migration", () => {
  it("should include r0-r1 baseline models in schema", async () => {
    const schemaPath = resolve(process.cwd(), "prisma/schema.prisma");
    const schema = await readFile(schemaPath, "utf8");

    expect(schema).toContain("model GraphSnapshot");
    expect(schema).toContain("model SemanticMemory");
    expect(schema).toContain("model SemanticEdge");
    expect(schema).toContain("model AgentAuditLog");
    expect(schema).toContain("model Session");
    expect(schema).toContain("model Message");
    expect(schema).toContain("model SqlRun");
  });

  it("should create graph/semantic/audit tables without dropping legacy tables", async () => {
    const migrationsDir = resolve(process.cwd(), "prisma/migrations");
    const migrationFolders = await readdir(migrationsDir, { withFileTypes: true });
    const targetFolder = migrationFolders
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .find((name) => name.endsWith("_graph_semantic_baseline"));

    expect(targetFolder).toBeDefined();

    const migrationSqlPath = resolve(migrationsDir, targetFolder!, "migration.sql");
    const sql = await readFile(migrationSqlPath, "utf8");

    expect(sql).toContain('CREATE TABLE "graph_snapshots"');
    expect(sql).toContain('CREATE TABLE "semantic_memories"');
    expect(sql).toContain('CREATE TABLE "semantic_edges"');
    expect(sql).toContain('CREATE TABLE "agent_audit_logs"');

    expect(sql).not.toContain('DROP TABLE "sessions"');
    expect(sql).not.toContain('DROP TABLE "messages"');
    expect(sql).not.toContain('DROP TABLE "sql_runs"');
  });
});
