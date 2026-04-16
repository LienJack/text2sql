-- Rule-group single-track cutover: remove legacy table ACL persistence.
-- Drop legacy ACL constraints/index/table in a safe order to avoid half-cutover state.
ALTER TABLE IF EXISTS "workspace_datasource_table_acls"
DROP CONSTRAINT IF EXISTS "workspace_datasource_table_acls_workspaceId_fkey";

ALTER TABLE IF EXISTS "workspace_datasource_table_acls"
DROP CONSTRAINT IF EXISTS "workspace_datasource_table_acls_datasourceId_fkey";

ALTER TABLE IF EXISTS "workspace_datasource_table_acls"
DROP CONSTRAINT IF EXISTS "workspace_datasource_table_acls_subject_type_check";

ALTER TABLE IF EXISTS "workspace_datasource_table_acls"
DROP CONSTRAINT IF EXISTS "workspace_datasource_table_acls_effect_check";

ALTER TABLE IF EXISTS "workspace_datasource_table_acls"
DROP CONSTRAINT IF EXISTS "workspace_datasource_table_acls_non_empty_table_name_check";

ALTER TABLE IF EXISTS "workspace_datasource_table_acls"
DROP CONSTRAINT IF EXISTS "workspace_datasource_table_acls_non_empty_subject_id_check";

ALTER TABLE IF EXISTS "workspace_datasource_table_acls"
DROP CONSTRAINT IF EXISTS "workspace_datasource_table_acls_role_subject_value_check";

DROP INDEX IF EXISTS "workspace_datasource_table_acls_workspace_datasource_table_subject_key";
DROP INDEX IF EXISTS "workspace_datasource_table_acls_workspace_datasource_effect_idx";
DROP INDEX IF EXISTS "workspace_datasource_table_acls_workspace_datasource_subject_idx";
DROP INDEX IF EXISTS "workspace_datasource_table_acls_createdByUserId_idx";

DROP TABLE IF EXISTS "workspace_datasource_table_acls";
