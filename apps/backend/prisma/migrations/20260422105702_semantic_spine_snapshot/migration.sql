-- CreateTable
CREATE TABLE "semantic_spine_snapshots" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "semanticVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "releaseSummary" TEXT NOT NULL,
    "auditSummary" TEXT NOT NULL,
    "riskTags" TEXT[],
    "snapshot" TEXT NOT NULL,
    "checksum" TEXT,
    "publishedByRunId" TEXT,
    "activatedByRunId" TEXT,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "semantic_spine_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "semantic_spine_snapshots_domain_status_semanticVersion_idx" ON "semantic_spine_snapshots"("domain", "status", "semanticVersion");

-- CreateIndex
CREATE INDEX "semantic_spine_snapshots_publishedByRunId_idx" ON "semantic_spine_snapshots"("publishedByRunId");

-- CreateIndex
CREATE INDEX "semantic_spine_snapshots_activatedByRunId_idx" ON "semantic_spine_snapshots"("activatedByRunId");

-- CreateIndex
CREATE UNIQUE INDEX "semantic_spine_snapshots_domain_semanticVersion_key" ON "semantic_spine_snapshots"("domain", "semanticVersion");

-- AddForeignKey
ALTER TABLE "semantic_spine_snapshots" ADD CONSTRAINT "semantic_spine_snapshots_publishedByRunId_fkey" FOREIGN KEY ("publishedByRunId") REFERENCES "sql_runs"("runId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "semantic_spine_snapshots" ADD CONSTRAINT "semantic_spine_snapshots_activatedByRunId_fkey" FOREIGN KEY ("activatedByRunId") REFERENCES "sql_runs"("runId") ON DELETE SET NULL ON UPDATE CASCADE;
