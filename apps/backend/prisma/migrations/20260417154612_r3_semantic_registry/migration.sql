-- AlterTable
ALTER TABLE "graph_snapshots" ALTER COLUMN "status" SET DEFAULT 'active';

-- CreateTable
CREATE TABLE "semantic_registry_versions" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "semanticVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "releaseSummary" TEXT NOT NULL,
    "auditSummary" TEXT NOT NULL,
    "publishedByRunId" TEXT,
    "activatedByRunId" TEXT,
    "activatedAt" TIMESTAMP(3),
    "riskTags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "semantic_registry_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "semantic_registry_terms" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "canonicalKey" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "binding" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "semantic_registry_terms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "semantic_registry_versions_domain_status_semanticVersion_idx" ON "semantic_registry_versions"("domain", "status", "semanticVersion");

-- CreateIndex
CREATE INDEX "semantic_registry_versions_publishedByRunId_idx" ON "semantic_registry_versions"("publishedByRunId");

-- CreateIndex
CREATE INDEX "semantic_registry_versions_activatedByRunId_idx" ON "semantic_registry_versions"("activatedByRunId");

-- CreateIndex
CREATE UNIQUE INDEX "semantic_registry_versions_domain_semanticVersion_key" ON "semantic_registry_versions"("domain", "semanticVersion");

-- CreateIndex
CREATE INDEX "semantic_registry_terms_domain_term_versionId_idx" ON "semantic_registry_terms"("domain", "term", "versionId");

-- CreateIndex
CREATE INDEX "semantic_registry_terms_canonicalKey_idx" ON "semantic_registry_terms"("canonicalKey");

-- CreateIndex
CREATE UNIQUE INDEX "semantic_registry_terms_versionId_term_key" ON "semantic_registry_terms"("versionId", "term");

-- AddForeignKey
ALTER TABLE "semantic_registry_versions" ADD CONSTRAINT "semantic_registry_versions_publishedByRunId_fkey" FOREIGN KEY ("publishedByRunId") REFERENCES "sql_runs"("runId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "semantic_registry_versions" ADD CONSTRAINT "semantic_registry_versions_activatedByRunId_fkey" FOREIGN KEY ("activatedByRunId") REFERENCES "sql_runs"("runId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "semantic_registry_terms" ADD CONSTRAINT "semantic_registry_terms_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "semantic_registry_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
