-- AlterTable
ALTER TABLE "sessions"
ADD COLUMN "workspaceId" TEXT,
ADD COLUMN "createdByUserId" TEXT;

-- CreateTable
CREATE TABLE "workspace_datasource_bindings" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "datasourceId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_datasource_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_datasource_table_acls" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "datasourceId" TEXT NOT NULL,
    "tableName" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "effect" TEXT NOT NULL DEFAULT 'allow',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_datasource_table_acls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sessions_workspaceId_deletedAt_lastMessageAt_idx"
ON "sessions"("workspaceId", "deletedAt", "lastMessageAt");

-- CreateIndex
CREATE INDEX "sessions_createdByUserId_idx"
ON "sessions"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_datasource_bindings_workspaceId_datasourceId_key"
ON "workspace_datasource_bindings"("workspaceId", "datasourceId");

-- CreateIndex
CREATE INDEX "workspace_datasource_bindings_workspaceId_createdAt_idx"
ON "workspace_datasource_bindings"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "workspace_datasource_bindings_datasourceId_createdAt_idx"
ON "workspace_datasource_bindings"("datasourceId", "createdAt");

-- CreateIndex
CREATE INDEX "workspace_datasource_bindings_createdByUserId_idx"
ON "workspace_datasource_bindings"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_datasource_table_acls_workspace_datasource_table_subject_key"
ON "workspace_datasource_table_acls"(
    "workspaceId",
    "datasourceId",
    "tableName",
    "subjectType",
    "subjectId"
);

-- CreateIndex
CREATE INDEX "workspace_datasource_table_acls_workspace_datasource_effect_idx"
ON "workspace_datasource_table_acls"("workspaceId", "datasourceId", "effect");

-- CreateIndex
CREATE INDEX "workspace_datasource_table_acls_workspace_datasource_subject_idx"
ON "workspace_datasource_table_acls"(
    "workspaceId",
    "datasourceId",
    "subjectType",
    "subjectId"
);

-- CreateIndex
CREATE INDEX "workspace_datasource_table_acls_createdByUserId_idx"
ON "workspace_datasource_table_acls"("createdByUserId");

-- AddForeignKey
ALTER TABLE "sessions"
ADD CONSTRAINT "sessions_workspaceId_fkey"
FOREIGN KEY ("workspaceId")
REFERENCES "workspaces"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_datasource_bindings"
ADD CONSTRAINT "workspace_datasource_bindings_workspaceId_fkey"
FOREIGN KEY ("workspaceId")
REFERENCES "workspaces"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_datasource_bindings"
ADD CONSTRAINT "workspace_datasource_bindings_datasourceId_fkey"
FOREIGN KEY ("datasourceId")
REFERENCES "datasources"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_datasource_table_acls"
ADD CONSTRAINT "workspace_datasource_table_acls_workspaceId_fkey"
FOREIGN KEY ("workspaceId")
REFERENCES "workspaces"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_datasource_table_acls"
ADD CONSTRAINT "workspace_datasource_table_acls_datasourceId_fkey"
FOREIGN KEY ("datasourceId")
REFERENCES "datasources"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddCheckConstraint
ALTER TABLE "workspace_datasource_table_acls"
ADD CONSTRAINT "workspace_datasource_table_acls_subject_type_check"
CHECK ("subjectType" IN ('role', 'user'));

ALTER TABLE "workspace_datasource_table_acls"
ADD CONSTRAINT "workspace_datasource_table_acls_effect_check"
CHECK ("effect" IN ('allow', 'deny'));

ALTER TABLE "workspace_datasource_table_acls"
ADD CONSTRAINT "workspace_datasource_table_acls_non_empty_table_name_check"
CHECK (char_length(btrim("tableName")) > 0);

ALTER TABLE "workspace_datasource_table_acls"
ADD CONSTRAINT "workspace_datasource_table_acls_non_empty_subject_id_check"
CHECK (char_length(btrim("subjectId")) > 0);

ALTER TABLE "workspace_datasource_table_acls"
ADD CONSTRAINT "workspace_datasource_table_acls_role_subject_value_check"
CHECK ("subjectType" <> 'role' OR "subjectId" IN ('admin', 'member'));
