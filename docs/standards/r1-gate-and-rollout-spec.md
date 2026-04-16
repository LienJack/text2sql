# R1 Gate 与灰度发布规范

## 1. 目标

为 Text2SQL R1 阶段提供统一的验收门禁与灰度发布流程，确保发布具备可验证、可回滚、可复验能力。

## 2. 双轨验收口径

R1 必须同时满足以下两类数据口径：

1. 离线固定评测集：`apps/backend/test/e2e/stage1-12-cases.yaml`
2. 线上灰度样本：`/health` -> `dependencies.gateMetrics.acceptance`

任一口径不满足时，视为 Gate 未通过。

## 3. 离线 Gate 阈值

`stage1-acceptance.spec.ts` 输出 Gate 报告（可选写入 `STAGE1_GATE_REPORT_PATH`）并默认采用以下阈值：

- 最低通过率：`R1_GATE_MIN_PASS_RATE=1`
- 最高硬失败率：`R1_GATE_MAX_HARD_FAILURE_RATE=0`
- 最高策略拒绝率：`R1_GATE_MAX_POLICY_REJECTION_RATE=0.2`
- 最低样本量：`R1_GATE_MIN_SAMPLES=10`

CI 在 `backend-prisma-quality.yml` 中必须校验：

- `sampleReady == true`
- `gatePass == true`

## 4. 线上灰度 Gate 阈值

`GateMetricsService` 默认窗口为最近 60 分钟，输出字段：

- `successRate`
- `rejectionRate`
- `hardFailureRate`
- `blockedByPolicy`
- `errorCategories`
- `sampleReady`
- `gatePass`

默认阈值：

- `R1_GATE_MIN_SUCCESS_RATE=0.95`
- `R1_GATE_MAX_REJECTION_RATE=0.2`
- `R1_GATE_MAX_HARD_FAILURE_RATE=0.05`
- `R1_GATE_MIN_SAMPLES=10`

## 5. 灰度发布流程

1. 功能开关：`AGENT_PLANNING_SCAFFOLD_ENABLED=false` 默认关闭。
2. 小流量灰度：先对内部或低风险流量开启，观察至少 7 天。
3. 指标监控：每小时检查 `gateMetrics.acceptance` 是否稳定。
4. 阶段复验：每日运行离线评测并对比线上趋势。

## 6. 自动回滚触发条件

满足任一条件触发回滚：

- `hardFailureRate` 连续两个窗口超阈值。
- `successRate` 连续两个窗口低于阈值。
- 出现策略越权执行（应为 0）。
- 安全拦截异常导致主链不可用（拒绝路径无法返回可解释结果）。

回滚动作：

1. 关闭 `AGENT_PLANNING_SCAFFOLD_ENABLED`。
2. 恢复上一稳定版本。
3. 保留 `agent_audit_logs` 与 trace 数据用于复盘。

## 7. 责任与校验窗口

- 责任人：后端值班工程师（oncall）与发布负责人共同确认。
- 校验窗口：灰度后连续 7 天。
- 复盘要求：若触发回滚，24 小时内输出原因与修复计划。
