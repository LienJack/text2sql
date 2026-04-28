---
title: feat: R3 语义稳定化与注册中心计划
type: feat
status: ready_for_decision
date: 2026-04-17
origin: docs/brainstorms/2026-04-14-text2sql-r2-rag-implementation-detail-requirements.md
deepened: 2026-04-17
---

# feat: R3 语义稳定化与注册中心计划

## Overview

本阶段聚焦 R3：稳定三段式规划链路、建设语义层注册中心与技能注册中心，并将 semantic version 锁与 planner cache 纳入统一治理。该阶段是 R2 检索闭环与 R4/R5 交付-记忆闭环之间的唯一稳定性桥梁。

## Execution Tracking

- 专用执行日志：[`docs/plans/2026-04-17-004-feat-rag-r3-semantic-registry-execution-log.md`](docs/plans/2026-04-17-004-feat-rag-r3-semantic-registry-execution-log.md)
- 主执行日志（跨阶段）：[`docs/plans/2026-04-17-001-feat-rag-text2sql-v1-3-phased-execution-log.md`](docs/plans/2026-04-17-001-feat-rag-text2sql-v1-3-phased-execution-log.md)
- 当前状态：`GATE-R3=ready_for_decision`，`Unit 1-4=complete`

## Problem Frame

R2 解决了“检索得到上下文”，但尚未完全解决“语义定义长期稳定演进”。若无语义注册中心和版本锁，新增术语、指标、技能后容易出现同义漂移与行为不一致，并且会直接传导到 R4 的证据解释与 R5 的记忆晋升质量。

## Requirements Trace

- R25: 建立语义注册中心（实体、定义、绑定）并版本化。
- R26: 引入 Skill Registry 与检索协同，统一上下文与技能依赖。
- R27: 稳定三段式规划链路（Intent/Semantic/Physical）并提供回退。
- R22-R24（跨阶段延续）: trace/span 可观测、风险标签传播、回滚演练证据。
- 连续性约束（对应 R3 -> R4/R5）: 本阶段退出产物必须作为 `docs/plans/2026-04-17-005-feat-rag-r4-delivery-sandbox-r5-memory-plan.md` 的入场前置。

## Scope Boundaries

- 本阶段不落地 R4 沙箱执行。
- 本阶段不引入 R6 规模化优化。

## Context & Research

### Relevant Code and Patterns

- 主链与状态基线：`apps/backend/src/modules/agent/graph/langgraph.runtime.ts`、`apps/backend/src/modules/agent/graph/langgraph.state.ts`
- 现有检索主线：`apps/backend/src/modules/rag/retrieval/*`
- 工具与注册模式参考：`apps/backend/src/modules/llm/tools/*`
- 观测与门禁基线：`apps/backend/src/modules/observability/*`

### Institutional Learnings

- 历史门禁执行经验（见 `.omx/notepad.md` 2026-04-12~2026-04-17 记录）显示：缺少“契约冻结 + 回放一致性”时，阶段切换时最容易发生口径漂移。

### External References

- `docs/RAG-Text2SQL-可行方案-v1.3.md`
- `docs/plans/2026-04-17-003-feat-rag-r2-retrieval-agent-gate-plan.md`

## Key Technical Decisions

- 决策 1：语义定义必须版本化，planner 使用显式版本锁。  
  理由：R3 是 R4/R5 的语义入口，未锁版本会导致 Evidence 与 Memory 解释基线不一致。
- 决策 2：术语/指标/技能绑定统一通过 registry 查询，避免多处散落配置。  
  理由：多入口配置会放大 drift 风险，且难以形成单一审计链。
- 决策 3：规划失败时优先回退到上一个可验证语义版本。  
  理由：R27 与 R24 共同要求“失败可回退且可复现”，必须优先稳定性。
- 决策 4：planner cache key 强制包含 semantic version。  
  理由：不带版本的缓存命中会引入跨版本污染，破坏 R3 门禁可信度。

## Open Questions

### Resolved During Planning

- 是否在 R3 引入独立第三方语义运行时：否，沿用现有 NestJS + Prisma + LangGraph 主线（见 origin 决策约束）。
- 是否把 Skill Registry 延后到 R4：否，必须与 R3 同步落地，否则 R4 交付解释缺少技能依赖证据。

### Resolve Before Phase Entry

- [Affects R27,R24][Blocking] R2 阶段需先冻结 `retrieval_bundle` 与 run replay 载荷字段版本，避免 R3 回放测试使用漂移输入。
- [Affects R25][Blocking] 语义版本号规则（单调递增 + 域内唯一）需在阶段启动前确认并写入标准文档。

### Deferred to Implementation

- [Affects R27][Technical] planner cache TTL 与淘汰策略按真实流量压测结果微调。
- [Affects R26][Technical] Skill Registry 候选解释字段的压缩策略（日志体积与可读性的平衡）。

## Boundary & Edge Case Catalog

| ID | 场景 | 归属 Unit | 处理策略 |
|---|---|---|---|
| B-004-1 | 语义版本回退后 planner cache 中残留新版本缓存 | Unit 4 | 回退语义版本时触发 cache 全量失效（key 含 semantic_version 保证不命中），并记录失效事件 |
| B-004-2 | 语义实体间存在循环绑定关系 | Unit 1 | registry 写入时执行有向图环检测，发现环时拒绝写入并返回循环路径详情 |
| B-004-3 | Skill Registry 与 Semantic Registry 版本不同步 | Unit 2 | planner 执行时原子读取两个 registry 的版本快照，不允许跨快照混合使用，不一致时降级并记录 |
| B-004-4 | 并发语义版本发布（多管理员同时操作） | Unit 1 | 版本号生成采用数据库序列或乐观锁，冲突时拒绝后提交并返回冲突版本详情 |
| B-004-5 | 语义版本数爆炸（历史版本堆积） | Unit 1 | 引入版本生命周期策略：deprecated 版本保留窗口（如 30 天），过期后归档或清理 |
| B-004-6 | planner cache 命中但底层语义实体已被删除 | Unit 4 | 缓存命中后二次校验语义版本有效性，失效时清除缓存条目并重新规划 |
| B-004-7 | registry 服务不可用时的规划链路 | Unit 3 | fail-open 到最近一次本地缓存的稳定版本，附 `degrade_reason=registry_unavailable`，禁止 fail-closed 中断用户请求 |

## Implementation Units

- [x] **Unit 1: 建立 Semantic Layer Registry 数据模型与服务**

**Goal:** 提供统一语义实体、定义、绑定查询入口。

**Requirements:** R25, R27, R22

**Dependencies:** `docs/plans/2026-04-17-003-feat-rag-r2-retrieval-agent-gate-plan.md`（R2 Gate 通过且回放字段冻结）

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`
- Create: `apps/backend/prisma/migrations/<timestamp>_r3_semantic_registry/migration.sql`
- Create: `apps/backend/src/modules/semantic-registry/semantic-registry.module.ts`
- Create: `apps/backend/src/modules/semantic-registry/semantic-registry.service.ts`
- Test: `apps/backend/test/unit/semantic-registry.service.spec.ts`
- Test: `apps/backend/test/integration/semantic-registry.spec.ts`
- Test: `apps/backend/test/integration/r3-semantic-registry-migration.spec.ts`

**Approach:**
- 语义实体与绑定关系进入专门 registry 模块。
- 每次发布生成语义版本号并记录变更摘要。
- Schema 变更通过 Prisma 迁移链路落地，并同步保留 client 生成与空库回放校验证据。

**Patterns to follow:**
- `apps/backend/src/modules/agent/graph/*`（注：planner 子目录需在本阶段新建，参考 agent/graph 模式）

**Test scenarios:**
- Happy path: 按 `domain + term + semantic_version` 查询返回唯一绑定，且包含可审计摘要字段。
- Edge case: 同一术语多版本并存时，默认返回 active 版本；指定旧版本可稳定回读。
- Error path: 请求不存在版本时返回受控降级结果，并打出结构化错误码与 `risk_tags`。
- Integration: registry 发布后可被 planner 在同一 run 内读取，trace 中记录 `semantic_version`。
- Integration: 从空库回放 R2->R3 迁移链路后，registry 表结构、唯一约束和关联关系保持一致。

**Verification:**
- registry 数据可稳定支撑 planner 语义查询，且具备可回放版本证据。
- R3 数据层改动具备完整门禁证据：迁移产物、client 生成记录、空库回放报告。

- [x] **Unit 2: 落地 Skill Registry 与语义检索协同**

**Goal:** 将技能依赖纳入检索与规划上下文。

**Requirements:** R26, R25, R22

**Dependencies:** Unit 1，R2 检索输出字段与 R3 registry 字段完成映射约定

**Files:**
- Create: `apps/backend/src/modules/skill-registry/skill-registry.module.ts`
- Create: `apps/backend/src/modules/skill-registry/skill-registry.service.ts`
- Modify: `apps/backend/src/modules/rag/retrieval/rag-retrieval.service.ts`
- Test: `apps/backend/test/unit/skill-registry.service.spec.ts`
- Test: `apps/backend/test/integration/skill-registry-rag.spec.ts`

**Approach:**
- 定义技能对象元数据和语义标签映射。
- 检索阶段将相关技能证据并入候选解释。

**Patterns to follow:**
- `apps/backend/src/modules/llm/tools/*`

**Test scenarios:**
- Happy path: 查询命中术语时返回关联技能提示，并可在 evidence 中回溯技能来源。
- Edge case: 无技能绑定时主检索结果不变，仅返回空技能上下文。
- Error path: skill registry 异常时检索链路降级继续，并记录 `degrade_reason=skill_registry_unavailable`。
- Integration: stream 与 sync 两类响应中均可看到一致的技能依赖证据字段。

**Verification:**
- 技能上下文可在不破坏 R2 兼容性的前提下注入主链，并保持跨接口字段一致。

- [x] **Unit 3: 实现 planner 版本锁与语义回退链路**

**Goal:** 保证语义变更不会破坏在线稳定性。

**Requirements:** R27, R23, R24

**Dependencies:** Unit 1, Unit 2

**Files:**
- Create: `apps/backend/src/modules/agent/planner/planner-version-lock.service.ts`
- Modify: `apps/backend/src/modules/agent/nodes/build-semantic-query.node.ts`
- Modify: `apps/backend/src/modules/agent/nodes/build-physical-plan.node.ts`
- Test: `apps/backend/test/unit/planner-version-lock.service.spec.ts`
- Test: `apps/backend/test/integration/planner-version-lock.spec.ts`

**Approach:**
- 每次 planner 执行记录语义版本，并在失败时支持回退。
- 对关键语义字段建立兼容性检查器。

**Patterns to follow:**
- `apps/backend/src/modules/agent/nodes/*`（注：planner 子目录需在本阶段新建于 `agent/` 下）

**Test scenarios:**
- Happy path: 新版本语义可正常驱动 physical plan，输出包含版本锁信息。
- Edge case: 语义版本缺失时自动回退上一个稳定版本，且结果被标记为降级路径。
- Error path: 版本不兼容时 fail-closed 拒绝执行高风险路径并保留风险标签。
- Integration: `runId` 回放可完整复原 intent/semantic/physical 三段式版本选择与回退过程。

**Verification:**
- planner 在语义变更期间仍可稳定运行，并可提供回退演练证据。

- [x] **Unit 4: 引入 planner cache 与一致性回放测试**

**Goal:** 降低规划开销并验证语义一致性门禁。

**Requirements:** R27, R22, R24

**Dependencies:** Unit 3

**Files:**
- Create: `apps/backend/src/modules/agent/planner/planner-cache.service.ts`
- Modify: `apps/backend/src/modules/data/persistence/chat.repository.ts`
- Test: `apps/backend/test/unit/planner-cache.service.spec.ts`
- Test: `apps/backend/test/integration/planner-cache-replay.spec.ts`
- Test: `apps/backend/test/integration/r3-gate-rehearsal.spec.ts`

**Approach:**
- cache key 包含 datasource + query hash + semantic version。
- 回放测试验证缓存命中与非命中一致性。
- 阶段退出前执行 gate rehearsal，沉淀回滚与重放证据。

**Patterns to follow:**
- `apps/backend/src/modules/data/cache/*`

**Test scenarios:**
- Happy path: 同输入同版本命中缓存并返回一致结果（含版本与证据一致性断言）。
- Edge case: 语义版本变化后缓存自动失效，且新结果不复用旧版本缓存。
- Error path: 缓存层异常时回退实时规划，不影响 SQL 主链可用性。
- Integration: 回放报告可读出语义版本、缓存状态、降级原因与 risk tags。

**Verification:**
- R3 语义一致性门禁具备可量化证据，并可作为 R4/R5 入场凭证。

## System-Wide Impact

- **Interaction graph:** 新增 semantic-registry/skill-registry/planner-version-lock/planner-cache 四类模块，影响检索 -> 规划 -> 交付全链路。
- **Error propagation:** registry/lock/cache 任一失败必须在 planner 层受控降级，不向外暴露未分类异常。
- **State lifecycle risks:** 语义版本切换窗口内可能出现缓存污染、跨版本读写与回放偏差，需要版本锁 + 缓存版本键兜底。
- **API surface parity:** sync 与 stream 输出中的语义版本、技能证据、降级原因字段必须保持一致。
- **Integration coverage:** 仅单元测试不足以证明跨阶段稳定性，必须覆盖 run 回放、门禁报告与回滚演练。
- **Unchanged invariants:** R2 既有 retrieval_bundle 契约、SQL 安全链路与 fail-closed 行为不因 R3 新模块改变。

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| 语义版本爆炸导致维护复杂 | 引入版本生命周期策略与弃用窗口，按 domain 管理版本 |
| registry 与 planner 契约漂移 | 增加契约测试与回放校验，冻结阶段字段 |
| cache 误命中影响正确性 | 强制 key 包含 semantic version，命中后复核版本一致性 |
| R3 退出产物不完整导致 R4/R5 返工 | 阶段退出时固化交接清单（semantic snapshot、skill digest、replay report） |

## Documentation / Operational Notes

- 更新 `docs/standards/llm-stream-tool-migration-spec.md` 中 R3 新增字段口径（语义版本、技能证据、降级原因）并保持 sync/stream 对齐。
- 产出 R3 gate 证据包（建议目录：`docs/reports/rag/r3/`），最少包含：指标快照、关键测试结果、回滚演练记录、回放样本。
- 将 R3 阶段退出判定写入 R4/R5 计划的入场检查清单，防止跨阶段隐式假设。
- 同步维护 `docs/standards/backend-prisma-migration-spec.md` 一致性，避免 R3 与 R2 的 Prisma 门禁口径漂移。

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-14-text2sql-r2-rag-implementation-detail-requirements.md](docs/brainstorms/2026-04-14-text2sql-r2-rag-implementation-detail-requirements.md)
- Related plan: [docs/plans/2026-04-17-003-feat-rag-r2-retrieval-agent-gate-plan.md](docs/plans/2026-04-17-003-feat-rag-r2-retrieval-agent-gate-plan.md)
- Related plan: [docs/plans/2026-04-17-005-feat-rag-r4-delivery-sandbox-r5-memory-plan.md](docs/plans/2026-04-17-005-feat-rag-r4-delivery-sandbox-r5-memory-plan.md)
