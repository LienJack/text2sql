-- CreateTable
CREATE TABLE "glossary_anchors" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'global',
    "scopeKey" TEXT NOT NULL,
    "datasourceId" TEXT,
    "version" INTEGER NOT NULL,
    "anchorType" TEXT NOT NULL DEFAULT 'release',
    "status" TEXT NOT NULL DEFAULT 'active',
    "summary" TEXT,
    "rollbackFromAnchorId" TEXT,
    "rollbackReason" TEXT,
    "metadata" TEXT,
    "createdByUserId" TEXT,
    "createdByRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "glossary_anchors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "glossary_terms" (
    "id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "normalizedTerm" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "synonyms" TEXT[],
    "scope" TEXT NOT NULL DEFAULT 'global',
    "scopeKey" TEXT NOT NULL,
    "datasourceId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 50,
    "conflictResolution" TEXT NOT NULL DEFAULT 'priority_then_updated_at',
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "versionAnchorId" TEXT,
    "rollbackAnchorId" TEXT,
    "metadata" TEXT,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "glossary_terms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "glossary_anchors_scope_scopeKey_status_createdAt_idx" ON "glossary_anchors"("scope", "scopeKey", "status", "createdAt");

-- CreateIndex
CREATE INDEX "glossary_anchors_datasourceId_createdAt_idx" ON "glossary_anchors"("datasourceId", "createdAt");

-- CreateIndex
CREATE INDEX "glossary_anchors_createdByRunId_idx" ON "glossary_anchors"("createdByRunId");

-- CreateIndex
CREATE INDEX "glossary_anchors_rollbackFromAnchorId_idx" ON "glossary_anchors"("rollbackFromAnchorId");

-- CreateIndex
CREATE UNIQUE INDEX "glossary_anchors_scopeKey_version_key" ON "glossary_anchors"("scopeKey", "version");

-- CreateIndex
CREATE INDEX "glossary_terms_scope_scopeKey_status_priority_idx" ON "glossary_terms"("scope", "scopeKey", "status", "priority");

-- CreateIndex
CREATE INDEX "glossary_terms_datasourceId_updatedAt_idx" ON "glossary_terms"("datasourceId", "updatedAt");

-- CreateIndex
CREATE INDEX "glossary_terms_versionAnchorId_idx" ON "glossary_terms"("versionAnchorId");

-- CreateIndex
CREATE INDEX "glossary_terms_rollbackAnchorId_idx" ON "glossary_terms"("rollbackAnchorId");

-- CreateIndex
CREATE UNIQUE INDEX "glossary_terms_version_scopeKey_normalizedTerm_key" ON "glossary_terms"("version", "scopeKey", "normalizedTerm");

-- AddForeignKey
ALTER TABLE "glossary_anchors" ADD CONSTRAINT "glossary_anchors_datasourceId_fkey" FOREIGN KEY ("datasourceId") REFERENCES "datasources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "glossary_anchors" ADD CONSTRAINT "glossary_anchors_createdByRunId_fkey" FOREIGN KEY ("createdByRunId") REFERENCES "sql_runs"("runId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "glossary_anchors" ADD CONSTRAINT "glossary_anchors_rollbackFromAnchorId_fkey" FOREIGN KEY ("rollbackFromAnchorId") REFERENCES "glossary_anchors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "glossary_terms" ADD CONSTRAINT "glossary_terms_datasourceId_fkey" FOREIGN KEY ("datasourceId") REFERENCES "datasources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "glossary_terms" ADD CONSTRAINT "glossary_terms_versionAnchorId_fkey" FOREIGN KEY ("versionAnchorId") REFERENCES "glossary_anchors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "glossary_terms" ADD CONSTRAINT "glossary_terms_rollbackAnchorId_fkey" FOREIGN KEY ("rollbackAnchorId") REFERENCES "glossary_anchors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
