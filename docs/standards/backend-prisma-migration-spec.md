# 后端数据库迁移规范（Prisma）

## 1. 目的
本规范用于约束 `apps/backend/prisma` 下的 Schema 与迁移变更，确保迁移可回放、可审计、可在空库与 shadow DB 稳定执行。

## 2. 适用范围
- 适用于 `apps/backend/prisma/schema.prisma`。
- 适用于 `apps/backend/prisma.config.ts`。
- 适用于 `apps/backend/prisma/migrations/*/migration.sql`。
- 适用于所有 PostgreSQL 结构变更（表、列、索引、约束、外键）。

## 3. 强制约束（MUST）
- 迁移 SQL 必须由 Prisma CLI 生成，禁止手写或手改 `migration.sql`。
- 所有结构变更必须先修改 `schema.prisma`，再通过 CLI 生成迁移。
- Prisma ORM v7 起禁止在 `schema.prisma` 中声明 `datasource.url`，连接串统一配置在 `prisma.config.ts`。
- 迁移命令必须通过仓库脚本执行，统一使用 `apps/backend/scripts/prisma-with-database-url.cjs` 注入 `DATABASE_URL`。
- 在 CI/非交互环境只允许执行 `migrate deploy`，禁止执行 `migrate dev`。
- 合并前必须验证“从空库回放迁移链可成功”，避免 shadow DB 报错（如 `P1014`）。

## 4. 标准流程
1. 修改 `apps/backend/prisma/schema.prisma`。
2. 生成迁移（开发环境）：
   - `pnpm --filter @text2sql/backend run prisma:migrate -- --name <migration_name>`
3. 生成 Prisma Client：
   - `pnpm --filter @text2sql/backend run prisma:generate`
4. 非交互环境应用迁移：
   - `pnpm --filter @text2sql/backend exec node scripts/prisma-with-database-url.cjs migrate deploy`
5. 校验迁移状态：
   - `pnpm --filter @text2sql/backend exec node scripts/prisma-with-database-url.cjs migrate status`
6. 发布前空库回放校验（推荐统一脚本）：
   - `pnpm --filter @text2sql/backend run prisma:verify-empty-db`

## 5. 基线重建流程（仅在迁移链损坏时）
1. 使用 Prisma CLI 从空 Schema 生成基线 SQL：
   - `pnpm --filter @text2sql/backend exec node scripts/prisma-with-database-url.cjs migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`
2. 将输出保存为新的单条基线迁移目录（如 `YYYYMMDDHHmmss_prisma_cli_baseline_init`）。
3. 使用空数据库执行 `migrate deploy`，确认整条迁移链可回放。
4. 在 PR 说明中明确标注“基线重建”，并附回放验证结果。

## 6. 回退策略
- 未引入新迁移时：优先采用“代码版本回退 + `prisma generate` + `migrate status` 复核”。
- 引入新迁移时：发布前必须准备数据库快照或备份，并演练回滚路径。
- 任一环境若 `migrate status` 不一致，禁止继续发布，需先修复迁移链状态。

## 7. PR 检查清单
- [ ] `migration.sql` 由 Prisma CLI 生成，无手工编辑。
- [ ] `schema.prisma` 与迁移内容一致。
- [ ] 空库 `migrate deploy` 回放通过。
- [ ] `migrate status` 显示数据库与迁移目录一致。
- [ ] 已执行 `prisma:verify-empty-db`（或等效空库回放流程）。
- [ ] 已执行 `prisma:generate` 并通过后端相关测试。

## 8. R0-R1 图谱与审计基线要求
- 基线迁移至少包含 `graph_snapshots`、`semantic_memories`、`semantic_edges`、`agent_audit_logs` 四类表。
- 新增结构必须保持对 `sessions/messages/sql_runs` 的向后兼容，禁止通过迁移删除或重建旧核心表。
- 图谱与语义表必须具备最小查询索引（按 datasource、type、sourceRunId）以支撑后续 R2-R5 演进。
- 审计表必须包含 run/session 关联能力，且外键采用 `ON DELETE SET NULL`，避免清理历史会话时丢失审计记录。
