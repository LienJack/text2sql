-- AlterTable
ALTER TABLE "datasources" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "platform_users" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "workspace_datasource_bindings" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "workspace_datasource_table_permission_sets" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "workspace_datasource_table_permissions" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "workspace_members" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "workspaces" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- RenameIndex
ALTER INDEX "workspace_datasource_table_permission_sets_workspaceId_datasour" RENAME TO "workspace_datasource_table_permission_sets_workspaceId_data_key";

-- RenameIndex
ALTER INDEX "workspace_datasource_table_permission_sets_workspace_datasource" RENAME TO "workspace_datasource_table_permission_sets_workspaceId_data_idx";

-- RenameIndex
ALTER INDEX "workspace_datasource_table_permissions_workspace_datasource_cre" RENAME TO "workspace_datasource_table_permissions_workspaceId_datasour_idx";

-- RenameIndex
ALTER INDEX "workspace_datasource_table_permissions_workspace_datasource_tab" RENAME TO "workspace_datasource_table_permissions_workspaceId_datasour_key";
