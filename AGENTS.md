# text2sql Project AGENTS Guide

本文件是仓库级执行入口，面向 AI 代理优先，同时兼顾人类开发者。

目标：
- 统一项目执行路径（先看哪里、先跑什么、门禁是什么）。
- 明确文档分工，降低跨文档来回切换成本。
- 固化高风险硬规则（尤其是 Prisma 迁移流程）。

文档分工：
- `AGENTS.md`：入口导航 + 硬边界 + 执行门禁。
- `README.md`：项目全貌、联调背景、接口与运行说明。
- `docs/standards/*.md`：专项规范细则（权威来源）。
- `docs/solutions/`：历史问题解决与流程经验库（按类别组织，frontmatter 包含 `module`/`tags`/`problem_type`），在相关模块实现或排障时可检索参考。

## 1) Monorepo 边界

- `apps/backend`：NestJS API、Agent 工作流、Prisma 数据层。
- `apps/frontend`：Next.js 前端演示应用。
- `packages/shared-types`：前后端共享类型定义。
- `infra`：本地依赖编排（如 `infra/docker-compose.yml`）。
- `data`：本地数据与运行期数据目录。

## 2) 开发主路径

1. 安装依赖：
   - `pnpm install`
2. 启动基础依赖：
   - `docker compose -f infra/docker-compose.yml up -d`
3. 初始化环境变量：
   - `cp apps/backend/.env.example apps/backend/.env`
   - `cp apps/frontend/.env.example apps/frontend/.env`
4. 启动前后端：
   - `pnpm dev`
5. 浏览器默认从网关入口联调：
   - `http://localhost:3000/data-sources`
6. 快速网关 smoke（可选但推荐）：
   - `node tests/smoke/nginx-dev-gateway-smoke.mjs`

常用后端 DB 命令：
- 生成 Prisma Client：`pnpm --filter @text2sql/backend run prisma:generate`
- 开发环境生成迁移：`pnpm --filter @text2sql/backend run prisma:migrate -- --name <migration_name>`
- 空库回放校验：`pnpm --filter @text2sql/backend run prisma:verify-empty-db`

## 3) 质量门禁

Root 级（跨项目）：
- `pnpm run format:check`
- `pnpm run test`
- `pnpm run build`

Backend 级：
- `pnpm --filter @text2sql/backend run lint`
- `pnpm --filter @text2sql/backend run build`
- `pnpm --filter @text2sql/backend run test`
- `pnpm --filter @text2sql/backend run prisma:verify-empty-db`

Frontend 级：
- `pnpm --filter @text2sql/frontend run lint`
- `pnpm --filter @text2sql/frontend run test`
- `pnpm --filter @text2sql/frontend run build`

CI 参考：
- `.github/workflows/backend-prisma-quality.yml`
- `.github/workflows/frontend-quality.yml`

## 4) 联调最小检查

- 统一入口：`http://localhost:3000` 可访问，`/data-sources -> 创建会话 -> 发送消息` 主链路可用。
- 网关 smoke：`node tests/smoke/nginx-dev-gateway-smoke.mjs` 可区分 frontend/backend/stream 三类上游失败。
- 健康检查：`GET http://localhost:3002/health` 应可用（后端内部端口检查）。
- 若本次改动涉及流式/工具调用：需关注 stream 与 tool 相关字段一致性（细节见 LLM 迁移规范）。

## 5) Standards 摘要（摘要 + 链接）

### A. 后端 Prisma 迁移规范
来源：`docs/standards/backend-prisma-migration-spec.md`

适用范围：
- `apps/backend/prisma/schema.prisma`
- `apps/backend/prisma.config.ts`
- `apps/backend/prisma/migrations/*/migration.sql`

关键 MUST：
- 迁移 SQL 必须由 Prisma CLI 生成。
- 结构变更必须先改 `schema.prisma`，再生成迁移。
- 表结构变更时 `prisma:generate` 必跑。

必跑门禁：
- `pnpm --filter @text2sql/backend run prisma:generate`
- `pnpm --filter @text2sql/backend run prisma:verify-empty-db`

### B. 前端 React + shadcn 规范
来源：`docs/standards/frontend-react-shadcn-spec.md`

适用范围：
- `apps/frontend/src/app`
- `apps/frontend/src/components`

关键 MUST：
- React 函数组件 + shadcn-ui 体系。
- Tailwind CSS v4，不回退 v3 模式。
- 保持核心演示链路可用（创建会话/发送消息/SQL 预览）。
- 涉及 RAG 可见化改造时，必须覆盖 runId（sync/stream）一致性、`selected_context` 四态矩阵、terminal 不回退 loading、375px 与键盘可达性（`Enter/Space` + `aria-expanded`）验收。

必跑门禁：
- `pnpm --filter @text2sql/frontend run lint`
- `pnpm --filter @text2sql/frontend run test`
- `pnpm --filter @text2sql/frontend run build`

### C. LLM Stream & Tool Calling 迁移规范
来源：`docs/standards/llm-stream-tool-migration-spec.md`

适用范围：
- 后端 LLM gateway、同步消息接口、SSE 流式接口、工具调用链路。

关键 MUST：
- 同步接口保持 `AgentRunResponse` 合同。
- 流式事件字段必须完整（`type/runId/sessionId/at/data`）。
- 工具调用走 allowlist，失败可追踪。
- 若接入提示词模板运行时，必须保证 `run.trace.promptTemplate` 与 `delivery.evidence.promptTemplate` 字段语义一致，且旧 run 缺字段可兼容读取。

必跑检查：
- `GET http://localhost:3002/health` 中 stream/tool-calling 相关字段应符合预期。

### D. Governance 术语硬切规范
来源：`docs/standards/governance-terminology-spec.md`

适用范围：
- `apps/backend/src/modules/governance/**`
- `apps/frontend/src/lib/admin-api-client.ts`
- `docs/standards/**`
- `README.md`

关键 MUST：
- 治理主链路仅使用 `workspace datasource binding`、`table-permissions`、`policyVersion`。
- 不得在治理主链路继续接受 legacy 路由/字段（`table-acl`、`acl`、`rule-group`）。
- 历史术语只允许出现在明确迁移上下文（带迁移注记），不得作为 active narrative。

必跑检查：
- `pnpm run governance:terminology:check`

### E. 后端业务能力拓扑规范
来源：`docs/standards/backend-business-capability-topology-spec.md`

适用范围：
- `apps/backend/src/modules/**`
- `apps/backend/src/app.module.ts`
- `scripts/check-backend-capability-boundaries.ts`

关键 MUST：
- 后端一级能力域固定为 `conversation/governance/knowledge/platform`。
- 依赖方向固定：`conversation -> governance|knowledge|platform`，`governance|knowledge -> platform`。
- `platform` 禁止反向依赖业务域；跨域调用仅允许稳定入口（facade/public entry）。
- 禁止新增“宽导出中枢”形态依赖。
- 业务域及其兼容根模块（`chat/agent/memory/glossary/rag`）禁止直接 import `modules/data/**` 实现路径。
- 业务域及其兼容根模块禁止依赖 `platform/data/data.module.ts`（`PlatformDataModule` 聚合入口）。

必跑检查：
- `pnpm run backend:capability-boundary:check`（落地后）

说明：
- 以上仅为执行摘要，细节规则以 standards 原文为准。

## 6) Prisma 结构变更铁律（强制）

涉及表/列/索引/约束/外键变更时，必须遵循：

1. 修改 `apps/backend/prisma/schema.prisma`
2. 生成迁移：
   - `pnpm --filter @text2sql/backend run prisma:migrate -- --name <migration_name>`
3. 生成 Client（必跑）：
   - `pnpm --filter @text2sql/backend run prisma:generate`

严格禁止：
- 手写或手改 `apps/backend/prisma/migrations/*/migration.sql`
- 跳过 `prisma:generate` 直接提交结构改动

## 7) 维护约定（防漂移）

以下任一发生变化，必须同步更新本文件：
- `README.md` 的关键流程/联调说明变化
- `docs/standards/*.md` 的 MUST 或门禁变化
- `package.json` / `apps/*/package.json` 脚本变化
- `.github/workflows/*quality*.yml` 门禁步骤变化

维护原则：
- 只写可在仓库中追溯验证的命令与路径。
- 保持“入口文档”定位，不扩展为故障百科。

## 8) 前端设计任务 Skill 自动流程

当任务目标是“设计前端页面”或“优化页面视觉与交互”时，默认自动启用 `frontend-design` skill（无需额外确认）。

触发范围（示例）：
- 新页面视觉设计（落地页、后台页、仪表盘、设置页等）
- 现有页面改版（布局、层级、配色、排版、动效）
- 组件交互体验优化（状态、可用性、视觉一致性）

执行顺序：
1. 先按 `frontend-design` 完成上下文检测、视觉方案与交互方案。
2. 再在本仓库既有前端规范下实现（遵循 `docs/standards/frontend-react-shadcn-spec.md`）。
3. 完成后执行一次视觉验收（优先项目已有浏览器工具），并补跑前端质量门禁命令。

例外：
- 若用户明确指定其他设计方向或流程，以用户指令为最高优先级。

## 9) Text2SQL + RAG 全流程理解文档入口

当需求涉及“理解 Text2SQL 全链路（含 RAG）”时，优先阅读以下 canonical 文档，再进入实现/排障：

- `docs/rag-understanding/text2sql-rag-end-to-end-understanding.md`（主白皮书）
- `docs/rag-understanding/text2sql-rag-runid-replay-handbook.md`（runId 回放）
- `docs/rag-understanding/text2sql-rag-local-learning-lab.md`（本地实验）

维护护栏：

- 文档合同检查：`node scripts/check-docs-rag-understanding.mjs`
- smoke：`node tests/smoke/docs-rag-understanding-contract-smoke.mjs`

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
