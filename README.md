# text2sql

Text2SQL 学习演示版（阶段0-3路线）的单仓项目。

## 技术栈
- 后端：NestJS + TypeScript + Prisma
- Agent：LangGraph `StateGraph` 运行时编排（澄清 -> 生成SQL -> 安全检查 -> 执行 -> 格式化）
- 前端：Next.js + React + Tailwind CSS v4 + shadcn-ui
- 查询数据：SQLite / MySQL / PostgreSQL / CSV / Excel（会话绑定数据源路由）
- 功能数据：Redis 缓冲 + PostgreSQL 持久化

## 项目规范
- 前端重写规范：`docs/standards/frontend-react-shadcn-spec.md`
- 后端迁移规范：`docs/standards/backend-prisma-migration-spec.md`
- LLM 流式与 Tool Calling 迁移规范：`docs/standards/llm-stream-tool-migration-spec.md`
- 前端重写需求：`docs/brainstorms/2026-04-10-frontend-react-shadcn-rewrite-requirements.md`

### 数据库结构改动铁律（必须遵守）
- 禁止手写或手改 `apps/backend/prisma/migrations/*/migration.sql`。
- 先改 `apps/backend/prisma/schema.prisma`，再执行 `pnpm --filter @text2sql/backend run prisma:migrate -- --name <migration_name>` 生成迁移。
- 每次结构变更必须执行 `pnpm --filter @text2sql/backend run prisma:generate`。

## 目录结构
```text
apps/backend             NestJS API + Agent 工作流
apps/frontend            Next.js 演示页面
packages/shared-types    前后端共享类型
infra/docker-compose.yml Redis/PostgreSQL 本地依赖
vibe/plain               需求、计划、评测与运维文档
```

## 本地启动
1. 安装依赖
```bash
pnpm install
```

2. 启动基础依赖（Redis/PostgreSQL）
```bash
docker compose -f infra/docker-compose.yml up -d
```

3. 配置环境变量
```bash
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env
```

关键配置（`apps/backend/.env`）：
- `CORS_ALLOWED_ORIGINS=http://localhost:3001`
- `POSTGRES_HOST=localhost`
- `POSTGRES_PORT=5432`
- `POSTGRES_DB=text2sql`
- `POSTGRES_USER=admin`
- `POSTGRES_PASSWORD=admin`
- `POSTGRES_SCHEMA=public`
- `DATABASE_URL=<optional>`（若配置则优先；未配置时后端会自动使用 `POSTGRES_*` 组装）
- `DATASOURCE_UPLOAD_DIR=<upload-dir>`（默认 `data/uploads/datasources`）
- `DATASOURCE_UPLOAD_MAX_BYTES=10485760`（上传上限，默认 10MB）
- `DATASOURCE_CONNECT_TIMEOUT_MS=5000`
- `DATASOURCE_QUERY_TIMEOUT_MS=10000`
- `DATASOURCE_SECRET_KEY=<secret-key>`（生产环境务必配置自定义值）
- `LLM_PROVIDER=volcengine`（或 siliconflow/minimax）
- `LLM_BASE_URL=<openai-compatible-base-url>`（支持 `https://xxx`、`https://xxx/v1` 或完整 `/chat/completions` 路径）
- `LLM_API_KEY=<api-key>`
- `LLM_MODEL=<model-name>`
- `LLM_MOCK_MODE=false`（联调真实模型时保持 false）
- `LANGSMITH_TRACING=true|false`（是否启用 LangSmith 追踪）
- `LANGSMITH_API_KEY=<langsmith-api-key>`（启用追踪时必填）
- `LANGSMITH_PROJECT=text2sql`（可选，默认 `text2sql`）
- `LANGSMITH_ENDPOINT=https://api.smith.langchain.com`（可选）
- 会话 Redis 缓冲 TTL 固定为 12 小时（43200 秒），用于持久化补偿窗口。

4. 生成 Prisma Client（可选但推荐）
```bash
pnpm --filter @text2sql/backend prisma:generate
```

5. 校验空库迁移回放（发布前强烈建议）
```bash
DATABASE_URL=postgresql://admin:admin@localhost:5432/text2sql_ci \
pnpm --filter @text2sql/backend run prisma:verify-empty-db
```

6. 启动前后端
```bash
pnpm dev
```

默认地址：
- 后端：`http://localhost:3000`
- 前端：`http://localhost:3001/data-sources`

## 多数据源问数主线
- 入口强制“先选数据源，再进入聊天”：`/data-sources -> 创建会话 -> /chat?datasource=...&sessionId=...`
- `POST /api/v1/sessions` 必须显式传入 `datasource`，缺失时返回 4xx 业务错误。
- 聊天页会话列表按 `datasource` 过滤，只展示当前数据源历史，避免跨源串扰。
- 每次发送都严格使用会话绑定数据源执行；数据源失效时会话历史可读、发送阻断并返回 `DATASOURCE_UNAVAILABLE`。
- CSV / Excel 上传会注册为团队共享可复用数据源，可在后续会话中重复选择。
- 查询边界默认值：连接超时 `5000ms`、查询超时 `10000ms`、默认 `LIMIT 50`、最大 `LIMIT 200`、上传上限 `10MB`。

## 工作空间治理与表清单授权（主叙事）
- 用户侧请求可通过 `x-workspace-id`（或单空间成员自动推断）确定工作空间语境；缺失或非法语境会触发权限错误。
- `GET /api/v1/datasources` 与 `POST /api/v1/sessions` 已接入工作空间可见性校验，只返回/允许当前空间已绑定的数据源。
- 治理主模型为“工作空间 -> 数据源 -> 表勾选（replace）”；不再暴露规则组概念。
- SQL 执行链路按工作空间表授权执行默认拒绝与 fail-closed，未授权或不可安全解析的读表请求会被拒绝。
- 治理写操作与拒绝决策会写入审计事件（`workspace.datasource.*`），支持追溯变更与拒绝原因。
- 截至 2026-04-16，`/data-sources` 向导已覆盖连接失败恢复（`retry/previous`）与提交中按钮锁定，且在 URL 带 `workspaceId` 时会透传到创建会话请求。
- 遗留 `table-acl` 与 `rule-group` 路径已下线，治理能力统一以 `table-permissions` 接口为准。

## Chat 前端交互结构
- 聊天主区已迁移到 `assistant-ui` primitives（Thread / Message / Composer）。
- 页面采用“聊天主区优先”布局，SQL 详情改为 assistant 消息内展开，不再固定右侧详情栏。
- 会话侧栏、会话级模型切换、调试开关能力保持不变，仍按会话粒度生效。
- 移动端保留“会话”与“结果详情”入口，其中“结果详情”用于快速展开最新 SQL 详情块。

## 联调检查清单（真实 LLM）
- 后端健康检查 `GET /health` 中 `llm.configured` 与 `llm.baseUrlConfigured` 为 `true`。
- `GET /health` 中 `dependencies.llm.streamingEnabled` 与 `dependencies.llm.toolCallingEnabled` 为 `true`。
- 如开启 LangSmith，`GET /health` 中 `dependencies.langsmith.ready` 为 `true`。
- `GET /health` 中 `dependencies.sessions.sync` 可查看会话同步状态统计（healthy/pending/degraded）。
- 前端能成功创建会话并发送消息，无跨域报错。
- 前端从 `/data-sources` 选择任一可用数据源后，可自动创建绑定会话并跳转 `/chat`。
- `GET /api/v1/sessions?datasource=<id>` 返回的会话均属于指定数据源。
- `POST /api/v1/sessions/:sessionId/messages` 响应中包含 `run.sql` 与 `run.explanation`。
- 当 LLM 配置缺失或不可用时，接口返回可读错误（不会回退到规则 SQL）。

## LangSmith 覆盖率校验（可选）
```bash
ts-node apps/backend/scripts/langsmith-coverage-check.ts \
  --total 120 \
  --threshold 0.95 \
  --min-sample-size 20 \
  --lookback-hours 24
```

- `--total`：验收窗口内“可执行请求”总数（分母）。
- 返回 `pass=true` 表示达到覆盖率门槛。

## 核心 API
- `POST /api/v1/sessions`（`datasource` 必填）
- `GET /api/v1/sessions`（支持 `status`、`datasource` 与 `view=current|readonly-history|all`）
- `PATCH /api/v1/sessions/:sessionId`（支持 `title` 与 `debugEnabled` 局部更新）
- `DELETE /api/v1/sessions/:sessionId`（软删除，默认列表隐藏）
- `POST /api/v1/sessions/:sessionId/messages`
- `POST /api/v1/sessions/:sessionId/messages/stream`（SSE 流式）
- `GET /api/v1/sessions/:sessionId/messages`（返回 `session + messages + latestRun`）
- `GET /api/v1/runs/:runId`
- `GET /api/v1/datasources`
- `POST /api/v1/datasources`
- `POST /api/v1/datasources/upload`
- `GET /api/v1/system/users`
- `POST /api/v1/system/users`
- `PATCH /api/v1/system/users/:userId`
- `PATCH /api/v1/system/users/:userId/status`
- `POST /api/v1/system/users/:userId/reset-password`
- `DELETE /api/v1/system/users/:userId`
- `POST /api/v1/system/users/batch-delete`
- `GET /api/v1/system/workspaces`
- `POST /api/v1/system/workspaces`
- `PATCH /api/v1/system/workspaces/:workspaceId`
- `DELETE /api/v1/system/workspaces/:workspaceId`
- `GET /api/v1/system/workspaces/:workspaceId/members`
- `POST /api/v1/system/workspaces/:workspaceId/members`
- `PATCH /api/v1/system/workspaces/:workspaceId/members/:memberId/role`
- `DELETE /api/v1/system/workspaces/:workspaceId/members/:memberId`
- `POST /api/v1/system/workspaces/:workspaceId/members/remove-batch`
- `GET /api/v1/system/workspaces/:workspaceId/datasources/bindings`
- `POST /api/v1/system/workspaces/:workspaceId/datasources/bindings/add`
- `POST /api/v1/system/workspaces/:workspaceId/datasources/bindings/remove`
- `GET /api/v1/system/workspaces/:workspaceId/datasources/:datasourceId/tables`
- `GET /api/v1/system/workspaces/:workspaceId/datasources/:datasourceId/table-permissions`
- `PUT /api/v1/system/workspaces/:workspaceId/datasources/:datasourceId/table-permissions`
- `POST /api/v1/evaluations/run`
- `GET /api/v1/evaluations/:jobId`
- `GET /health`

## Chat 调试回溯说明
- 会话级调试开关字段：`Session.debugEnabled`，默认 `false`，按会话持久化保存。
- 运行记录新增 `SqlRun.llmRaw`：包含 `provider`、`model`、`rawText`、`createdAt`，用于原始输出回溯。
- `trace.steps` 支持节点级状态 + 可选摘要字段（输入/输出/错误摘要、时长）；前端字段缺失时自动降级为节点态。
- 历史会话不会回填旧 `llmRaw` 数据；开启调试时会显示“该会话无历史原始返回数据”。
- 当前策略为永久保留调试数据，不做自动清理任务。

## Stream & Tool Calling 说明
- 流式主路径：`POST /api/v1/sessions/:sessionId/messages/stream`。
- 同步消息接口 `POST /api/v1/sessions/:sessionId/messages` 返回 `AgentRunResponse`：
  - `kind`：固定为 `agent-run`
  - `outcome`：`clarification | executionResult | rejected | failed`
  - `run`：完整运行结果（含 `trace` 与可选 `llmRaw`）
  - `agent`：聚合元信息（provider/model、是否有 SQL、是否有工具调用、是否有错误）
- SSE 事件类型：`start`、`text-delta`、`tool-call`、`tool-result`、`tool-error`、`state`、`finish`、`error`。
- SSE 事件必填字段：`type`、`runId`、`sessionId`、`at`、`data`；其中 `data` 为结构化对象，不再混用字符串载荷。
- 当前 Tool Calling 基础能力默认启用，首个工具为 `runReadOnlySql`（只读 SQL 执行，含输入校验与安全守卫）。

## 测试
```bash
pnpm test
pnpm test:backend
pnpm test:frontend
```

## 后端发布完成门禁（Prisma V7）
- 依赖与生成：`pnpm --filter @text2sql/backend run prisma:generate`
- 质量门禁：`pnpm --filter @text2sql/backend run lint && pnpm --filter @text2sql/backend run build && pnpm --filter @text2sql/backend run test`
- 迁移回放：`pnpm --filter @text2sql/backend run prisma:verify-empty-db`
- 启动 smoke：至少验证 `GET /health`；关键接口建议覆盖：
  - `POST /api/v1/sessions`
  - `POST /api/v1/sessions/:sessionId/messages`
  - `GET /api/v1/settings/models`（管理员上下文）
- CI 可参考：`.github/workflows/backend-prisma-quality.yml`

## 前端质量门禁
```bash
pnpm --filter @text2sql/frontend lint
pnpm --filter @text2sql/frontend test
pnpm --filter @text2sql/frontend build
```
