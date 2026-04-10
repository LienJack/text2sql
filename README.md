# text2sql

Text2SQL 学习演示版（阶段0-3路线）的单仓项目。

## 技术栈
- 后端：NestJS + TypeScript + Prisma
- Agent：LangGraph 风格节点编排（澄清 -> 生成SQL -> 安全检查 -> 执行 -> 格式化）
- 前端：Next.js + React
- 查询数据：SQLite（`data/sqlite/text2sql.db`）
- 功能数据：Redis 缓冲 + PostgreSQL 持久化

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

