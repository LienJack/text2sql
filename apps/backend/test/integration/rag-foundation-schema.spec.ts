import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const findRagFoundationMigration = () => {
  const migrationsDir = resolve(__dirname, "../../prisma/migrations");
  const target = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .find((name) => name.endsWith("_r2_rag_foundation"));

  if (!target) {
    throw new Error("Expected *_r2_rag_foundation migration directory");
  }

  return resolve(migrationsDir, target, "migration.sql");
};

describe("rag foundation schema baseline", () => {
  it("defines rag foundation models in prisma schema", () => {
    const schemaPath = resolve(__dirname, "../../prisma/schema.prisma");
    const schema = readFileSync(schemaPath, "utf-8");

    expect(schema).toContain("model RagDocument");
    expect(schema).toContain("model RagChunk");
    expect(schema).toContain("model RagIndexVersion");
    expect(schema).toContain("model RagChunkIndexEntry");
    expect(schema).toContain("model RagRunReplay");
  });

  it("creates rag foundation tables and replay primary key in migration", () => {
    const migrationSql = readFileSync(findRagFoundationMigration(), "utf-8");

    expect(migrationSql).toContain('CREATE TABLE "rag_documents"');
    expect(migrationSql).toContain('CREATE TABLE "rag_chunks"');
    expect(migrationSql).toContain('CREATE TABLE "rag_index_versions"');
    expect(migrationSql).toContain('CREATE TABLE "rag_chunk_index_entries"');
    expect(migrationSql).toContain('CREATE TABLE "rag_run_replays"');
    expect(migrationSql).toContain(
      'CONSTRAINT "rag_run_replays_pkey" PRIMARY KEY ("runId","replayKey")'
    );
  });
});
