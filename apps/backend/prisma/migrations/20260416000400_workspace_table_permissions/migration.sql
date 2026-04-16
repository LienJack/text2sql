-- CreateTable
CREATE TABLE "workspace_datasource_table_permission_sets" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "datasourceId" TEXT NOT NULL,
    "policyVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_datasource_table_permission_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_datasource_table_permissions" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "datasourceId" TEXT NOT NULL,
    "tableName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_datasource_table_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_datasource_table_permission_sets_workspaceId_datasourceId_key"
ON "workspace_datasource_table_permission_sets"("workspaceId", "datasourceId");

-- CreateIndex
CREATE INDEX "workspace_datasource_table_permission_sets_workspace_datasource_policy_idx"
ON "workspace_datasource_table_permission_sets"("workspaceId", "datasourceId", "policyVersion");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_datasource_table_permissions_workspace_datasource_table_key"
ON "workspace_datasource_table_permissions"("workspaceId", "datasourceId", "tableName");

-- CreateIndex
CREATE INDEX "workspace_datasource_table_permissions_workspace_datasource_createdAt_idx"
ON "workspace_datasource_table_permissions"("workspaceId", "datasourceId", "createdAt");

-- AddForeignKey
ALTER TABLE "workspace_datasource_table_permission_sets"
ADD CONSTRAINT "workspace_datasource_table_permission_sets_workspaceId_fkey"
FOREIGN KEY ("workspaceId")
REFERENCES "workspaces"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_datasource_table_permission_sets"
ADD CONSTRAINT "workspace_datasource_table_permission_sets_datasourceId_fkey"
FOREIGN KEY ("datasourceId")
REFERENCES "datasources"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_datasource_table_permissions"
ADD CONSTRAINT "workspace_datasource_table_permissions_workspaceId_fkey"
FOREIGN KEY ("workspaceId")
REFERENCES "workspaces"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_datasource_table_permissions"
ADD CONSTRAINT "workspace_datasource_table_permissions_datasourceId_fkey"
FOREIGN KEY ("datasourceId")
REFERENCES "datasources"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddCheckConstraint
ALTER TABLE "workspace_datasource_table_permission_sets"
ADD CONSTRAINT "workspace_datasource_table_permission_sets_non_negative_policy_version_check"
CHECK ("policyVersion" >= 0);

ALTER TABLE "workspace_datasource_table_permissions"
ADD CONSTRAINT "workspace_datasource_table_permissions_non_empty_table_name_check"
CHECK (char_length(btrim("tableName")) > 0);
