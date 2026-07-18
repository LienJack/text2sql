# Data Agent 任务恢复与发布 Runbook

## 1. 使用范围与安全原则

本 runbook 用于诊断和恢复自治分析 Task、Temporal worker、command outbox、Artifact、
KnowledgeAsset 与综合发布门禁。先做只读检查，再执行可逆恢复；不得直接修改 Ledger 状态、
伪造 Event/Receipt/Outcome、删除历史 Artifact 或降低发布门禁。

生产操作前必须确认：

- 目标环境、workspace、taskId、Revision、Attempt 和变更窗口；
- 当前负责人、审批人和 incident 记录；
- 数据库备份/恢复能力与 rollback owner；
- 不在终端、日志或工单中粘贴 token、连接串、Prompt、SQL rows、网页正文或个人数据。

## 2. 快速判定

先读取健康摘要：

```bash
curl -sS http://localhost:3002/health | jq '.data.dependencies.analysisRuntime'
```

正常最低条件：

- `canonicalStore.ready=true`
- Temporal 模式下 `durableWorkflow.clientReady=true`
- worker 正常时 `durableWorkflow.workerPollerReady=true`
- `commandOutbox.ready=true`，backlog 没有持续增长
- telemetry 的拒绝/redaction 计数可解释，且没有敏感字段泄漏

再确认本地进程与依赖：

```bash
docker compose -f infra/docker-compose.yml ps
curl -sS http://localhost:8233/api/v1/namespaces/default | jq '.namespaceInfo.state'
```

若 Temporal HTTP API 版本不支持该路径，以 `/health` 中 durable summary 和 Temporal UI
`http://localhost:8233` 为准。

## 3. 只读 Ledger 诊断

使用受控数据库只读账号执行以下查询。Prisma 默认字段名为 quoted camelCase：

```sql
SELECT status, count(*)
FROM analysis_tasks
GROUP BY status
ORDER BY status;

SELECT status, count(*), min("createdAt") AS oldest
FROM analysis_command_outbox
GROUP BY status
ORDER BY status;

SELECT id, "taskId", "commandId", status, attempts,
       "nextAttemptAt", "lastReasonCode", "updatedAt"
FROM analysis_command_outbox
WHERE status IN ('pending', 'processing', 'retry')
ORDER BY "updatedAt" ASC
LIMIT 100;

SELECT id, status, version, "currentRevisionNumber", "authorityEpoch",
       "terminalAt", "updatedAt"
FROM analysis_tasks
WHERE id = '<task-id>';

SELECT sequence, "eventType", visibility, "revisionId", "attemptId", "createdAt"
FROM analysis_events
WHERE "taskId" = '<task-id>'
ORDER BY sequence ASC;
```

不要查询或导出 `analysis_artifact_payloads.payload` 作为常规诊断。需要内容审计时，通过产品
授权 projection 和既定 incident 审批流程读取。

## 4. Temporal 或 Worker 不可用

症状：

- health 为 `temporal_unavailable`；
- `clientReady=false` 或 `workerPollerReady=false`；
- outbox 进入 retry，`lastReasonCode` 指向 durable provider；
- Task 保持 queued/running，但 event sequence 不前进。

处理：

1. 确认 PostgreSQL canonical store 可用，不要先重建 Task。
2. 检查 Temporal 容器和 task queue 配置是否与 API/worker 一致：

```bash
docker compose -f infra/docker-compose.yml up -d temporal
pnpm --filter @text2sql/backend run analysis-worker:dev
```

3. 重新读取 `/health`，确认 poller 出现。
4. 观察 outbox backlog 与 Task events；API 启动时会重新排队 stale processing，dispatcher
   会按持久化状态重试。
5. 不要手工把命令改成 delivered。若 durable provider 已恢复但仍不前进，记录
   `taskId/commandId/reasonCode`，暂停新 intake 并升级给 runtime owner。

生产环境禁止将 `ANALYSIS_DURABLE_PROVIDER` 临时改成 `in_memory` 规避故障。

## 5. Outbox backlog 或命令卡住

1. 判断 backlog 是瞬时峰值还是持续增长，并按最旧 `updatedAt`、attempts、reason code 分类。
2. 验证 PostgreSQL、Temporal client、worker poller 和 API dispatcher 均健康。
3. 对单个 Task 读取 event stream/replay，确认 command accepted 与 delivered 是否分离：

```bash
curl -sS \
  -H 'Authorization: Bearer <redacted>' \
  'http://localhost:3002/api/v1/analysis/tasks/<task-id>/events?after=0&limit=500' \
  | jq '.data[] | {sequence,type,at}'
```

4. 优先通过重启 API dispatcher/Temporal worker触发幂等恢复。不要重复生成新 commandId；
   客户端重试必须复用原 commandId 和期望版本。
5. 若命令长期处于 processing，先保留快照和审计证据，再由运行时负责人依据 repository
   的 stale-processing 策略恢复。禁止直接 SQL 更新状态。

## 6. Stuck Task、pause、resume 与 cancel reconciliation

- `pause/cancel` 返回 202 只表示 accepted。以 canonical Task status 和后续 Event 为准。
- cancel 后 terminal 状态不得回退 running；迟到 Worker proposal 应由 authority fencing 和
  Commit Guard 拒绝。
- 如果 cancel 已 accepted 但 durable provider 不可用，先恢复 provider，再等待 command
  delivered 与 terminal event。不要删除 workflow 或 Task 来制造 cancelled 外观。
- resume 只用于合法 paused 状态，并使用当前 `taskVersion/authorityEpoch`。409 说明客户端
  read model 已过期，应重新读取 Task，而不是绕过 optimistic concurrency。
- Goal 或范围有误时创建新 Revision；不要用 resume 继续旧范围。

浏览器断开不等于任务停止。SSE 重连使用 cursor：

```bash
curl -N \
  -H 'Authorization: Bearer <redacted>' \
  -H 'Last-Event-ID: <last-sequence>' \
  'http://localhost:3002/api/v1/analysis/tasks/<task-id>/events/stream'
```

## 7. Artifact retention、Replay 与 Correction

artifact-only replay：

```bash
curl -sS \
  -H 'Authorization: Bearer <redacted>' \
  'http://localhost:3002/api/v1/analysis/tasks/<task-id>/replay' \
  | jq '.data | {mode,externalCallCount,readModel}'
```

验收：

- `mode=artifact_only`
- `externalCallCount=0`
- 返回的 Manifest/digest/limitations 与冻结版本一致
- payload 已到期时显示 unavailable/stale metadata，不发起外部刷新

需要重新访问数据库、RAG、LLM、Tavily 或 Temporal execution 时，必须创建新的
Revision/Attempt，并在 UI 中标记 refresh/recompute。Correction 同样追加 Revision，并检查
受影响 SQL、Evidence、Calculation、Claim、Report、Memory、Skill 和 Eval 是否 stale 或
invalidated。禁止覆盖旧 replay。

## 8. KnowledgeAsset rollback

触发条件包括 active Memory/Skill 回归、权限放大、来源/版本漂移、错误 correction propagation
或 canary 失败。

1. 读取 KnowledgeAsset 当前状态、transition history、evidence refs、approval 与 rollback target。
2. 暂停新的 promotion/canary，不删除现有资产和 transition。
3. 通过治理服务执行 rollback/compensation，使 active lookup 回到已批准 target。
4. 验证 active lookup、权限子集、受影响 Task/Claim/Report 的 stale 标记和旧 replay。
5. 重跑 promotion/rollback、knowledge facade、Prisma 与 capability boundary 测试。

不得用 legacy Map 或静态默认值作为生产紧急回退。`KNOWLEDGE_ASSET_LEGACY_FIXTURE_MODE`
只允许测试 fixture。

## 9. 发布判定

先运行非 strict collectors，它们总应输出可审查报告：

```bash
pnpm --filter @text2sql/backend run collect:text2sql-v2-focused-coverage-gate
pnpm --filter @text2sql/backend run collect:text2sql-v2-eval-gate
pnpm --filter @text2sql/backend run collect:text2sql-accuracy-gate
pnpm --filter @text2sql/backend run collect:data-agent-release-gate
```

判定顺序：

1. 能力/安全门禁失败：发布前 `NO_GO`，online/canary `ROLLBACK`。
2. required evidence unknown/stale/过期/跨 scope/缺 owner approval：`HOLD`。
3. 缺真实签名 Text2SQL Outcome 或代表性 analyst Outcome：`HOLD`。
4. multi-worker 无 same-budget 正净收益：保持 `single_workflow`，不得开启 topology。
5. 只有所有 exact version/scope/freshness/evidence/approval 和阈值均通过时才允许 `GO`。

准备真实发布时再运行 strict：

```bash
pnpm --filter @text2sql/backend run collect:text2sql-v2-focused-coverage-gate:strict
pnpm --filter @text2sql/backend run collect:text2sql-v2-eval-gate:strict
pnpm --filter @text2sql/backend run collect:text2sql-accuracy-gate:strict
pnpm --filter @text2sql/backend run collect:data-agent-release-gate:strict
```

预期 `HOLD` 时 accuracy/Data Agent strict 非零退出是正确行为，禁止为了让 CI 绿色而替换真实
Outcome、降低最小样本或伪造 owner approval。

## 10. 发布前与恢复后验收

```bash
pnpm --filter @text2sql/backend run prisma:generate
pnpm --filter @text2sql/backend run prisma:verify-empty-db
pnpm run text2sql:no-legacy-compat:check
pnpm run governance:terminology:check
pnpm run backend:capability-boundary:check
pnpm run format:check
pnpm run test
pnpm run build
graphify update .
```

同时验证：

- `/analysis` 桌面与 375px、键盘、screen reader、重连和 terminal monotonicity；
- telemetry 不含 Prompt、SQL rows、网页正文、token、URL secret、签名材料或个人数据；
- command/outbox/recovery 只产生一次合法提交；
- replay 外部调用为零，Revision/correction lineage 完整；
- ReleaseManifest 的 decision、reasons、topology 和 exact scope 与本次候选一致。

完成后记录 incident/candidate、时间窗口、执行命令、报告 digest、最终 decision、owner 与后续
行动。不要把真实业务数据或签名私钥写入仓库。
