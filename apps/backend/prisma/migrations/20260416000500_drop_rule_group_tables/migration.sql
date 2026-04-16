-- Rule-group retirement: remove legacy rule-group persistence objects.
-- This migration is intentionally idempotent and safe to re-run.

ALTER TABLE IF EXISTS "rule_group_user_bindings"
DROP CONSTRAINT IF EXISTS "rule_group_user_bindings_workspaceId_fkey";

ALTER TABLE IF EXISTS "rule_group_user_bindings"
DROP CONSTRAINT IF EXISTS "rule_group_user_bindings_ruleGroupId_fkey";

ALTER TABLE IF EXISTS "rule_group_user_bindings"
DROP CONSTRAINT IF EXISTS "rule_group_user_bindings_subject_type_check";

ALTER TABLE IF EXISTS "rule_group_user_bindings"
DROP CONSTRAINT IF EXISTS "rule_group_user_bindings_non_empty_subject_id_check";

ALTER TABLE IF EXISTS "rule_group_user_bindings"
DROP CONSTRAINT IF EXISTS "rule_group_user_bindings_role_subject_value_check";

ALTER TABLE IF EXISTS "rule_group_rules"
DROP CONSTRAINT IF EXISTS "rule_group_rules_workspaceId_fkey";

ALTER TABLE IF EXISTS "rule_group_rules"
DROP CONSTRAINT IF EXISTS "rule_group_rules_ruleGroupId_fkey";

ALTER TABLE IF EXISTS "rule_group_rules"
DROP CONSTRAINT IF EXISTS "rule_group_rules_datasourceId_fkey";

ALTER TABLE IF EXISTS "rule_group_rules"
DROP CONSTRAINT IF EXISTS "rule_group_rules_effect_check";

ALTER TABLE IF EXISTS "rule_group_rules"
DROP CONSTRAINT IF EXISTS "rule_group_rules_priority_non_negative_check";

ALTER TABLE IF EXISTS "rule_group_rules"
DROP CONSTRAINT IF EXISTS "rule_group_rules_non_empty_table_name_check";

ALTER TABLE IF EXISTS "rule_group_rules"
DROP CONSTRAINT IF EXISTS "rule_group_rules_non_empty_column_name_check";

ALTER TABLE IF EXISTS "rule_group_rules"
DROP CONSTRAINT IF EXISTS "rule_group_rules_non_empty_row_filter_expression_check";

ALTER TABLE IF EXISTS "rule_group_rules"
DROP CONSTRAINT IF EXISTS "rule_group_rules_column_or_row_filter_check";

ALTER TABLE IF EXISTS "rule_groups"
DROP CONSTRAINT IF EXISTS "rule_groups_workspaceId_fkey";

ALTER TABLE IF EXISTS "rule_groups"
DROP CONSTRAINT IF EXISTS "rule_groups_non_empty_name_check";

ALTER TABLE IF EXISTS "rule_groups"
DROP CONSTRAINT IF EXISTS "rule_groups_priority_non_negative_check";

DROP INDEX IF EXISTS "rule_group_user_bindings_workspace_group_subject_key";
DROP INDEX IF EXISTS "rule_group_user_bindings_workspace_subject_idx";
DROP INDEX IF EXISTS "rule_group_user_bindings_createdByUserId_idx";
DROP INDEX IF EXISTS "rule_group_rules_workspace_rule_group_enabled_priority_idx";
DROP INDEX IF EXISTS "rule_group_rules_workspace_datasource_table_idx";
DROP INDEX IF EXISTS "rule_group_rules_createdByUserId_idx";
DROP INDEX IF EXISTS "rule_groups_workspaceId_name_key";
DROP INDEX IF EXISTS "rule_groups_workspaceId_enabled_priority_idx";
DROP INDEX IF EXISTS "rule_groups_createdByUserId_idx";

DROP TABLE IF EXISTS "rule_group_user_bindings";
DROP TABLE IF EXISTS "rule_group_rules";
DROP TABLE IF EXISTS "rule_groups";
