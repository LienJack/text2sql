-- CreateTable
CREATE TABLE "research_connector_configs" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "baseUrl" TEXT,
    "hasApiKey" BOOLEAN NOT NULL DEFAULT false,
    "apiKeyMasked" TEXT,
    "configDigest" TEXT NOT NULL,
    "metadata" TEXT NOT NULL,
    "createdByActorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_connector_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_source_policies" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectorConfigId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "allowedDomains" TEXT[],
    "deniedDomains" TEXT[],
    "allowedQueryParams" TEXT[],
    "allowedMimeTypes" TEXT[],
    "maxRedirects" INTEGER NOT NULL DEFAULT 2,
    "maxContentBytes" INTEGER NOT NULL,
    "retentionDays" INTEGER NOT NULL,
    "minIndependentSources" INTEGER NOT NULL DEFAULT 2,
    "requireCounterEvidence" BOOLEAN NOT NULL DEFAULT true,
    "policyDigest" TEXT NOT NULL,
    "createdByActorId" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_source_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_source_snapshots" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "connectorConfigId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRequestId" TEXT,
    "canonicalUrl" TEXT NOT NULL,
    "locator" TEXT NOT NULL,
    "title" TEXT,
    "mimeType" TEXT NOT NULL,
    "contentDigest" TEXT NOT NULL,
    "normalizedContent" TEXT NOT NULL,
    "contentSizeBytes" INTEGER NOT NULL,
    "completeness" TEXT NOT NULL DEFAULT 'complete',
    "injectionIndicators" TEXT[],
    "providerMetadata" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retentionExpiresAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "research_source_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "research_connector_configs_workspaceId_provider_status_vers_idx" ON "research_connector_configs"("workspaceId", "provider", "status", "version");

-- CreateIndex
CREATE UNIQUE INDEX "research_connector_configs_workspaceId_provider_version_key" ON "research_connector_configs"("workspaceId", "provider", "version");

-- CreateIndex
CREATE INDEX "research_source_policies_workspaceId_status_effectiveAt_ver_idx" ON "research_source_policies"("workspaceId", "status", "effectiveAt", "version");

-- CreateIndex
CREATE INDEX "research_source_policies_connectorConfigId_idx" ON "research_source_policies"("connectorConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "research_source_policies_workspaceId_version_key" ON "research_source_policies"("workspaceId", "version");

-- CreateIndex
CREATE INDEX "research_source_snapshots_workspaceId_retrievedAt_idx" ON "research_source_snapshots"("workspaceId", "retrievedAt");

-- CreateIndex
CREATE INDEX "research_source_snapshots_taskId_revisionId_completeness_idx" ON "research_source_snapshots"("taskId", "revisionId", "completeness");

-- CreateIndex
CREATE INDEX "research_source_snapshots_retentionExpiresAt_deletedAt_idx" ON "research_source_snapshots"("retentionExpiresAt", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "research_source_snapshots_taskId_policyId_canonicalUrl_cont_key" ON "research_source_snapshots"("taskId", "policyId", "canonicalUrl", "contentDigest");

-- AddForeignKey
ALTER TABLE "research_connector_configs" ADD CONSTRAINT "research_connector_configs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_source_policies" ADD CONSTRAINT "research_source_policies_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_source_policies" ADD CONSTRAINT "research_source_policies_connectorConfigId_fkey" FOREIGN KEY ("connectorConfigId") REFERENCES "research_connector_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_source_snapshots" ADD CONSTRAINT "research_source_snapshots_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_source_snapshots" ADD CONSTRAINT "research_source_snapshots_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "analysis_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_source_snapshots" ADD CONSTRAINT "research_source_snapshots_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "analysis_task_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_source_snapshots" ADD CONSTRAINT "research_source_snapshots_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "research_source_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_source_snapshots" ADD CONSTRAINT "research_source_snapshots_connectorConfigId_fkey" FOREIGN KEY ("connectorConfigId") REFERENCES "research_connector_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
