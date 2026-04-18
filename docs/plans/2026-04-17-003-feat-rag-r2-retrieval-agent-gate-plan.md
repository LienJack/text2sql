---
title: feat: R2 检索重排与主链接入计划
type: feat
status: active
date: 2026-04-17
origin: docs/brainstorms/2026-04-14-text2sql-r2-rag-implementation-detail-requirements.md
deepened: 2026-04-17
---

# feat: R2 检索重排与主链接入计划

## Overview

本阶段在 R2 底座之上完成多路召回、融合重排、LangGraph 主链接入和 R2 Gate 指标闭环，是 R2 的最终放行阶段。

## Execution Tracking

- 专用执行日志：[`docs/plans/2026-04-17-003-feat-rag-r2-retrieval-agent-gate-execution-log.md`](docs/plans/2026-04-17-003-feat-rag-r2-retrieval-agent-gate-execution-log.md)
- 主执行日志（跨阶段）：[`docs/plans/2026-04-17-001-feat-rag-text2sql-v1-3-phased-execution-log.md`](docs/plans/2026-04-17-001-feat-rag-text2sql-v1-3-phased-execution-log.md)
- 当前状态：`GATE-R2B=active`，`Unit 1=in_progress`，`Unit 2-4=pending`

## Problem Frame

即使底座完成，如果没有把检索结果稳定注入主链，SQL 生成仍会退回纯模型猜测。此阶段必须打通“召回 -> 重排 -> selected_context -> SQL 生成 -> 质量门禁”的端到端闭环。

## Requirements Trace

### R6-R24 对齐矩阵（Phase B 收敛）

| Requirement | 002 交接状态 | 本计划职责（Phase B） |
|---|---|---|
| R6 | 已交付 ingestion 三类来源接入 | 消费已入库文档，不新增来源类型 |
| R7 | 已交付 `RagDocument` 契约 | 检索/重排输出严格沿用该契约字段 |
| R8 | 已交付 profile chunk | 以 chunk profile 作为召回与重排特征输入 |
| R9 | 已交付 metadata 最小字段 | 用于 lane 过滤、打分解释与风险标注 |
| R10 | 已交付 lexical+dense 索引底座 | 在检索层完成 lane 并发与融合 |
| R11 | 已交付无 pgvector dense 主线 | 检索与重排不引入新外部向量依赖 |
| R12 | 已交付版本化激活 | 检索只读取 active 版本 |
| R13 | 输入已具备 | 交付 `retrieval_bundle`（`candidates/reranked/selected_context/degrade_reason`） |
| R14 | 输入已具备 | 交付确定性融合（RRF）与入选理由字段 |
| R15 | 输入已具备 | 交付双级重排（一级必开、二级可超时降级） |
| R16 | 输入已具备 | 交付 `retrieve_knowledge -> build_intent_plan -> build_semantic_query` 主链节点序列 |
| R17 | 002 已保证构建失败隔离 | 交付检索/重排失败降级，主链持续可用 |
| R18 | 输入已具备 | 交付 `selected_context` 被 SQL 生成阶段消费 |
| R19 | 002 已交付基础指标字段 | 聚合并输出 R2 Gate 指标报告 |
| R20 | 002 未执行最终阈值判定 | 执行最终放行阈值判定（Recall/MRR/P95/Degrade） |
| R21 | 002 已冻结 replay 主键与基础载荷 | 交付 run 级完整回放（rewrite/召回/融合/重排/降级原因） |
| R22 | 002 已具备 ingestion/index trace 基础 | 交付 retrieval/rerank trace 完整接入与 health 摘要展示 |
| R23 | 002 未覆盖 | 与 SQL 安全链路联动，注入 `risk_tags` 与额外校验 |
| R24 | 002 已完成索引层演练 | 交付 R2 整链 rollback rehearsal 证据并可复现 |

## Scope Boundaries

- 本阶段不落地 R3 语义注册中心。
- 本阶段不实现 R4 沙箱与 R5 记忆晋升。
- 前端可视化不在本阶段范围内。

## Context & Research

### Relevant Code and Patterns

- LangGraph 主链：`apps/backend/src/modules/agent/graph/langgraph.runtime.ts`
- 节点组织：`apps/backend/src/modules/agent/nodes/*.node.ts`
- SQL 生成链路：`apps/backend/src/modules/agent/sql/sql-generation.service.ts`
- SQL 安全护栏：`apps/backend/src/modules/agent/sql/tools/sql-safety.guard.ts`
- 观测与门禁：`apps/backend/src/modules/observability/*`
- 健康摘要：`apps/backend/src/modules/system/health.controller.ts`

### External References

- [Reciprocal Rank Fusion](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf)

## Key Technical Decisions

- 决策 1：检索默认并行 lane 为 lexical + dense + graph。  
  理由：满足 R10 在检索阶段的融合落地，同时保持可扩展性。
- 决策 2：融合算法固定 RRF，保证可复现性优先。  
  理由：先满足 R14 审计可追溯，再考虑动态加权。
- 决策 3：二级重排受预算和超时硬限制，失败自动回退一级。  
  理由：满足 R15/R17，不让模型调用成为主链单点。
- 决策 4：`risk_tags` 直接进入 SQL 安全链路。  
  理由：满足 R23，避免检索质量提升破坏安全边界。

## Open Questions

### Resolved During Planning

- 是否把 query rewrite 放在 R3：否，R2 先提供基础 rewrite 能力。

### Deferred to Implementation

- graph lane 的候选上限参数需结合压测调优。
- R20 指标在首轮灰度是否按业务域分桶评估（see origin 的 deferred question）。

## Boundary & Edge Case Catalog

| ID | 场景 | 归属 Unit | 处理策略 |
|---|---|---|---|
| B-003-1 | 三路 lane 全部返回空结果（零召回） | Unit 1 | 产出带 `degrade_reason=zero_recall` 的空 bundle，不中断主链，SQL 生成走无 RAG 降级路径 |
| B-003-2 | RRF 融合分数全部相同（排序不确定性） | Unit 1 | 引入确定性 tie-breaker（如 chunk_id 字典序），保证同输入同版本排序可复现 |
| B-003-3 | 二级重排模型返回 NaN/负数/超范围分数 | Unit 2 | 丢弃异常评分候选，记录 `rerank_anomaly` 事件，回退一级排序结果 |
| B-003-4 | selected_context token 数超过模型上下文窗口 | Unit 3 | 按重排优先级截断到安全 token 上限（预留 prompt 开销），记录 `context_truncated=true` |
| B-003-5 | Gate 评估时样本量不满足最小要求 | Unit 4 | 返回 `sampleReady=false`，禁止发布，不以不足样本计算阈值判定 |
| B-003-6 | risk_tags 与 SQL safety guard 策略字段不匹配 | Unit 3 | 增加契约测试断言 risk_tags 枚举值与 safety guard 的 allowlist 一致，不一致时构建失败 |
| B-003-7 | 单 lane 延迟远超其他 lane（拖慢整体 P95） | Unit 1 | 每 lane 独立超时（建议 ≤ 300ms），超时 lane 视为降级、不等待其结果 |
| B-003-8 | query rewrite 产出的改写查询与原始查询语义严重偏离 | Unit 3 | 保留原始查询作为兜底检索输入，改写查询仅作为额外 lane 输入 |

## Implementation Units

- [x] **Unit 1: 落地多路召回与确定性融合**

**Goal:** 输出结构化候选并完成融合、去重、多样性裁剪。

**Requirements:** R13, R14, R17

**Dependencies:**
- `docs/plans/2026-04-17-002-feat-rag-r2-foundation-ingestion-index-plan.md` Unit 3（active index）
- `docs/plans/2026-04-17-002-feat-rag-r2-foundation-ingestion-index-plan.md` Unit 4（基础 replay/trace 字段）

**Files:**
- Create: `apps/backend/src/modules/rag/retrieval/rag-retrieval.service.ts`
- Create: `apps/backend/src/modules/rag/retrieval/fusion/rrf-fusion.ts`
- Create: `apps/backend/src/modules/rag/retrieval/rag-retrieval.types.ts`
- Test: `apps/backend/test/unit/rrf-fusion.spec.ts`
- Test: `apps/backend/test/integration/rag-retrieval.service.spec.ts`

**Approach:**
- lexical 使用 FTS；dense 使用向量相似度；graph 使用关系路径线索召回。
- 候选统一格式并保留 `source_lane`、`evidence`、`degrade_reason` 字段。
- 结构化输出 `retrieval_bundle.candidates`，作为 Unit 2 输入。

**Patterns to follow:**
- `apps/backend/src/modules/data/query/query-executor-router.service.ts`

**Test scenarios:**
- Happy path: 三路命中时 `retrieval_bundle.candidates` 与融合结果稳定可复现。
- Edge case: 单一路由无命中时其余 lane 仍产出可用候选，不空结果。
- Error path: dense 或 graph lane 异常时自动降级并写入 `degrade_reason`。
- Integration: 候选去重后仍保留 `schema/sql_example/semantic_term` 必需覆盖。

**Verification:**
- 同输入同索引版本下融合顺序可复现，且 replay 可还原 lane 原始得分。

- [x] **Unit 2: 实现双级重排与预算降级**

**Goal:** 一级规则保障稳定性，二级模型在预算内提升精度。

**Requirements:** R15, R17, R21

**Dependencies:** Unit 1

**Files:**
- Create: `apps/backend/src/modules/rag/rerank/rag-rerank.service.ts`
- Create: `apps/backend/src/modules/rag/rerank/model-reranker.adapter.ts`
- Modify: `apps/backend/src/modules/llm/provider-router.service.ts`
- Test: `apps/backend/test/unit/rag-rerank.service.spec.ts`
- Test: `apps/backend/test/integration/rag-rerank.integration.spec.ts`

**Approach:**
- 一级重排综合融合分、结构可执行性、时效与成功先验。
- 二级重排必须返回结构化评分与理由，超时则回退一级。
- 重排输出必须填充 `retrieval_bundle.reranked` 并可被 run replay 重建。

**Patterns to follow:**
- `apps/backend/src/modules/llm/llm-gateway.service.ts`

**Test scenarios:**
- Happy path: 一级+二级联合输出最终排序，二级对前 K 候选产生可解释增益。
- Edge case: 候选量低于阈值时自动跳过二级并保留一级输出。
- Error path: 二级重排超时/配额不足时回退一级且不中断主链。
- Integration: `retrieval_bundle.reranked` 与 replay 重排记录一致。

**Verification:**
- 所有重排失败场景都有可消费输出、降级证据与 trace/span 事件。

- [x] **Unit 3: 新增主链节点并接入 selected_context**

**Goal:** 将检索结果真正注入 SQL 生成链路。

**Requirements:** R16-R18, R23

**Dependencies:** Unit 1, Unit 2

**Files:**
- Modify: `apps/backend/src/modules/agent/nodes/retrieve-knowledge.node.ts`
- Modify: `apps/backend/src/modules/agent/nodes/build-intent-plan.node.ts`
- Modify: `apps/backend/src/modules/agent/nodes/build-semantic-query.node.ts`
- Modify: `apps/backend/src/modules/agent/sql/sql-generation.service.ts`
- Modify: `apps/backend/src/modules/agent/sql/tools/sql-safety.guard.ts`
- Modify: `apps/backend/src/modules/agent/graph/langgraph.state.ts`
- Modify: `apps/backend/src/modules/agent/graph/langgraph.runtime.ts`
- Modify: `apps/backend/src/modules/agent/graph/graph.builder.ts`
- Test: `apps/backend/test/integration/agent-rag-main-flow.spec.ts`
- Test: `apps/backend/test/integration/agent-rag-degrade-flow.spec.ts`

**Approach:**
- 在 `generate_sql` 前插入 RAG 节点链。
- 将 `selected_context`、`risk_tags`、`degrade_reason` 注入状态与 trace。
- SQL 生成消费 `selected_context`，并将高风险路径交由 safety guard 追加校验。

**Patterns to follow:**
- `apps/backend/src/modules/agent/graph/langgraph.runtime.ts`

**Test scenarios:**
- Happy path: 检索命中后 SQL 生成明确消费 `selected_context`（非空依赖证据）。
- Edge case: graph lane 无命中时 lexical+dense 仍驱动 SQL 生成。
- Error path: retrieval/rerank 报错时主链降级继续，并保留 `degrade_reason`。
- Integration: stream 与非 stream 都可观测 `retrieve_knowledge/build_intent_plan/build_semantic_query` 事件与 `risk_tags`。

**Verification:**
- 命中与降级两路径均可用、可追溯，并可触发安全护栏额外校验。

- [x] **Unit 4: 建立 R2 Gate 报告与回放能力**

**Goal:** 用量化指标作为阶段发布门槛。

**Requirements:** R19-R24

**Dependencies:** Unit 1, Unit 2, Unit 3

**Files:**
- Create: `apps/backend/src/modules/rag/quality/rag-quality.service.ts`
- Create: `apps/backend/src/modules/rag/quality/rag-quality.controller.ts`
- Modify: `apps/backend/src/modules/system/health.controller.ts`
- Test: `apps/backend/test/integration/rag-quality.spec.ts`
- Test: `apps/backend/test/integration/rag-run-replay.spec.ts`
- Create: `docs/standards/r2-rag-quality-gate-spec.md`
- Create: `docs/ops/r2-rag-rollout-rehearsal.md`

**Approach:**
- 聚合 recall/mrr/p95/degrade 等指标，输出 Gate 通过结论与明细。
- runId 回放载荷必须可复原 rewrite、召回、融合、重排与选择结果。
- health/运维视图输出最近 gate 摘要（阈值、样本量、通过/失败原因）。
- 发布前执行 rollback rehearsal（关闭 RAG lane 与恢复）并记录证据。

**Patterns to follow:**
- `apps/backend/src/modules/observability/gate-metrics.service.ts`

**Test scenarios:**
- Happy path: 指标达标时返回 `gatePass=true` 且输出完整证据摘要。
- Edge case: 样本不足时 `sampleReady=false`，禁止发布但保留观测数据。
- Error path: 指标聚合异常时 `gatePass=false`，并返回可诊断错误上下文。
- Integration: health 端点与 run replay 接口都能读取同一批次 Gate 摘要与回放数据。

**Verification:**
- R2 发布判定由统一报告自动得出，且回滚演练记录可复现。

## System-Wide Impact

- **Interaction graph:** LangGraph 主链新增 RAG 节点链，执行路径由单一 SQL 生成扩展为“检索-重排-生成”。
- **Error propagation:** 检索/重排失败默认降级，不应将故障传播为主链中断。
- **Security boundary:** `risk_tags` 进入 SQL 安全护栏后，会改变高风险查询的校验路径。
- **Observability surface:** health 与 trace 新增 R2 Gate 摘要字段，运维可直接判定是否可发布。
- **Contract coupling:** `retrieval_bundle` 将成为 R2->R3 复用合同，后续变更需保兼容。

## Risks & Dependencies

| Risk | Trigger | Mitigation | Residual Check |
|------|---------|------------|----------------|
| 检索链路引入额外延迟 | lane 叠加导致 P95 升高 | 分层超时 + lane 预算 + 自动降级 | R20 P95 门禁 |
| 二级重排成本波动 | 模型调用配额/时延不稳定 | 二级可选开关 + 超时自动回退一级 | R20 降级率与成本观测 |
| `risk_tags` 与安全链路口径漂移 | 检索标签与安全策略字段不一致 | 在 Unit 3 增加契约测试并复用既有 safety guard | 高风险查询回放核对 |
| 指标口径不统一导致误判 | Gate 与 health 统计分叉 | 统一 `r2-rag-quality-gate-spec` 字段定义 | Gate/health 一致性测试 |

## R2 Gate Metrics (Phase B Exit)

| Gate Metric | Threshold (R20) | Sample Rule | Fail Action |
|---|---|---|---|
| Recall@20 | >= 0.80 | 近 N 次评估样本满足最小样本数 | Gate fail，禁止发布 |
| MRR@10 | >= 0.65 | 同上 | Gate fail，禁止发布 |
| Retrieval + Rerank P95 | <= 800ms | 统计窗口与 health 摘要一致 | Gate fail，转入性能修复 |
| Degrade Rate | <= 5% | 统计检索/重排降级事件 | Gate fail，转入稳定性修复 |
| Replay Completeness | 100% 关键字段可回放 | 按 runId 抽样核验 | Gate fail，禁止发布 |
| Rollback Rehearsal | 每次上线前 1/1 成功 | 必须有当次记录 | 无记录即不得发布 |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-14-text2sql-r2-rag-implementation-detail-requirements.md](docs/brainstorms/2026-04-14-text2sql-r2-rag-implementation-detail-requirements.md)
- Related plan: [docs/plans/2026-04-17-002-feat-rag-r2-foundation-ingestion-index-plan.md](docs/plans/2026-04-17-002-feat-rag-r2-foundation-ingestion-index-plan.md)
