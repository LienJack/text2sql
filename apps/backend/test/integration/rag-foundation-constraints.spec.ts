import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const readRagFoundationMigrationSql = () => {
  const migrationsDir = resolve(__dirname, "../../prisma/migrations");
  const target = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .find((name) => name.endsWith("_r2_rag_foundation"));

  if (!target) {
    throw new Error("Expected *_r2_rag_foundation migration directory");
  }

  const migrationPath = resolve(migrationsDir, target, "migration.sql");
  return readFileSync(migrationPath, "utf-8");
};

describe("rag foundation constraints", () => {
  it("enforces idempotency and chunk/index uniqueness constraints", () => {
    const sql = readRagFoundationMigrationSql();

    expect(sql).toContain(
      'CREATE UNIQUE INDEX "rag_documents_datasourceId_sourceVersion_contentChecksum_key"'
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "rag_chunks_documentId_chunkProfile_chunkOrder_key"'
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "rag_chunk_index_entries_indexVersionId_chunkId_key"'
    );
  });

  it("declares expected foreign keys for run/document/chunk/index lineage", () => {
    const sql = readRagFoundationMigrationSql();

    expect(sql).toContain(
      'ADD CONSTRAINT "rag_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "rag_documents"("id")'
    );
    expect(sql).toContain(
      'ADD CONSTRAINT "rag_chunk_index_entries_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "rag_chunks"("id")'
    );
    expect(sql).toContain(
      'ADD CONSTRAINT "rag_chunk_index_entries_indexVersionId_fkey" FOREIGN KEY ("indexVersionId") REFERENCES "rag_index_versions"("id")'
    );
    expect(sql).toContain(
      'ADD CONSTRAINT "rag_run_replays_runId_fkey" FOREIGN KEY ("runId") REFERENCES "sql_runs"("runId")'
    );
  });

  it("indexes datasource/domain/tableNames/columnNames retrieval metadata fields", () => {
    const sql = readRagFoundationMigrationSql();

    expect(sql).toContain(
      'CREATE INDEX "rag_documents_datasourceId_domain_idx" ON "rag_documents"("datasourceId", "domain")'
    );
    expect(sql).toContain(
      'CREATE INDEX "rag_documents_tableNames_idx" ON "rag_documents"("tableNames")'
    );
    expect(sql).toContain(
      'CREATE INDEX "rag_documents_columnNames_idx" ON "rag_documents"("columnNames")'
    );
    expect(sql).toContain(
      'CREATE INDEX "rag_chunks_datasourceId_domain_chunkProfile_idx" ON "rag_chunks"("datasourceId", "domain", "chunkProfile")'
    );
    expect(sql).toContain(
      'CREATE INDEX "rag_chunks_tableNames_idx" ON "rag_chunks"("tableNames")'
    );
    expect(sql).toContain(
      'CREATE INDEX "rag_chunks_columnNames_idx" ON "rag_chunks"("columnNames")'
    );
  });
});
