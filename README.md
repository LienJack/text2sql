# text2sql

Text2SQL 学习演示版（阶段0-3路线）的单仓项目。

## 技术栈
- 后端：NestJS + TypeScript + Prisma
- Agent：LangGraph `StateGraph` 运行时编排（澄清 -> 生成SQL -> 安全检查 -> 执行 -> 格式化）
- 前端：Next.js + React + Tailwind CSS v4 + shadcn-ui
- 查询数据：SQLite（`data/sqlite/text2sql.db`）
- 功能数据：Redis 缓冲 + PostgreSQL 持久化

## 项目规范
- 前端重写规范：`docs/standards/frontend-react-shadcn-spec.md`
- 前端重写需求：`docs/brainstorms/2026-04-10-frontend-react-shadcn-rewrite-requirements.md`

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
- `LLM_PROVIDER=volcengine`（或 siliconflow/minimax）
- `LLM_BASE_URL=<openai-compatible-base-url>`（支持 `https://xxx`、`https://xxx/v1` 或完整 `/chat/completions` 路径）
- `LLM_API_KEY=<api-key>`
- `LLM_MODEL=<model-name>`
- `LLM_MOCK_MODE=false`（联调真实模型时保持 false）
- `LANGSMITH_TRACING=true|false`（是否启用 LangSmith 追踪）
- `LANGSMITH_API_KEY=<langsmith-api-key>`（启用追踪时必填）
- `LANGSMITH_PROJECT=text2sql`（可选，默认 `text2sql`）
- `LANGSMITH_ENDPOINT=https://api.smith.langchain.com`（可选）

4. 生成 Prisma Client（可选但推荐）
```bash
pnpm --filter @text2sql/backend prisma:generate
```

5. 启动前后端
```bash
pnpm dev
```

默认地址：
- 后端：`http://localhost:3000`
- 前端：`http://localhost:3001/chat`

## 联调检查清单（真实 LLM）
- 后端健康检查 `GET /health` 中 `llm.configured` 与 `llm.baseUrlConfigured` 为 `true`。
- 如开启 LangSmith，`GET /health` 中 `dependencies.langsmith.ready` 为 `true`。
- 前端能成功创建会话并发送消息，无跨域报错。
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
- `POST /api/v1/sessions`
- `POST /api/v1/sessions/:sessionId/messages`
- `GET /api/v1/sessions/:sessionId/messages`
- `GET /api/v1/runs/:runId`
- `POST /api/v1/evaluations/run`
- `GET /api/v1/evaluations/:jobId`
- `GET /health`

## 测试
```bash
pnpm test
pnpm test:backend
pnpm test:frontend
```

## 前端质量门禁
```bash
pnpm --filter @text2sql/frontend lint
pnpm --filter @text2sql/frontend test
pnpm --filter @text2sql/frontend build
```
