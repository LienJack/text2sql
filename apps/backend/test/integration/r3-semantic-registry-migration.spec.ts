import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

describe("r3 semantic registry migration", () => {
  it("contains expected tables and constraints for semantic registry", () => {
    const migrationsDir = resolve(__dirname, "../../prisma/migrations");
    const migrationFolder = readdirSync(migrationsDir).find((name) =>
      name.includes("_r3_semantic_registry")
    );

    expect(migrationFolder).toBeDefined();
    const migrationSqlPath = resolve(
      migrationsDir,
      migrationFolder ?? "",
      "migration.sql"
    );
    const sql = readFileSync(migrationSqlPath, "utf8");

    expect(sql).toContain('CREATE TABLE "semantic_registry_versions"');
    expect(sql).toContain('CREATE TABLE "semantic_registry_terms"');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "semantic_registry_versions_domain_semanticVersion_key"'
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "semantic_registry_terms_versionId_term_key"'
    );
    expect(sql).toContain(
      'ALTER TABLE "semantic_registry_terms" ADD CONSTRAINT "semantic_registry_terms_versionId_fkey"'
    );
  });
});
