import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("rule group retirement schema guard", () => {
  it("keeps rule-group objects retired and validates drop migration idempotency intent", () => {
    const schemaPath = resolve(__dirname, "../../prisma/schema.prisma");
    const cutoverMigrationPath = resolve(
      __dirname,
      "../../prisma/migrations/20260416000200_rule_group_cutover_drop_acl/migration.sql"
    );
    const dropRuleGroupMigrationPath = resolve(
      __dirname,
      "../../prisma/migrations/20260416000500_drop_rule_group_tables/migration.sql"
    );

    const schema = readFileSync(schemaPath, "utf-8");
    const cutoverMigration = readFileSync(cutoverMigrationPath, "utf-8");
    const dropRuleGroupMigration = readFileSync(dropRuleGroupMigrationPath, "utf-8");

    expect(schema).not.toContain("model RuleGroup");
    expect(schema).not.toContain("model RuleGroupRule");
    expect(schema).not.toContain("model RuleGroupUserBinding");
    expect(schema).not.toContain('@@map("rule_groups")');
    expect(schema).not.toContain('@@map("rule_group_rules")');
    expect(schema).not.toContain('@@map("rule_group_user_bindings")');

    expect(cutoverMigration).toContain('DROP TABLE IF EXISTS "workspace_datasource_table_acls";');
    expect(dropRuleGroupMigration).toContain('DROP TABLE IF EXISTS "rule_group_user_bindings";');
    expect(dropRuleGroupMigration).toContain('DROP TABLE IF EXISTS "rule_group_rules";');
    expect(dropRuleGroupMigration).toContain('DROP TABLE IF EXISTS "rule_groups";');
  });
});
