-- CreateEnum
CREATE TYPE "RagTaskType" AS ENUM ('embedding', 'rerank');

-- CreateTable
CREATE TABLE "rag_task_configs" (
    "id" TEXT NOT NULL,
    "taskType" "RagTaskType" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "baseUrl" TEXT,
    "apiKeyCiphertext" TEXT,
    "apiKeyMasked" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "dimensions" INTEGER,
    "vectorVersion" TEXT,
    "timeoutMs" INTEGER,
    "note" TEXT,
    "healthStatus" TEXT NOT NULL DEFAULT 'unknown',
    "lastCheckedAt" TIMESTAMP(3),
    "lastHealthLatencyMs" INTEGER,
    "lastHealthMessage" TEXT,
    "lastError" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rag_task_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rag_task_configs_taskType_key" ON "rag_task_configs"("taskType");
