---
title: feat: R4 交付层与 R5 记忆闭环计划
type: feat
status: active
date: 2026-04-17
origin: docs/brainstorms/2026-04-14-text2sql-r2-rag-implementation-detail-requirements.md
deepened: 2026-04-17
---

# feat: R4 交付层与 R5 记忆闭环计划

## Overview

本阶段合并推进 R4 与 R5：先把回答协议升级为 Answer/Evidence/Artifact 三层，再接通记忆晋升与增量刷新闭环，确保“可解释输出”和“可持续学习”同时成立。该阶段承接 R3 语义稳定产物，并为 R6 的规模化优化提供可审计、可回放的数据基础。

## Execution Tracking

- 专用执行日志：[`docs/plans/2026-04-17-005-feat-rag-r4-delivery-sandbox-r5-memory-execution-log.md`](docs/plans/2026-04-17-005-feat-rag-r4-delivery-sandbox-r5-memory-execution-log.md)
- 主执行日志（跨阶段）：[`docs/plans/2026-04-17-001-feat-rag-text2sql-v1-3-phased-execution-log.md`](docs/plans/2026-04-17-001-feat-rag-text2sql-v1-3-phased-execution-log.md)
- 当前状态：`GATE-R4R5=ready_for_decision`，`Unit 1-4=complete`，`证据包=ready`

## Problem Frame

R3 解决语义稳定后，系统仍需要把可解释证据稳定交付给调用方，并把有效反馈沉淀为长期记忆。没有这一步，RAG 的价值无法持续复利，且 R6 的优化将缺乏可信数据闭环。

## Requirements Trace

- R28: 落地 Answer/Evidence/Artifact 三层交付协议并保持合同一致。
- R29: 上线受限后处理沙箱（禁网、禁任意文件写、禁未授权进程）。
- R30: 建立 Candidate -> Verified -> Production 记忆晋升机制。
- R31: 支持事件驱动增量刷新（DDL、术语晋升、成功 SQL 反馈）。
- R32: 提供 `event -> index_version -> run trace` 审计回放链路。
- R23-R24（跨阶段延续）: 风险标签、回滚演练证据与 fail-closed 策略持续生效。
- 连续性约束（对应 R5 -> R6）: 本阶段退出产物必须作为 `docs/plans/2026-04-17-006-feat-rag-r6-scale-optimization-plan.md` 的入场前置。

## Scope Boundaries

- 本阶段不实现 R6 多数据源规模优化。
- 本阶段不引入前端大型可视化重构。

## Context & Research

### Relevant Code and Patterns

- 会话与响应合同基线：`apps/backend/src/modules/chat/chat.service.ts`、`packages/shared-types/src/api.ts`
- 安全守卫与 fail-closed 参考：`apps/backend/src/modules/agent/sql/tools/sql-safety.guard.ts`
- 事件与反馈模式参考：`apps/backend/src/modules/observability/*`、`apps/backend/src/modules/data/persistence/audit-log.repository.ts`（注：`graph/events` 和 `graph/feedback` 目录需在本阶段新建）
- 健康检查与门禁摘要：`apps/backend/src/modules/system/health.controller.ts`

### Institutional Learnings

- 历史执行记录显示：若无统一交付合同与审计链路，后续“问题回放/责任定位/版本回退”成本会显著升高（见 `.omx/notepad.md` 最近阶段门禁记录）。

### External References

- `docs/RAG-Text2SQL-可行方案-v1.3.md`
- `docs/plans/2026-04-17-004-feat-rag-r3-semantic-registry-plan.md`
- `docs/plans/2026-04-17-006-feat-rag-r6-scale-optimization-plan.md`

## Key Technical Decisions

- 决策 1：交付协议和执行层解耦，避免输出格式变更影响 SQL 执行主流程。  
  理由：R28 要求结构化交付，但不能破坏现有主链可用性与兼容合同。
- 决策 2：沙箱默认 fail-closed，安全优先于功能扩展。  
  理由：R29 与 R23 要求高风险路径可控，禁止“后处理能力”反向放大攻击面。
- 决策 3：记忆晋升必须带审计链路，禁止黑箱自动学习。  
  理由：R30-R32 明确要求可追责与可回放，否则无法支撑生产治理。
- 决策 4：事件消费采用幂等键 + 重试/死信策略。  
  理由：R31 在高并发和重复事件下需要确定性结果，避免重复写入或状态污染。

## Open Questions

### Resolved During Planning

- R4 与 R5 是否拆成两个独立阶段文档：否，本轮保持同一计划文件，但以 Unit 边界区分交付层与记忆层。
- 是否允许沙箱失败阻断所有回答：否，沙箱失败只阻断后处理，主回答必须保留并附失败证据。

### Resolve Before Phase Entry

- [Affects R28,R24][Blocking] 需确认 R3 退出产物中的 `semantic_version` 与技能证据字段已在 sync/stream 合同中冻结。
- [Affects R29][Blocking] 安全团队需确认沙箱策略白名单最小集合，避免上线后频繁热修策略。

### Deferred to Implementation

- [Affects R30][Technical] Candidate->Verified 的门槛参数（样本数、成功率、风险分）在灰度数据到齐后微调。
- [Affects R31][Technical] 事件重试窗口与 DLQ 保留时长按真实吞吐与运维成本联合优化。

## Boundary & Edge Case Catalog

| ID | 场景 | 归属 Unit | 处理策略 |
|---|---|---|---|
| B-005-1 | Evidence 引用的 selected_context 对应索引版本已 deprecated/清理 | Unit 1 | evidence 中保留索引版本快照摘要（非引用），回放时若原始数据不可用则标记 `evidence_stale=true` |
| B-005-2 | 同一 candidate 被多个事件同时触发晋升 | Unit 3 | 状态机 + 幂等键保证仅一次状态迁移，重复触发返回当前状态而非重复执行 |
| B-005-3 | 沙箱任务内存/CPU 耗尽但未超时（僵死状态） | Unit 2 | 除时间超时外增加资源水位监控，达到硬限制时强制 kill 并记录 `sandbox_oom_killed` 审计事件 |
| B-005-4 | 增量刷新与全量构建同时运行（索引版本冲突） | Unit 4 | 增量刷新检测到正在进行全量构建时主动让步（skip + 记录），全量构建完成后增量自动重试 |
| B-005-5 | DLQ 积压超过阈值 | Unit 4 | 设置 DLQ 深度告警阈值（建议 ≥ 100 条），超阈值触发运维告警并暂停非关键事件消费 |
| B-005-6 | 记忆晋升写入失败后的补偿 | Unit 3 | 写入失败时状态回滚到迁移前，生成补偿事件进入重试队列，连续失败 N 次后进入人工审核 |
| B-005-7 | 交付映射层收到格式异常的 retrieval_bundle | Unit 1 | 对输入进行 schema 校验，不合规时走降级路径（仅返回 answer），记录 `delivery_input_invalid` |
| B-005-8 | 沙箱策略白名单更新后的版本一致性 | Unit 2 | 策略变更需版本化并重启生效，运行中的沙箱实例使用启动时的策略版本，不热加载 |

## Implementation Units

- [x] **Unit 1: 落地 Answer/Evidence/Artifact 三层协议**

**Goal:** 统一响应协议，支持可解释结果与后续扩展。

**Requirements:** R28, R23, R24

**Dependencies:** `docs/plans/2026-04-17-004-feat-rag-r3-semantic-registry-plan.md`（R3 gatePass，合同字段冻结）

**Files:**
- Modify: `packages/shared-types/src/api.ts`
- Create: `apps/backend/src/modules/delivery/delivery-contract.mapper.ts`
- Modify: `apps/backend/src/modules/chat/chat.service.ts`
- Test: `packages/shared-types/src/api.contract.spec.ts`
- Test: `apps/backend/test/unit/delivery-contract.mapper.spec.ts`
- Test: `apps/backend/test/integration/delivery-contract.spec.ts`

**Approach:**
- 在保持向后兼容前提下扩展响应字段层次。
- evidence 字段必须可关联 selected_context 与 retrieval logs。

**Patterns to follow:**
- `packages/shared-types/src/api.ts`

**Test scenarios:**
- Happy path: 返回三层结构且前端可消费，answer/evidence/artifact 字段语义完整。
- Edge case: 无 artifact 场景下结构仍完整，且不影响历史调用方兼容解析。
- Error path: 交付映射失败时回退基础 answer、记录错误并附 `risk_tags=delivery_mapper_failed`。
- Integration: stream 与 sync 接口字段一致，且可关联同一 `runId` 的 evidence 证据。

**Verification:**
- 同步与流式响应均可提供可解释证据结构。

- [x] **Unit 2: 上线受限后处理沙箱**

**Goal:** 在可控安全边界内支持后处理能力。

**Requirements:** R29, R23, R24

**Dependencies:** Unit 1

**Files:**
- Create: `apps/backend/src/modules/delivery/sandbox/sandbox-runtime.service.ts`
- Create: `apps/backend/src/modules/delivery/sandbox/sandbox-policy.ts`
- Test: `apps/backend/test/unit/sandbox-policy.spec.ts`
- Test: `apps/backend/test/integration/sandbox-isolation.spec.ts`
- Test: `apps/backend/test/integration/sandbox-failover.spec.ts`

**Approach:**
- 默认禁网、禁任意文件写、禁未授权进程。
- 运行异常时主链回退并保留失败证据。

**Patterns to follow:**
- `apps/backend/src/modules/agent/sql/tools/sql-safety.guard.ts`

**Test scenarios:**
- Happy path: 合规后处理任务可执行，且产物可附着到 artifact 层。
- Edge case: 超时任务被强制终止并记录，主回答按降级策略继续返回。
- Error path: 越权访问被拦截且 fail-closed，记录审计事件和风险标签。
- Integration: 沙箱失败不影响主回答返回，且 run replay 可复原失败上下文。

**Verification:**
- 攻击样例集阻断率达到 100%。

- [x] **Unit 3: 建立 Candidate->Verified->Production 晋升流**

**Goal:** 让成功经验形成可治理的长期记忆。

**Requirements:** R30, R32

**Dependencies:** Unit 1

**Files:**
- Create: `apps/backend/src/modules/memory/memory-promotion.service.ts`
- Create: `apps/backend/src/modules/memory/memory-promotion-policy.ts`
- Test: `apps/backend/test/unit/memory-promotion-policy.spec.ts`
- Test: `apps/backend/test/integration/memory-promotion.spec.ts`
- Test: `apps/backend/test/integration/memory-promotion-audit.spec.ts`

**Approach:**
- 晋升过程采用明确状态机与人工/规则门槛。
- 每次晋升产生日志与可追溯变更记录。

**Patterns to follow:**
- `apps/backend/src/modules/data/persistence/audit-log.repository.ts`（事件/反馈模式参考）

**Test scenarios:**
- Happy path: 满足门槛的候选可自动晋升，状态迁移与审计记录一致。
- Edge case: 证据不足时保持在 Candidate，并返回结构化拒绝原因。
- Error path: 晋升写入失败时状态回滚并生成补偿事件。
- Integration: 晋升结果可被检索链路消费，且 run trace 可回溯该记忆版本来源。

**Verification:**
- 记忆状态迁移可观测且可回放。

- [x] **Unit 4: 事件驱动增量刷新与审计回放链路**

**Goal:** 打通 DDL/术语/成功 SQL 事件到索引更新与审计回放。

**Requirements:** R31, R32, R24

**Dependencies:** Unit 3

**Files:**
- Create: `apps/backend/src/modules/rag/events/rag-event-consumer.service.ts`
- Create: `apps/backend/src/modules/rag/audit/rag-audit-replay.service.ts`
- Test: `apps/backend/test/unit/rag-event-consumer.spec.ts`
- Test: `apps/backend/test/integration/rag-incremental-refresh.spec.ts`
- Test: `apps/backend/test/integration/rag-audit-replay.spec.ts`

**Approach:**
- 事件消费采用幂等处理并记录 replay token。
- 审计服务提供 `event -> index_version -> run trace` 查询。
- 阶段退出前完成一次 rollback rehearsal 并归档证据。

**Patterns to follow:**
- `apps/backend/src/modules/observability/*`（事件消费/审计模式参考）

**Test scenarios:**
- Happy path: 事件触发索引增量刷新并可查询结果变化，链路延迟在门禁阈值内。
- Edge case: 重复事件不会导致重复增量写入，幂等键命中可观测。
- Error path: 消费失败进入重试或 DLQ 并留痕，且不会破坏在线检索可用性。
- Integration: 审计接口可串联事件、索引与运行记录，支持按 `runId` 和事件时间窗口回放。

**Verification:**
- 增量刷新链路具备可追踪、可回放、可恢复能力。

## System-Wide Impact

- **Interaction graph:** 新增 delivery/sandbox/memory/events/audit 多模块，覆盖 chat 响应、后处理执行、索引刷新与审计查询路径。
- **Error propagation:** delivery mapper、sandbox、promotion、event consumer 的失败需统一映射为结构化降级结果，不得传播裸异常。
- **State lifecycle risks:** memory 晋升与索引刷新存在并发竞争与重复事件风险，需要幂等键、事务边界与补偿策略。
- **API surface parity:** `packages/shared-types` 合同、sync 接口、stream 事件字段必须同步演进，避免前后端协议分叉。
- **Integration coverage:** 除单元测试外，必须覆盖跨层集成：交付合同一致性、沙箱失败降级、晋升回滚、审计回放。
- **Unchanged invariants:** R2/R3 的主链可用性与 fail-closed 安全原则保持不变；R6 才处理性能规模化，不在本阶段修改。

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| 协议升级影响现有调用方 | 保持向后兼容字段并增加 shared-types 契约测试 |
| 沙箱策略过严影响可用性 | 引入白名单策略并可配置灰度，保留主链降级路径 |
| 自动晋升导致错误学习 | 多门槛策略 + 人工复核入口 + 审计回放抽检 |
| 事件驱动链路重复/乱序导致污染 | 幂等键 + 重试窗口 + DLQ + 审计校验任务 |
| R5 退出产物不足导致 R6 指标失真 | 以阶段交接清单约束 R6 入场（memory snapshot + audit replay report） |

## Documentation / Operational Notes

- 更新 `docs/standards/llm-stream-tool-migration-spec.md` 与共享类型文档，明确三层交付字段及错误降级语义。
- 补充 R4/R5 运行手册（建议目录：`docs/runbooks/rag-r4-r5-operations.md`），涵盖沙箱策略更新、记忆晋升回滚、事件重放处置。
- 阶段退出需归档证据包（建议目录：`docs/reports/rag/r4-r5/`）：合同兼容报告、安全演练结果、晋升链路审计样本、rollback rehearsal 记录。

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-14-text2sql-r2-rag-implementation-detail-requirements.md](docs/brainstorms/2026-04-14-text2sql-r2-rag-implementation-detail-requirements.md)
- Related plan: [docs/plans/2026-04-17-004-feat-rag-r3-semantic-registry-plan.md](docs/plans/2026-04-17-004-feat-rag-r3-semantic-registry-plan.md)
- Related plan: [docs/plans/2026-04-17-006-feat-rag-r6-scale-optimization-plan.md](docs/plans/2026-04-17-006-feat-rag-r6-scale-optimization-plan.md)
