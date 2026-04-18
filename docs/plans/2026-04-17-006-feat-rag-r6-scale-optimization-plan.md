---
title: feat: R6 规模化与性能优化计划
type: feat
status: active
date: 2026-04-17
origin: docs/brainstorms/2026-04-14-text2sql-r2-rag-implementation-detail-requirements.md
deepened: 2026-04-17
---

# feat: R6 规模化与性能优化计划

## Overview

R6 阶段目标是让 R2-R5 能力在多数据源和高并发环境下可持续运行：在不破坏前序合同的前提下，建立规模化门禁、缓存与预算策略、可选图加速回退机制，以及可发布/可回滚的运维证据链。

## Execution Tracking

- 专用执行日志：[`docs/plans/2026-04-17-006-feat-rag-r6-scale-optimization-execution-log.md`](docs/plans/2026-04-17-006-feat-rag-r6-scale-optimization-execution-log.md)
- Ralph-Team 看板：[`docs/plans/2026-04-18-r6-ralph-team-progress.md`](docs/plans/2026-04-18-r6-ralph-team-progress.md)
- 主执行日志（跨阶段）：[`docs/plans/2026-04-17-001-feat-rag-text2sql-v1-3-phased-execution-log.md`](docs/plans/2026-04-17-001-feat-rag-text2sql-v1-3-phased-execution-log.md)
- R6 门禁规范：[`docs/standards/r6-scale-gate-spec.md`](docs/standards/r6-scale-gate-spec.md)
- R6 运行手册：[`docs/operations/r6-scale-runbook.md`](docs/operations/r6-scale-runbook.md)
- 当前状态：`GATE-R6=ready_for_decision`，`Unit 1-5=complete`

## Problem Frame

R2-R5 已具备可运行主链，但在多数据源扩张后会放大三个风险：

- 调度与索引生命周期失控，导致单源故障外溢到全局可用性。
- 缓存与预算缺乏可验证策略，导致“降延迟”与“控成本”目标互相冲突。
- 可选图加速若无明确回退与证据机制，会破坏 Postgres 主线的可回滚能力。

R6 需要把这些风险转化为量化门禁和标准化运行手册，确保发布决策依赖证据而不是经验判断。

## Requirements Trace

- R33-R36: 多数据源扩展、缓存分层、可选图加速与门禁保持。
- R4, R24: 阶段证据与回滚演练要求（见 origin 文档）。

## Scope Boundaries

- 不改变 R2-R5 的核心功能合同。
- 不引入“必须在线”第三方图运行时依赖；图加速仅作为可选能力。
- 可选图加速必须以 adapter 方式接入，且默认关闭、可审计回退到 Postgres 主线。
- 本计划不承载前端可视化改造，仅覆盖后端与运行治理。

## Context & Research

### Relevant Code and Patterns

- 调度与数据源：`apps/backend/src/modules/data/persistence/datasource.repository.ts`
- RAG 检索主链：`apps/backend/src/modules/rag/retrieval/rag-retrieval.service.ts`
- 健康与门禁摘要：`apps/backend/src/modules/system/health.controller.ts`
- 既有门禁模板：`docs/standards/r1-gate-and-rollout-spec.md`

### Origin Decisions Carried Forward

- 阶段上线必须产出可审计证据与回滚演练记录（see origin: `docs/brainstorms/2026-04-14-text2sql-r2-rag-implementation-detail-requirements.md`）。
- R6 只在 R5 闭环后进入，且不得以性能优化削弱安全与可观测门禁。

## Key Technical Decisions

- 决策 1：多数据源调度与索引生命周期解耦，按 datasource 进行失败隔离、重试与资源配额治理。
- 决策 2：缓存采用分层与版本化 key，预算策略采用“可解释降级阶梯”，并强制保留降级证据。
- 决策 3：图加速只通过 adapter 接入，使用熔断器 + 自动回退，回退后继续由 Postgres 主线提供服务。
- 决策 4：R6 发布门禁必须包含“样本量、窗口、阈值、阻断条件、证据文件”五要素，缺一不可。

## R6 Gate Contract (Quantitative)

| Gate 指标 | 默认阈值 | 统计窗口 | 样本要求 | 发布判定 |
|---|---|---|---|---|
| `datasourceIsolationViolationCount` | `== 0` | 最近 24h | `>= 100` 次多源构建任务 | 任意非 0 直接阻断 |
| `indexBuildSuccessRate` | `>= 0.98` | 最近 24h | `>= 200` 次构建 | 低于阈值阻断 |
| `orchestratorQueueWaitP95Ms` | `<= 20000` | 最近 6h | `>= 500` 次任务入队 | 连续 2 个窗口超阈值阻断 |
| `retrievalP95Ms` | `<= 700` | 最近 1h | `>= 1000` 次查询 | 连续 2 个窗口超阈值阻断 |
| `cacheEligibleHitRate` | `>= 0.55` | 最近 1h | `>= 500` 次可缓存查询 | 连续 3 个窗口低于阈值触发灰度冻结 |
| `staleCacheReadRate` | `<= 0.005` | 最近 24h | `>= 1000` 次缓存读取 | 超阈值阻断 |
| `budgetDegradeRate` | `<= 0.08` | 最近 1h | `>= 500` 次查询 | 超阈值触发流量回退与观察 |
| `graphFallbackActivationRate` | `<= 0.15` | 最近 1h | `>= 200` 次图通道请求 | 超阈值进入强制 Postgres-only 模式 |
| `securityGatePass` | `== true` | 发布前检查 | 必须具备完整安全检查报告 | 不通过即阻断 |

> 说明：阈值为 R6 首轮默认值，灰度后可按域分桶调整，但必须先更新 `docs/standards/r6-scale-gate-spec.md` 并附变更依据。

## Implementation Units

- [x] **Unit 1: 多数据源索引编排与隔离治理**

**Goal:** 支持多数据源并发构建、按源隔离与规模化门禁采集。

**Requirements:** R33

**Dependencies:** `docs/plans/2026-04-17-005-feat-rag-r4-delivery-sandbox-r5-memory-plan.md`

**Files:**
- Create: `apps/backend/src/modules/rag/orchestration/rag-datasource-orchestrator.service.ts`
- Create: `apps/backend/src/modules/rag/orchestration/rag-datasource-quota.policy.ts`
- Modify: `apps/backend/src/modules/rag/jobs/build-rag-index.job.ts`
- Modify: `apps/backend/src/modules/rag/quality/rag-quality.service.ts`
- Test: `apps/backend/test/integration/rag-multi-datasource-orchestrator.spec.ts`
- Test: `apps/backend/test/integration/rag-datasource-gate-metrics.spec.ts`
- Test: `apps/backend/test/e2e/rag-multi-datasource-isolation.e2e-spec.ts`

**Approach:**
- 每个 datasource 独立维护 `index_version`、`active_pointer`、`build_state`，禁止跨源共享可变状态。
- 编排器实现全局并发上限 + 每 workspace 配额 + 单 datasource 熔断。
- 采集隔离违规与队列等待指标，直接进入 R6 gate 报告。

**Patterns to follow:**
- `apps/backend/src/modules/data/persistence/datasource.repository.ts`

**Test scenarios:**
- Happy path: 10+ 数据源并发构建且 active 版本互不污染。
- Edge case: 单一数据源连续失败时仅该源进入熔断，其他源可继续发布。
- Edge case: 同 workspace 多源突发流量触发配额但不丢任务（延迟入队）。
- Error path: 编排器节点重启后可从持久化状态恢复任务并避免重复激活。
- Integration: `datasourceIsolationViolationCount` 与 `orchestratorQueueWaitP95Ms` 可被 health/gate 报告读取。

**Verification:**
- 多数据源场景下索引生命周期可预测、可恢复、可量化判定。

- [x] **Unit 2: 检索性能与缓存分层优化**

**Goal:** 在不破坏正确性的前提下稳定降低延迟并控制查询预算。

**Requirements:** R34

**Dependencies:** Unit 1

**Files:**
- Create: `apps/backend/src/modules/rag/perf/rag-query-cache.service.ts`
- Create: `apps/backend/src/modules/rag/perf/rag-budget-policy.ts`
- Create: `apps/backend/src/modules/rag/perf/rag-cache-key.factory.ts`
- Modify: `apps/backend/src/modules/rag/retrieval/rag-retrieval.service.ts`
- Modify: `apps/backend/src/modules/rag/rerank/rag-rerank.service.ts`
- Test: `apps/backend/test/integration/rag-performance-budget.spec.ts`
- Test: `apps/backend/test/integration/rag-cache-version-invalidation.spec.ts`
- Test: `apps/backend/test/perf/rag-cache-budget-load.spec.ts`

**Approach:**
- 引入 L1（短 TTL 热查询）+ L2（候选缓存）分层缓存，并强制 key 包含 `datasource_id/index_version/query_hash`。
- 预算策略统一评估 token/cost/latency 三维预算，超限走“降级阶梯”：降级重排模型 -> 缩小候选 -> 仅 lexical/dense 单路。
- 缓存与预算决策均记录 `decision_reason`，用于回放与审计。

**Patterns to follow:**
- `apps/backend/src/modules/data/cache/*`

**Test scenarios:**
- Happy path: 热点查询在可缓存路径命中，`retrievalP95Ms` 相比基线显著下降。
- Edge case: 索引版本切换后旧缓存全部失效，不出现跨版本脏读。
- Edge case: 预算接近阈值时按阶梯降级，不触发 hard fail。
- Error path: 缓存层不可用时回退实时检索且 `staleCacheReadRate` 保持可控。
- Integration: gate 报告可输出 `cacheEligibleHitRate`、`budgetDegradeRate`、`decision_reason` 统计。
- Performance: 压测下预算策略不会导致队列放大或雪崩重试。

**Verification:**
- 延迟、预算与正确性三项指标均满足 R6 默认门禁阈值。

- [x] **Unit 3: 可选图加速适配层（保留回退）**

**Goal:** 在必要时支持图加速扩展，同时确保任何异常都可自动回退到 Postgres 主线。

**Requirements:** R35

**Dependencies:** Unit 2

**Files:**
- Create: `apps/backend/src/modules/graph/adapter/graph-acceleration.adapter.ts`
- Create: `apps/backend/src/modules/graph/adapter/graph-acceleration-circuit-breaker.ts`
- Modify: `apps/backend/src/modules/graph/graph.service.ts`
- Test: `apps/backend/test/integration/graph-acceleration-fallback.spec.ts`
- Test: `apps/backend/test/integration/graph-acceleration-circuit-breaker.spec.ts`
- Test: `apps/backend/test/e2e/graph-acceleration-chaos.e2e-spec.ts`

**Approach:**
- 通过 adapter 抽象图查询实现，默认 `GRAPH_ACCELERATION_ENABLED=false`，主线仍为 Postgres。
- 引入熔断器：连续失败、超时率、延迟劣化任一超阈值即切换 Postgres-only 模式。
- 回退过程必须生成结构化事件：触发原因、持续时长、恢复条件、影响范围。

**Patterns to follow:**
- `apps/backend/src/modules/graph/graph.service.ts`

**Test scenarios:**
- Happy path: 图加速开启后特定查询类型延迟下降，结果与 Postgres 语义一致。
- Edge case: 部分图算子不支持时按操作粒度回退，不影响单请求完整返回。
- Edge case: 图通道抖动触发熔断后，系统稳定进入 Postgres-only 并维持可用。
- Error path: 图服务完全不可用时不影响在线服务 SLA，且 `graphFallbackActivationRate` 可观察。
- Integration: 功能开关、熔断状态、审计事件与 gate 报告字段一致。
- Fault-injection: chaos 场景下验证自动回退、人工恢复和二次触发行为。

**Verification:**
- 图加速保持“可选、可退、可审计”，不破坏回放与主线稳定性。

- [x] **Unit 4: R6 门禁规范与运行手册固化**

**Goal:** 确保规模化优化后仍满足安全与可观测要求。

**Requirements:** R36

**Dependencies:** Unit 1, Unit 2, Unit 3

**Files:**
- Create: `docs/standards/r6-scale-gate-spec.md`
- Create: `docs/operations/r6-scale-runbook.md`
- Modify: `apps/backend/src/modules/system/health.controller.ts`
- Modify: `apps/backend/src/modules/rag/quality/rag-quality.controller.ts`
- Test: `apps/backend/test/integration/r6-gate-readiness.spec.ts`

**Execution status note (2026-04-18):**
- doc-track complete: `docs/standards/r6-scale-gate-spec.md`、`docs/operations/r6-scale-runbook.md` 已创建并与 R6 Gate Contract 对齐。
- code/test track complete: `health.controller` 已接入 R6 gate 摘要，`rag-quality.service` 已产出 R6 门禁字段，`r6-gate-readiness.spec.ts` 已覆盖 sample_not_ready 与 freeze 判定。

**Approach:**
- 规范化 R6 gate 报告结构：指标值、阈值、窗口、样本量、发布结论、阻断原因。
- 输出运行手册：灰度步骤、发布判定、故障分级、应急处置、回滚演练与复盘模板。
- 将 R6 gate 摘要接入 `/health`，保证运维面与发布证据面字段对齐。

**Patterns to follow:**
- `docs/standards/r1-gate-and-rollout-spec.md`

**Test scenarios:**
- Happy path: 全部指标达标且样本充足时 `gatePass=true`。
- Edge case: 样本不足时 `sampleReady=false` 且明确标记不可发布。
- Edge case: 单项指标临界波动触发灰度冻结而非直接全量发布。
- Error path: 安全检查失败或审计字段缺失时直接阻断发布。
- Integration: `health`、gate 报告、runbook 检查项三者字段一致。

**Verification:**
- R6 发布/冻结/回滚决策可依据统一证据链自动化判定。

- [x] **Unit 5: R6 测试场景打包与发布证据自动归档**

**Goal:** 补齐测试场景完整性并让发布/回滚证据可重复产出。

**Requirements:** R33-R36, R4, R24

**Dependencies:** Unit 1, Unit 2, Unit 3, Unit 4

**Files:**
- Create: `apps/backend/test/perf/rag-r6-mixed-load.spec.ts`
- Create: `apps/backend/test/e2e/r6-release-rollback-rehearsal.e2e-spec.ts`
- Create: `apps/backend/scripts/collect-r6-evidence.mjs`
- Modify: `.github/workflows/backend-prisma-quality.yml`
- Test: `apps/backend/test/integration/r6-evidence-pipeline.spec.ts`

**Approach:**
- 把功能、性能、故障注入、回滚演练测试统一映射到 R6 gate 指标字段。
- CI 产出标准化证据包（json + markdown），作为发布审批输入。
- 明确“证据缺失即不可发布”规则，避免人工补口径。

**Patterns to follow:**
- `.github/workflows/backend-prisma-quality.yml`
- `apps/backend/test/integration/rag-quality.spec.ts`

**Test scenarios:**
- Happy path: CI 生成完整证据包并通过发布前检查。
- Edge case: 某类测试被 skip 或样本不足时，证据包标记 `incomplete=true`。
- Error path: 证据归档脚本失败时流水线 fail-fast。
- Integration: 发布检查仅读取证据包即可得出 Gate 结论。
- Rehearsal: 回滚演练覆盖“图加速故障 + 预算失控 + 单源构建失败”复合场景。

**Verification:**
- R6 具备“测试完整性可检查、证据可归档、回滚可演练”的发布基础。

## Runbook & Release/Rollback Evidence

| 证据项 | 产物路径 | 产出时机 | 发布用途 |
|---|---|---|---|
| R6 Gate 汇总 | `data/reports/r6/gate-summary.json` | 每次候选发布前 | 自动发布判定 |
| 缓存与预算验证报告 | `data/reports/r6/cache-budget-validation.json` | 压测与灰度阶段 | 延迟/成本是否可控 |
| 图加速回退演练报告 | `data/reports/r6/graph-fallback-chaos.json` | 每次图能力变更后 | 验证自动回退有效 |
| 发布检查清单 | `data/reports/r6/release-checklist.md` | 发布审批时 | 人工复核与签字 |
| 回滚演练记录 | `data/reports/r6/rollback-rehearsal.md` | 灰度前与重大变更后 | 回滚流程可复现证明 |

发布阻断规则：

- 任一 Gate 指标硬阻断条件命中。
- 证据项缺失或 `incomplete=true`。
- 安全或审计相关检查项失败。

回滚触发规则：

- `retrievalP95Ms` 或 `indexBuildSuccessRate` 连续 2 个窗口异常。
- `graphFallbackActivationRate` 超过阈值且持续 1 个窗口以上。
- 出现跨数据源污染、审计断链或安全红线失败。

## Test Coverage Matrix

| 场景域 | Unit 测试 | Integration 测试 | E2E/演练 | Perf/Chaos |
|---|---|---|---|---|
| 多数据源隔离与生命周期 | ✅ | ✅ | ✅ | ✅ |
| 缓存命中、失效与脏读防护 | ✅ | ✅ | ✅ | ✅ |
| 预算策略与降级阶梯 | ✅ | ✅ | ✅ | ✅ |
| 图加速熔断与回退 | ✅ | ✅ | ✅ | ✅ |
| 门禁摘要与运行手册一致性 | ✅ | ✅ | ✅ | - |
| 发布证据归档与回滚流程 | ✅ | ✅ | ✅ | ✅ |

## System-Wide Impact

- **Interaction graph:** R6 同时影响编排器、检索链路、图查询适配层与 health/gate 汇总面，需确保跨模块变更按阶段发布。
- **Error propagation:** 调度异常、缓存异常、图加速异常必须在各自边界降级吸收，避免扩散到 SQL 主链不可用。
- **State lifecycle risks:** 多数据源并发下需防止索引版本错切、缓存跨版本脏读、回滚状态不一致。
- **API surface parity:** `health`、gate 报告与 runbook 检查项字段必须保持一致，避免发布判定口径漂移。
- **Integration coverage:** 仅单元测试不足以证明 R6 可发布，必须覆盖多源压测、故障注入、回滚演练和证据归档流水线。
- **Unchanged invariants:** R2-R5 的安全红线、审计追踪与 fail-closed 行为在 R6 优化后必须保持不变。

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| 多数据源并发导致资源争用 | 并发配额与任务隔离 |
| 缓存策略导致错误命中 | 版本化 key + 严格失效策略 |
| 图加速引入运维复杂度 | 默认关闭 + 适配层回退 |
| 门禁阈值不适配真实业务分布 | 首轮灰度按域分桶观测并版本化调参 |
| 发布证据链不完整导致误发布 | 证据缺失即阻断，CI 强制归档 |

## Documentation / Operational Notes

- 将 R6 默认阈值与调参流程写入 `docs/standards/r6-scale-gate-spec.md`，后续阈值变更需保留依据与生效日期。
- 运行手册 `docs/operations/r6-scale-runbook.md` 需包含灰度策略、告警路由、回滚剧本和复盘模板。
- 发布评审时必须附 `data/reports/r6/` 证据包；证据不完整时禁止放行。

## Boundary & Edge Case Catalog

| ID | 场景 | 归属 Unit | 处理策略 |
|---|---|---|---|
| B-006-1 | 用户查询涉及多个数据源（跨源检索） | Unit 1 | 首版仅支持单源检索路由（按会话绑定的 datasource），跨源查询返回不支持提示并记录需求信号 |
| B-006-2 | 大量缓存同时过期（缓存雪崩） | Unit 2 | TTL 增加随机 jitter（±10%），热点 key 预热策略，缓存层不可用时回退实时检索并限流 |
| B-006-3 | 图查询返回部分结果（部分算子成功、部分失败） | Unit 3 | 整体回退到 Postgres 主线（不接受部分图结果），记录失败算子详情供后续优化 |
| B-006-4 | workspace 配额已满时新增数据源 | Unit 1 | 新增数据源进入 pending 队列并通知管理员，不静默丢弃，待配额释放后自动恢复 |
| B-006-5 | 门禁阈值灰度调参后发现误放行 | Unit 4 | 阈值变更需版本化并记录变更依据，误放行后可回退到旧阈值版本，并追溯受影响的发布记录 |
| B-006-6 | 编排器节点重启导致任务状态不一致 | Unit 1 | 任务状态持久化到数据库，重启后从持久化状态恢复，设置最大重试次数防止无限重试 |
| B-006-7 | 多数据源并发构建导致数据库连接池耗尽 | Unit 1 | 全局构建并发上限 + 每源连接预算，连接不足时排队等待而非失败 |
| B-006-8 | 预算策略降级阶梯全部触发（极端负载） | Unit 2 | 最终降级到仅 lexical 单路 + 无重排，保证有结果返回，附 `degrade_level=maximum` 标记 |

## Open Questions

### Deferred to Implementation

- [Affects R34] 预算阈值是否按业务域（OLTP/OLAP）分桶配置，首轮灰度后需用真实分布校准。
- [Affects R35] 图加速候选实现（仅查询加速 vs 全链路算子）在当前成本窗口下的 ROI 分界点。
- [Affects R36] R6 门禁是否纳入跨天季节性波动修正，需要 2-4 周生产样本验证。

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-14-text2sql-r2-rag-implementation-detail-requirements.md](docs/brainstorms/2026-04-14-text2sql-r2-rag-implementation-detail-requirements.md)
- Related plan: [docs/plans/2026-04-17-005-feat-rag-r4-delivery-sandbox-r5-memory-plan.md](docs/plans/2026-04-17-005-feat-rag-r4-delivery-sandbox-r5-memory-plan.md)
