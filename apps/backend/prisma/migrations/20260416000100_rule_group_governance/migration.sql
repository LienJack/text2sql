-- CreateTable
CREATE TABLE "rule_groups" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rule_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_group_rules" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ruleGroupId" TEXT NOT NULL,
    "datasourceId" TEXT NOT NULL,
    "tableName" TEXT NOT NULL,
    "columnName" TEXT,
    "rowFilterExpression" TEXT,
    "effect" TEXT NOT NULL DEFAULT 'allow',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rule_group_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_group_user_bindings" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ruleGroupId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rule_group_user_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rule_groups_workspaceId_name_key"
ON "rule_groups"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "rule_groups_workspaceId_enabled_priority_idx"
ON "rule_groups"("workspaceId", "enabled", "priority");

-- CreateIndex
CREATE INDEX "rule_groups_createdByUserId_idx"
ON "rule_groups"("createdByUserId");

-- CreateIndex
CREATE INDEX "rule_group_rules_workspace_rule_group_enabled_priority_idx"
ON "rule_group_rules"("workspaceId", "ruleGroupId", "enabled", "priority");

-- CreateIndex
CREATE INDEX "rule_group_rules_workspace_datasource_table_idx"
ON "rule_group_rules"("workspaceId", "datasourceId", "tableName");

-- CreateIndex
CREATE INDEX "rule_group_rules_createdByUserId_idx"
ON "rule_group_rules"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "rule_group_user_bindings_workspace_group_subject_key"
ON "rule_group_user_bindings"("workspaceId", "ruleGroupId", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "rule_group_user_bindings_workspace_subject_idx"
ON "rule_group_user_bindings"("workspaceId", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "rule_group_user_bindings_createdByUserId_idx"
ON "rule_group_user_bindings"("createdByUserId");

-- AddForeignKey
ALTER TABLE "rule_groups"
ADD CONSTRAINT "rule_groups_workspaceId_fkey"
FOREIGN KEY ("workspaceId")
REFERENCES "workspaces"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_group_rules"
ADD CONSTRAINT "rule_group_rules_workspaceId_fkey"
FOREIGN KEY ("workspaceId")
REFERENCES "workspaces"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_group_rules"
ADD CONSTRAINT "rule_group_rules_ruleGroupId_fkey"
FOREIGN KEY ("ruleGroupId")
REFERENCES "rule_groups"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_group_rules"
ADD CONSTRAINT "rule_group_rules_datasourceId_fkey"
FOREIGN KEY ("datasourceId")
REFERENCES "datasources"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_group_user_bindings"
ADD CONSTRAINT "rule_group_user_bindings_workspaceId_fkey"
FOREIGN KEY ("workspaceId")
REFERENCES "workspaces"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_group_user_bindings"
ADD CONSTRAINT "rule_group_user_bindings_ruleGroupId_fkey"
FOREIGN KEY ("ruleGroupId")
REFERENCES "rule_groups"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddCheckConstraint
ALTER TABLE "rule_groups"
ADD CONSTRAINT "rule_groups_non_empty_name_check"
CHECK (char_length(btrim("name")) > 0);

ALTER TABLE "rule_groups"
ADD CONSTRAINT "rule_groups_priority_non_negative_check"
CHECK ("priority" >= 0);

ALTER TABLE "rule_group_rules"
ADD CONSTRAINT "rule_group_rules_effect_check"
CHECK ("effect" IN ('allow', 'deny'));

ALTER TABLE "rule_group_rules"
ADD CONSTRAINT "rule_group_rules_priority_non_negative_check"
CHECK ("priority" >= 0);

ALTER TABLE "rule_group_rules"
ADD CONSTRAINT "rule_group_rules_non_empty_table_name_check"
CHECK (char_length(btrim("tableName")) > 0);

ALTER TABLE "rule_group_rules"
ADD CONSTRAINT "rule_group_rules_non_empty_column_name_check"
CHECK ("columnName" IS NULL OR char_length(btrim("columnName")) > 0);

ALTER TABLE "rule_group_rules"
ADD CONSTRAINT "rule_group_rules_non_empty_row_filter_expression_check"
CHECK (
    "rowFilterExpression" IS NULL
    OR char_length(btrim("rowFilterExpression")) > 0
);

ALTER TABLE "rule_group_rules"
ADD CONSTRAINT "rule_group_rules_column_or_row_filter_check"
CHECK (
    "columnName" IS NOT NULL
    OR "rowFilterExpression" IS NOT NULL
);

ALTER TABLE "rule_group_user_bindings"
ADD CONSTRAINT "rule_group_user_bindings_subject_type_check"
CHECK ("subjectType" IN ('role', 'user'));

ALTER TABLE "rule_group_user_bindings"
ADD CONSTRAINT "rule_group_user_bindings_non_empty_subject_id_check"
CHECK (char_length(btrim("subjectId")) > 0);

ALTER TABLE "rule_group_user_bindings"
ADD CONSTRAINT "rule_group_user_bindings_role_subject_value_check"
CHECK ("subjectType" <> 'role' OR "subjectId" IN ('admin', 'member'));
