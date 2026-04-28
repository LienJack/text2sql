-- CreateEnum
CREATE TYPE "PromptTemplateScene" AS ENUM ('sql', 'analysis');

-- CreateEnum
CREATE TYPE "PromptTemplateScope" AS ENUM ('global', 'workspace', 'datasource');

-- CreateEnum
CREATE TYPE "PromptTemplateStatus" AS ENUM ('draft', 'active', 'archived');

-- CreateTable
CREATE TABLE "prompt_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scene" "PromptTemplateScene" NOT NULL,
    "scope" "PromptTemplateScope" NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" "PromptTemplateStatus" NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prompt_templates_scene_status_updatedAt_idx" ON "prompt_templates"("scene", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "prompt_templates_scope_scopeKey_status_updatedAt_idx" ON "prompt_templates"("scope", "scopeKey", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "prompt_templates_deletedAt_updatedAt_idx" ON "prompt_templates"("deletedAt", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_templates_scene_scope_scopeKey_name_key" ON "prompt_templates"("scene", "scope", "scopeKey", "name");
