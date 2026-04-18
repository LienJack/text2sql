---
title: feat: R2 基础底座（Ingestion + Index）计划
type: feat
status: active
date: 2026-04-17
origin: docs/brainstorms/2026-04-14-text2sql-r2-rag-implementation-detail-requirements.md
deepened: 2026-04-17
---

# feat: R2 基础底座（Ingestion + Index）计划

## Overview

本阶段聚焦 R2 数据底座建设：统一文档接入、profile 切块、双路索引构建与版本化激活，为后续检索/重排/主链接入提供稳定输入与可回放证据。

## Execution Tracking

- 专用执行日志：`docs/plans/2026-04-17-002-feat-rag-r2-foundation-ingestion-index-execution-log.md`
- 主执行日志（跨阶段）：`docs/plans/2026-04-17-001-feat-rag-text2sql-v1-3-phased-execution-log.md`

## Problem Frame

当前系统缺乏可持续 ingestion 与索引生命周期能力，RAG 相关数据无法标准化沉淀，也无法保证“构建中”与“在线可读”隔离。若不先完成底座，后续检索和主链接入将缺少稳定前提。

## Requirements Trace

### R6-R24 对齐矩阵（Phase A + 交接）

| Requirement | 本计划职责（Phase A） | 交接/依赖 |
|---|---|---|
| R6 | 落地三类 ingestion 来源接入边界与归一化入口（schema/sql example/semantic term） | 为 `docs/plans/2026-04-17-003-feat-rag-r2-retrieval-agent-gate-plan.md` 提供可检索文档池 |
| R7 | 定义统一 `RagDocument` 契约，强制 `source_version` 与 `content_checksum` | 003 基于同一契约产出 `retrieval_bundle` |
| R8 | 实现 profile 化 chunk 策略（`schema_table`/`schema_column`/`sql_example`/`semantic_term`） | 003 直接消费 chunk metadata 做 lane 过滤与重排特征 |
| R9 | 补齐可检索 metadata 最小字段集合与约束 | 003 融合与风险打标签复用字段 |
| R10 | 提供 lexical + dense 双路索引构建能力（graph lane 先保留对齐字段与接口） | 003 在检索阶段完成 graph lane 并行召回接入 |
| R11 | dense 默认可在无 pgvector 场景运行（Postgres 主线） | 003 在同约束下做检索/重排，不新增外部向量依赖 |
| R12 | 建立版本化快照 + 原子激活，禁止读取 building 索引 | 003 检索只能读取 active 版本 |
| R13 | Not in scope（由 003 交付） | 交付 `retrieval_bundle` 的输入数据结构 |
| R14 | Not in scope（由 003 交付） | 交付确定性融合 |
| R15 | Not in scope（由 003 交付） | 交付双级重排 |
| R16 | Not in scope（由 003 交付） | 交付主链节点接入 |
| R17 | 本阶段仅保证“索引构建失败不影响 active 读取”降级基础 | 003 交付检索/重排链路降级 |
| R18 | Not in scope（由 003 交付） | 交付 selected_context 消费 |
| R19 | 建立底座级指标采集字段（构建成功率、激活时延、可读性） | 003 汇总为 R2 Gate 报告 |
| R20 | Not in scope（R2 最终阈值由 003 验收） | 003 必须执行阈值判定 |
| R21 | 定义 run 级 replay 主键与基础载荷字段（index/doc/chunk 关联） | 003 完成 rewrite/retrieval/rerank 全量回放 |
| R22 | 打通 ingestion/index trace/span 与 health 摘要基础字段 | 003 扩展到 retrieval/rerank 并输出门禁摘要 |
| R23 | Not in scope（由 003 与 SQL 安全链路联动） | 003 交付 `risk_tags` 协同 |
| R24 | 本阶段必须完成一次“索引版本回滚演练”并固化证据 | 003 在 R2 发布前完成整链回滚演练 |

## Scope Boundaries

- 本阶段不接入 LangGraph 新节点。
- 本阶段不落地模型重排逻辑。
- 本阶段不做 R2 最终 Gate 放行判定（R20 在 003）。

## Context & Research

### Relevant Code and Patterns

- Prisma 模型管理：`apps/backend/prisma/schema.prisma`
- Prisma 配置：`apps/backend/prisma.config.ts`
- 数据仓储模式：`apps/backend/src/modules/data/persistence/*.ts`
- 后台任务模式：`apps/backend/src/modules/*/jobs/*`
- 健康检查与门禁摘要：`apps/backend/src/modules/system/health.controller.ts`

### Institutional Learnings

- 过往迁移相关变更必须遵守 Prisma CLI 生成流程，避免手改 SQL 漂移。

### External References

- [PostgreSQL text search](https://www.postgresql.org/docs/current/textsearch-controls.html)
- [PostgreSQL INSERT ON CONFLICT](https://www.postgresql.org/docs/current/sql-insert.html)

## Key Technical Decisions

- 决策 1：R2 默认使用 Postgres 内建能力承载 lexical 与 metadata 过滤。  
  理由：满足“不引入第三方 RAG 运行时依赖”的约束（see origin）。
- 决策 2：dense 首版必须在无 pgvector 场景运行，后续再评估可选增强。  
  理由：保证本阶段可落地与可回退。
- 决策 3：索引激活采用事务化原子切换，禁止读取 building 版本。  
  理由：满足 R12 的一致性要求。
- 决策 4：R21/R22 在本阶段先冻结 replay 与 trace 字段契约。  
  理由：避免 003 阶段再改字段导致口径漂移。

## Open Questions

### Resolved During Planning

- 是否在本阶段引入外部向量库：否。
- 是否在本阶段完成增量刷新：仅保留接口，完整事件化在 R5 落地。

### Resolve Before Phase Entry

- [Affects Unit 1][Blocking] 确认现有 Prisma 基线迁移链路通过（`prisma:verify-empty-db` 无漂移）。
- [Affects Unit 1][Blocking] 确认既有测试套件全绿（`pnpm --filter @text2sql/backend run test`）。
- [Affects Unit 2][Non-blocking] 确认三类 ingestion 来源的样本数据可获取（schema/sql_example/semantic_term）。

### Deferred to Implementation

- dense 字段最终采用 `float4[]` 或 `jsonb` 的实现细节，需结合查询性能验证。

## Boundary & Edge Case Catalog

以下边界场景必须在对应 Unit 中覆盖：

| ID | 场景 | 归属 Unit | 处理策略 |
|---|---|---|---|
| B-002-1 | 空文档/空 DDL 解析后无有效 chunk 产出 | Unit 2 | 拒绝入库，记录 `reject_reason=empty_content`，不产出空 chunk 集合 |
| B-002-2 | 超大单文档产出 chunk 数 > 5000 | Unit 2 | 触发保护熔断，拒绝入库并告警，记录文档 ID 与实际 chunk 数 |
| B-002-3 | 并发 ingestion 同一 datasource | Unit 2 | 通过 datasource 级锁或乐观并发控制保证幂等，后到任务等待或快速失败 |
| B-002-4 | dense 向量维度不一致（模型切换/配置错误） | Unit 3 | 构建时校验维度一致性，不一致时拒绝构建并记录错误，不混入已有索引 |
| B-002-5 | active 切换事务超时（大数据量下） | Unit 3 | 设置事务超时上限，超时后事务回滚、保留旧 active 不变，记录失败原因 |
| B-002-6 | 构建过程中旧 active 版本被意外删除 | Unit 3 | 激活前校验旧版本存在性，若缺失则保持 degraded 状态并告警 |
| B-002-7 | content_checksum 碰撞（不同内容同 hash） | Unit 1 | 采用强 hash 算法（SHA-256+），碰撞概率可忽略但约束层面仍保留 content 级去重断言 |

## Implementation Units

- [x] **Unit 1: 扩展 Prisma RAG 基础模型**

**Goal:** 落地 RAG 文档、切块、索引版本与 replay 主键基础模型/约束。

**Requirements:** R6, R7, R9, R12, R21

**Dependencies:** None（本计划起始单元）

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`
- Create: `apps/backend/prisma/migrations/<timestamp>_r2_rag_foundation/migration.sql`
- Test: `apps/backend/test/integration/rag-foundation-schema.spec.ts`
- Test: `apps/backend/test/integration/rag-foundation-constraints.spec.ts`

**Approach:**
- 定义文档、chunk、index、replay log 相关模型与唯一约束。
- 强制 `source_version`、`content_checksum` 与 run 关联字段可追溯。
- 对高频过滤字段建立索引，覆盖 `datasource_id/domain/table_names/column_names`。

**Patterns to follow:**
- `apps/backend/prisma/schema.prisma`
- `docs/standards/backend-prisma-migration-spec.md`

**Test scenarios:**
- Happy path: 迁移后文档/chunk/index/replay 表可按约定写入与查询。
- Edge case: 同一 `content_checksum + source_version` 重复入库命中幂等约束。
- Error path: 唯一键冲突与外键缺失返回受控错误（非静默覆盖）。
- Integration: `prisma:verify-empty-db` 空库回放通过且无漂移。

**Verification:**
- Prisma migrate/generate/verify-empty-db 链路稳定通过；关键约束均有断言。

**Execution status (2026-04-17):**
- 代码与定向测试已完成（schema/migration + 2 个 integration spec + prisma:generate）。
- 已完成 `prisma:verify-empty-db`（空库回放 + migrate deploy/status 通过），Unit 1 验证闭环完成。

- [x] **Unit 2: 实现 RagDocument 标准化与 profile 切块**

**Goal:** 建立统一 ingestion 契约与可重算 chunk 生成过程。

**Requirements:** R6, R7, R8, R9, R11

**Dependencies:** Unit 1（数据模型完成）

**Files:**
- Create: `apps/backend/src/modules/rag/ingestion/rag-document.factory.ts`
- Create: `apps/backend/src/modules/rag/ingestion/rag-chunking.service.ts`
- Create: `apps/backend/src/modules/rag/ingestion/chunk-profiles.ts`
- Create: `apps/backend/src/modules/rag/ingestion/ingestion-source.adapter.ts`
- Test: `apps/backend/test/unit/rag-chunking.service.spec.ts`
- Test: `apps/backend/test/integration/rag-document-factory.spec.ts`

**Approach:**
- 按来源统一映射到 `RagDocument`，并填充强制字段。
- 基于 profile 做 token-aware 切块，确保四类 profile 行为可预测。
- `chunk_id` 基于文档标识、profile、偏移、checksum 生成，保证重复执行可复现。

**Patterns to follow:**
- `apps/backend/src/modules/agent/graph/agent.types.ts`

**Test scenarios:**
- Happy path: 三类 ingestion 来源都能产出满足契约的 `RagDocument` 和 chunk。
- Edge case: 超长文本切块保持 overlap，且 `table_names/column_names` 不丢失。
- Error path: 缺失 `source_version` 或 `content_checksum` 直接拒绝入库。
- Integration: 同一输入重复构建时 `chunk_id` 集合与顺序稳定一致。

**Verification:**
- 同输入重复执行可得到可复现 chunk 结果，并可被 Unit 3 索引器消费。

**Execution status (2026-04-17):**
- Unit 2 已完成：新增 source adapter、document factory、chunking service、chunk profiles 及对应 unit/integration 测试。
- 已通过定向测试与 backend lint，详见执行日志 `docs/plans/2026-04-17-001-feat-rag-text2sql-v1-3-phased-execution-log.md`。

- [x] **Unit 3: 实现全量构建任务与版本化激活**

**Goal:** 建立索引构建、状态管理与 active 原子切换能力。

**Requirements:** R10, R11, R12, R17

**Dependencies:** Unit 1, Unit 2

**Files:**
- Create: `apps/backend/src/modules/rag/index/rag-index-builder.service.ts`
- Create: `apps/backend/src/modules/rag/index/rag-index.repository.ts`
- Create: `apps/backend/src/modules/rag/jobs/build-rag-index.job.ts`
- Modify: `apps/backend/src/app.module.ts`
- Test: `apps/backend/test/integration/rag-index-builder.spec.ts`
- Test: `apps/backend/test/integration/rag-index-activation.spec.ts`

**Approach:**
- 构建流程状态分为 building/ready/active/deprecated。
- lexical + dense 双路索引在同一次 build 内输出并归档到同一版本快照。
- 通过事务化更新 active 版本，防止半成品上线。
- graph lane 仅冻结索引接口与融合所需字段，不在本阶段交付召回执行。

**Patterns to follow:**
- `apps/backend/src/modules/data/cache/persistence-retry.service.ts`

**Test scenarios:**
- Happy path: 新版本完成后激活成功，读取层仅暴露 active 版本。
- Edge case: 并发 build 仅一个版本进入 active，其他保持 ready/deprecated。
- Error path: build 中断不影响线上 active 读取与查询可用性。
- Integration: 无 pgvector 环境下 dense 路径仍可构建并参与后续召回输入。

**Verification:**
- 任意失败场景下线上读取仍指向旧 active 版本，不出现空读窗口。

**Execution status (2026-04-17):**
- Unit 3 已完成：新增 index repository / builder / job，并在 `app.module.ts` 完成注入。
- 已通过 `rag-index-builder.spec.ts`、`rag-index-activation.spec.ts`、backend lint 与 backend 全量测试复验。

- [x] **Unit 4: 建立底座可观测与基础回放记录**

**Goal:** 为 003 阶段 R2 Gate 提供指标底稿、回放键与回滚演练证据。

**Requirements:** R19, R21, R22, R24

**Dependencies:** Unit 1, Unit 3

**Files:**
- Modify: `apps/backend/src/modules/system/health.controller.ts`
- Create: `apps/backend/src/modules/rag/observability/rag-ingestion-metrics.service.ts`
- Create: `apps/backend/src/modules/rag/observability/rag-replay.repository.ts`
- Create: `docs/ops/r2-foundation-rollback-rehearsal.md`
- Test: `apps/backend/test/integration/rag-foundation-observability.spec.ts`
- Test: `apps/backend/test/integration/rag-foundation-replay.spec.ts`

**Approach:**
- health 摘要暴露索引版本、构建成功率、激活时延、失败计数。
- trace/span 中补齐 ingestion/index 关键阶段字段，供 003 聚合。
- 产出一次可复现 rollback rehearsal 记录（active <- previous_version）。
- replay 仓储保证 run 级主键可追溯到 index/doc/chunk。

**Patterns to follow:**
- `apps/backend/src/modules/observability/gate-metrics.service.ts`

**Test scenarios:**
- Happy path: health 返回 active 索引摘要和基础指标字段。
- Edge case: 无 active 索引时返回明确 `degraded` 状态与原因。
- Error path: 指标聚合失败时服务可响应且写入可诊断日志。
- Integration: `runId` 可反查对应 index/doc/chunk 记录并复原构建上下文。

**Verification:**
- 运维可从 health + rehearsal 文档判断索引可用性与可回滚性。

**Execution status (2026-04-17):**
- Unit 4 已完成：新增 `rag-ingestion-metrics.service` 与 `rag-replay.repository`，并将 foundation 摘要接入 `/health`。
- 已补齐 build job 与 observability/replay 链路的集成写入，确保非测试路径可观测与可回放。
- 已新增并通过 `rag-foundation-observability.spec.ts`、`rag-foundation-replay.spec.ts`。
- 已补充 `docs/ops/r2-foundation-rollback-rehearsal.md` 并完成 backend lint/test/build + prisma 空库回放验证。

## System-Wide Impact

- **Interaction graph:** 新增 `rag` 子域（ingestion/index/observability）并与 `data`、`system` 模块联动。
- **Error propagation:** build 失败必须局部隔离，chat 主链维持当前可用性。
- **State lifecycle risks:** `building -> active` 时序错误会导致读写错位或空读窗口。
- **Operational surface:** health 增加 R2 foundation 摘要字段，供 003 Gate 聚合复用。
- **Integration coverage:** 需覆盖迁移、构建、激活、回放、回滚演练全链路。
- **Unchanged invariants:** 本阶段不改变 LangGraph 主链节点行为与对外 API 合同。

## Stage Exit Gate (Phase A -> Phase B)

| Gate Metric | Definition | Phase A Threshold | Evidence |
|---|---|---|---|
| Ingestion Contract Completeness | 入库文档中 `source_version`/`content_checksum` 完整率 | 100% | Unit 2 单测 + 集成测试 |
| Active Index Isolation | 查询仅可见 active 版本的正确率 | 100% | Unit 3 集成测试 |
| Build Failure Isolation | build 失败时 chat 主链可用性影响 | 0 次主链不可用 | Unit 3 错误场景测试 |
| Replay Link Integrity | `runId -> index/doc/chunk` 可回放完整率 | >= 99% | Unit 4 回放测试 |
| Rollback Rehearsal | 索引回滚演练成功率 | 1/1（每次发布前至少一次） | `docs/ops/r2-foundation-rollback-rehearsal.md` |

说明：R20 的最终 R2 阈值（Recall/MRR/P95/Degrade）在 003 阶段统一判定。

## Risks & Dependencies

| Risk | Trigger | Mitigation | Residual Check |
|------|---------|------------|----------------|
| Prisma 迁移与现有模型冲突 | schema 变更后 CI/本地迁移失败 | 严格遵守 Prisma CLI 迁移流程并跑 `prisma:verify-empty-db` | 迁移回放日志与空库验证记录 |
| dense 路径性能波动 | 数据规模上升导致构建或查询超时 | 保持无 pgvector 主线 + 预留参数化阈值 | Phase B 压测与门禁复核 |
| 构建失败导致状态不一致 | build 任务中断/异常退出 | building/active 状态隔离 + 事务化激活 | Unit 3 错误场景断言 |
| replay 字段口径漂移 | 003 引入新字段时修改旧语义 | 在 Phase A 冻结最小 replay 字段契约 | 003 契约测试需引用本计划字段定义 |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-14-text2sql-r2-rag-implementation-detail-requirements.md](docs/brainstorms/2026-04-14-text2sql-r2-rag-implementation-detail-requirements.md)
- Related plan: [docs/plans/2026-04-17-001-feat-rag-text2sql-v1-3-phased-plan-index.md](docs/plans/2026-04-17-001-feat-rag-text2sql-v1-3-phased-plan-index.md)
- Next phase: [docs/plans/2026-04-17-003-feat-rag-r2-retrieval-agent-gate-plan.md](docs/plans/2026-04-17-003-feat-rag-r2-retrieval-agent-gate-plan.md)
