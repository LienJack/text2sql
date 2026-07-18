-- CreateTable
CREATE TABLE "knowledge_assets" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "assetKind" TEXT NOT NULL,
    "assetKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'candidate',
    "stateVersion" INTEGER NOT NULL DEFAULT 1,
    "scopeType" TEXT NOT NULL DEFAULT 'workspace',
    "scopeRef" TEXT,
    "authorityLevel" TEXT NOT NULL DEFAULT 'workspace_member',
    "createdByActorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentDigest" TEXT NOT NULL,
    "sourceRefs" TEXT NOT NULL,
    "capabilityCeiling" TEXT NOT NULL,
    "evaluation" TEXT NOT NULL,
    "rollbackRef" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "heldAt" TIMESTAMP(3),
    "tombstonedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_asset_transitions" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "decisionRef" TEXT,
    "evidenceRefs" TEXT NOT NULL,
    "reasonCodes" TEXT[],
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_asset_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_assets_workspaceId_assetKind_status_updatedAt_idx" ON "knowledge_assets"("workspaceId", "assetKind", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "knowledge_assets_workspaceId_scopeType_scopeRef_status_idx" ON "knowledge_assets"("workspaceId", "scopeType", "scopeRef", "status");

-- CreateIndex
CREATE INDEX "knowledge_assets_contentDigest_idx" ON "knowledge_assets"("contentDigest");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_assets_workspaceId_assetKind_assetKey_version_key" ON "knowledge_assets"("workspaceId", "assetKind", "assetKey", "version");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_assets_workspaceId_idempotencyKey_key" ON "knowledge_assets"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "knowledge_asset_transitions_assetId_createdAt_idx" ON "knowledge_asset_transitions"("assetId", "createdAt");

-- CreateIndex
CREATE INDEX "knowledge_asset_transitions_toStatus_createdAt_idx" ON "knowledge_asset_transitions"("toStatus", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_asset_transitions_assetId_idempotencyKey_key" ON "knowledge_asset_transitions"("assetId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "knowledge_assets" ADD CONSTRAINT "knowledge_assets_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_asset_transitions" ADD CONSTRAINT "knowledge_asset_transitions_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "knowledge_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
