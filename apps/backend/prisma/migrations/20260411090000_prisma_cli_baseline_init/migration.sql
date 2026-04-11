-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "datasource" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '新会话',
    "modelCatalogId" TEXT,
    "modelProvider" TEXT,
    "modelName" TEXT,
    "debugEnabled" BOOLEAN NOT NULL DEFAULT false,
    "syncStatus" TEXT NOT NULL DEFAULT 'healthy',
    "syncFailedCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3),
    "lastSyncFailureAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sql_runs" (
    "runId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "question" TEXT NOT NULL,
    "sql" TEXT,
    "explanation" TEXT,
    "answer" TEXT,
    "columns" TEXT,
    "rows" TEXT,
    "error" TEXT,
    "clarification" TEXT,
    "trace" TEXT NOT NULL,
    "llmRaw" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sql_runs_pkey" PRIMARY KEY ("runId")
);

-- CreateTable
CREATE TABLE "evaluation_reports" (
    "jobId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "passed" INTEGER NOT NULL,
    "passRate" DOUBLE PRECISION NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluation_reports_pkey" PRIMARY KEY ("jobId")
);

-- CreateTable
CREATE TABLE "provider_configs" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "baseUrl" TEXT,
    "apiKeyCiphertext" TEXT,
    "apiKeyMasked" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "metadata" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT NOT NULL DEFAULT 'idle',
    "lastSyncError" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_catalogs" (
    "id" TEXT NOT NULL,
    "providerConfigId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "capabilities" TEXT,
    "contextWindow" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "healthStatus" TEXT NOT NULL DEFAULT 'unknown',
    "lastHealthCheckAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "metadata" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_catalogs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sessions_deletedAt_lastMessageAt_idx" ON "sessions"("deletedAt", "lastMessageAt");

-- CreateIndex
CREATE INDEX "sessions_modelCatalogId_idx" ON "sessions"("modelCatalogId");

-- CreateIndex
CREATE INDEX "messages_sessionId_createdAt_idx" ON "messages"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "sql_runs_sessionId_createdAt_idx" ON "sql_runs"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "provider_configs_provider_deletedAt_idx" ON "provider_configs"("provider", "deletedAt");

-- CreateIndex
CREATE INDEX "model_catalogs_enabled_deletedAt_idx" ON "model_catalogs"("enabled", "deletedAt");

-- CreateIndex
CREATE INDEX "model_catalogs_providerConfigId_idx" ON "model_catalogs"("providerConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "model_catalogs_provider_model_key" ON "model_catalogs"("provider", "model");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_modelCatalogId_fkey" FOREIGN KEY ("modelCatalogId") REFERENCES "model_catalogs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sql_runs" ADD CONSTRAINT "sql_runs_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_catalogs" ADD CONSTRAINT "model_catalogs_providerConfigId_fkey" FOREIGN KEY ("providerConfigId") REFERENCES "provider_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
