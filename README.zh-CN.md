# Text2SQL

[English](README.md) | 简体中文 | [日本語](README.ja.md)

Text2SQL 是一个面向企业数据问答场景的全栈学习与演示项目。它把自然语言问题转换为可治理、可执行、可回放的 SQL，并围绕数据源接入、语义知识、权限治理、运行证据和前端交互做成一条完整链路。

![Text2SQL 平台总览](assets/readme-platform-overview.png)

## 项目背景

业务团队常常知道自己想问什么，却不一定知道数据在哪张表、指标口径是什么、SQL 应该怎么写。直接把问题交给大模型也不够可靠：模型容易猜错表结构，缺少业务术语上下文，无法自然遵守表权限，也很难在出错后解释“为什么生成了这条 SQL”。

这个项目的目标不是做一个只会生成 SQL 的 Prompt demo，而是搭建一个接近真实生产约束的 Text2SQL 平台原型：

- 用户从数据源出发提问，系统绑定会话、工作空间和数据权限。
- Agent 在生成 SQL 前先检索 schema、术语、历史样例和语义资产。
- SQL 生成后必须经过只读、安全、权限和执行校验。
- 每次运行都有 `runId`，可以追溯 trace、RAG evidence、delivery artifact 和回放结果。
- 前后端通过共享类型和 SSE 协议保持同步接口、流式接口、运行详情的一致性。

## 解决的问题

1. **自然语言到 SQL 的上下文缺口**
   用户说的是“销售额”“活跃客户”“近 30 天趋势”，数据库里却是表、列、外键、指标和业务术语。项目通过 RAG、semantic spine、glossary、modeling workspace 把这些上下文变成 SQL 生成前的证据。

2. **大模型生成不可控**
   Text2SQL v2 runtime 使用显式 LangGraph 节点编排，把 intake、retrieve、assemble-context、semantic-plan、generate-sql、validate、correct、execute、answer 拆成可观察阶段，而不是把所有逻辑塞进一个 Prompt。

3. **数据权限与安全执行**
   查询不是“能跑就行”。系统以 workspace datasource binding、table-permissions、policyVersion 为治理主线，执行链路倾向 fail-closed：不确定、未授权、不可安全解析时拒绝执行。

4. **故障难诊断**
   每次问数都围绕 `runId` 保存运行证据。同步响应、流式 finish、run view 和 RAG replay 都尽量指向同一份 delivery contract，方便复盘 RAG 命中、SQL 生成、修正、执行和前端展示。

5. **多数据源演示闭环**
   项目支持 SQLite、MySQL、PostgreSQL、CSV、Excel 数据源，并提供 `/data-sources -> /chat -> /settings -> /modeling` 等前端工作台页面，适合演示和继续扩展。

## 功能预览

### 语义建模工作台

![语义建模工作台](assets/screenshots/01-modeling-erd-workbench.png)

数据关系图用于把物理表结构提升为可运营的语义资产。左侧是 Models / Views 资产树，中间是 ERD 画布，右侧是选中模型的字段、关系和预览上下文。用户可以同步数据库、自动布局、维护关系、保存 Modeling Draft，并在检查通过后发布到 active 版本。

### 数据源接入向导

![数据源接入向导](assets/screenshots/02-datasource-create-wizard.png)

数据源页面负责把数据库或文件接入工作空间。向导支持 CSV、Excel、SQLite、MySQL、PostgreSQL，创建或编辑时会自动绑定当前工作空间，并通过幂等键避免重复提交。数据源创建后可以直接进入问数会话，也可以继续做表选择和建模初始化。

### ChatBI 问数工作台

![ChatBI 问数工作台](assets/screenshots/03-chat-answer-result.png)

Chat 页面是自然语言问数主入口。每个会话绑定一个数据源和模型配置，侧栏按数据源隔离历史会话；主区域展示用户问题、Agent 运行阶段、最终回答、表格证据和可保存视图入口。回答不是单纯文本，而是带 `validation`、执行摘要和 artifact 的结构化交付结果。

### SQL 证据回放

![SQL 证据回放](assets/screenshots/04-chat-sql-evidence.png)

同一次 ChatBI 结果可以切换到 SQL 证据分区，查看用于生成当前回答的 SQL。这个视图服务于人工核验、调试回放和治理审计：用户能确认模型生成的查询、排序、聚合和字段选择是否符合业务预期。

### 图表结果

![图表结果](assets/screenshots/05-chat-chart-result.png)

结果 artifact 也可以投影成图表。当前示例把支付方式占比渲染为图形视图，和 Answer、View SQL 共用同一次运行证据，避免“文本回答、SQL、图表”三套结果互相漂移。

## 设计哲学

- **证据先于生成**：SQL 生成前先组织 schema、术语、关系、权限、历史样例等 typed context，减少模型猜测。
- **图编排优于 Prompt 串联**：关键阶段都作为 runtime 节点存在，便于观测、测试、流式投影和局部替换。
- **治理内建，而非事后补丁**：workspace、datasource、table-permissions 和安全校验是主链路的一部分。
- **可用但不静默降级**：RAG lane 可独立超时和降级，但降级原因会进入 evidence，不把风险藏起来。
- **有界纠错**：SQL 修正是受预算约束的闭环，避免无限 agent loop。
- **合同稳定**：共享类型包和 chat stream protocol 包承担前后端合同边界，避免 sync、stream、replay 各自漂移。

## 架构设计

### Monorepo 结构

```text
apps/backend                  NestJS API、Text2SQL runtime、治理、知识与平台能力
apps/frontend                 Next.js 前端工作台
packages/shared-types         前后端共享类型
packages/chat-stream-protocol SSE envelope、parser、terminal guard、UI projection helpers
infra                         PostgreSQL、Redis、Nginx 本地编排
data                          本地上传文件、SQLite 与运行期数据
docs                          方案、规范、排障与理解文档
```

### 系统总览

```mermaid
flowchart LR
  User["Browser"] --> Gateway["Nginx gateway<br/>localhost:3000"]
  Gateway --> Frontend["Frontend<br/>Next.js :3001"]
  Gateway --> Backend["Backend<br/>NestJS :3002"]

  Backend --> Conversation["conversation<br/>chat + text2sql + delivery"]
  Backend --> Governance["governance<br/>workspace + datasource + table-permissions"]
  Backend --> Knowledge["knowledge<br/>RAG + glossary + semantic spine + graph"]
  Backend --> Platform["platform<br/>persistence + query + cache + config + observability"]

  Conversation --> Governance
  Conversation --> Knowledge
  Conversation --> Platform
  Governance --> Platform
  Knowledge --> Platform

  Platform --> Postgres["PostgreSQL"]
  Platform --> Redis["Redis"]
  Platform --> Datasources["SQLite / MySQL / PostgreSQL / CSV / Excel"]
```

### 后端四个能力域

| 能力域 | 目录 | 职责 |
| --- | --- | --- |
| `conversation` | `apps/backend/src/modules/conversation` | 会话入口、Text2SQL workflow、LangGraph runtime、delivery contract |
| `governance` | `apps/backend/src/modules/governance` | 工作空间、数据源绑定、表权限、用户与设置治理 |
| `knowledge` | `apps/backend/src/modules/knowledge` | RAG 检索、语义资产、术语、记忆、图谱与建模上下文 |
| `platform` | `apps/backend/src/modules/platform` | 数据持久化、查询执行、缓存、配置、观测和读模型守卫 |

跨域依赖方向固定为：

```text
conversation -> governance | knowledge | platform
governance   -> platform
knowledge    -> platform
platform     -> no business-domain dependency
```

### Text2SQL v2 运行时

当前主链路固定为：

```text
Text2SQLWorkflowRunner
  -> RunV2LangGraphStage
  -> Text2SqlV2LangGraphRunnerService
```

一次问数的大致生命周期：

```mermaid
flowchart TD
  A["intake<br/>识别问题类型与风险"] --> B{"route"}
  B -- "text_to_sql / metadata" --> C["retrieve<br/>RAG 检索"]
  B -- "general / unsafe / unsupported" --> I["answer"]
  C --> D["assemble-context<br/>组装 selected context"]
  D --> E["semantic-plan<br/>语义计划与路由"]
  E -- "ready" --> F["generate-sql"]
  E -- "clarify / direct answer / fail closed" --> I
  F --> G["validate<br/>只读、安全、权限、方言、dry-run"]
  G -- "pass" --> H["execute"]
  G -- "correctable" --> J["correct"]
  G -- "terminal" --> I
  J -- "retry_generation" --> F
  J -- "terminal" --> I
  H --> I["answer<br/>delivery + evidence + artifact"]
```

### RAG 与语义上下文

RAG 不是简单拼接文本。当前设计强调：

- manifest-first semantic asset preparation
- lexical、dense、graph 三路召回
- 权限过滤先于融合和重排
- RRF 融合与双阶段 rerank
- `selected_context`、`degradeReasons`、`riskTags` 进入运行证据
- `runId` 贯穿 trace、delivery、replay

## 安装与运行

### 依赖要求

- Node.js 20 或兼容版本
- pnpm 10.x，仓库声明为 `pnpm@10.33.0`
- Docker 与 Docker Compose

### 1. 安装依赖

```bash
pnpm install
```

### 2. 启动本地基础设施

```bash
docker compose -f infra/docker-compose.yml up -d
```

该命令会启动：

- Nginx gateway：`http://localhost:3000`
- PostgreSQL：`localhost:5432`
- Redis：`localhost:6379`

### 3. 初始化环境变量

```bash
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env
```

后端关键配置位于 `apps/backend/.env`：

- `PORT=3002`
- `POSTGRES_HOST/POSTGRES_PORT/POSTGRES_DB/POSTGRES_USER/POSTGRES_PASSWORD`
- `REDIS_URL=redis://localhost:6379`
- `LLM_PROVIDER`、`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`
- `EMBEDDING_PROVIDER`、`EMBEDDING_BASE_URL`、`EMBEDDING_API_KEY`、`EMBEDDING_MODEL`
- `RERANK_*` 可选，未配置时可回退到 LLM provider 配置

前端默认使用同源 `/api`，通常不需要改 `NEXT_PUBLIC_API_BASE_URL`。

### 4. 准备 Prisma

```bash
pnpm --filter @text2sql/backend run prisma:generate
pnpm --filter @text2sql/backend exec node scripts/prisma-with-database-url.cjs migrate deploy
```

如果你是在验证迁移能否从空库完整回放，可以使用独立测试库执行：

```bash
DATABASE_URL=postgresql://admin:admin@localhost:5432/text2sql_ci \
pnpm --filter @text2sql/backend run prisma:verify-empty-db
```

### 5. 启动前后端

```bash
pnpm dev
```

默认访问：

- 统一入口：`http://localhost:3000`
- 数据源入口：`http://localhost:3000/data-sources`
- 前端直连调试：`http://localhost:3001`
- 后端健康检查：`http://localhost:3002/health`

### 6. 快速 smoke

```bash
node tests/smoke/nginx-dev-gateway-smoke.mjs
```

## 常用工作流

### 数据源到问数

1. 打开 `http://localhost:3000/data-sources`
2. 创建或选择 SQLite、MySQL、PostgreSQL、CSV、Excel 数据源
3. 绑定当前 workspace 并进入会话
4. 在 `/chat` 输入自然语言问题
5. 查看回答、SQL、执行结果和调试证据

### 设置与治理

- `/settings`：LLM 模型、RAG 配置、RAG 运行、系统用户等设置入口
- `/glossary`：业务术语维护
- `/modeling`：数据源建模、关系与语义视图
- `/prompts`：提示词模板管理

## 质量门禁

跨项目：

```bash
pnpm run format:check
pnpm run test
pnpm run build
```

后端：

```bash
pnpm --filter @text2sql/backend run lint
pnpm --filter @text2sql/backend run test
pnpm --filter @text2sql/backend run build
pnpm --filter @text2sql/backend run prisma:verify-empty-db
```

前端：

```bash
pnpm --filter @text2sql/frontend run lint
pnpm --filter @text2sql/frontend run test
pnpm --filter @text2sql/frontend run build
```

专项门禁：

```bash
pnpm run governance:terminology:check
pnpm run backend:capability-boundary:check
pnpm run text2sql:no-legacy-compat:check
pnpm --filter @text2sql/backend run collect:text2sql-v2-eval-gate
pnpm --filter @text2sql/backend run collect:text2sql-v2-focused-coverage-gate
pnpm --filter @text2sql/backend run collect:modeling-parity-shadow-gate
```

## 重要规范

- Prisma 结构变更必须先改 `apps/backend/prisma/schema.prisma`，再由 Prisma CLI 生成迁移。
- 禁止手写或手改 `apps/backend/prisma/migrations/*/migration.sql`。
- 表结构变更后必须执行 `pnpm --filter @text2sql/backend run prisma:generate`。
- 前端交互控件优先复用 shadcn-ui 与项目内业务封装。
- 治理主链路只使用 `workspace datasource binding`、`table-permissions`、`policyVersion` 作为 active narrative。

## 深入阅读

- `AGENTS.md`：仓库级执行入口、硬边界和质量门禁
- `docs/text2sql-architecture-and-flow-2026-04-29.md`：当前架构与 Text2SQL 主流程
- `docs/rag-understanding/text2sql-rag-end-to-end-understanding.md`：Text2SQL + RAG 端到端解析
- `docs/rag-understanding/text2sql-rag-runid-replay-handbook.md`：runId 回放与诊断
- `docs/rag-understanding/text2sql-rag-local-learning-lab.md`：本地实验剧本
- `docs/standards/backend-prisma-migration-spec.md`：Prisma 迁移规范
- `docs/standards/frontend-react-shadcn-spec.md`：前端 React + shadcn 规范
- `docs/standards/llm-stream-tool-migration-spec.md`：LLM stream 与 tool calling 迁移规范
- `docs/standards/governance-terminology-spec.md`：治理术语硬切规范
- `docs/standards/backend-business-capability-topology-spec.md`：后端能力域拓扑规范
