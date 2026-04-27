# LLM Stream & Tool Calling Migration Spec

## Scope

- Backend LLM gateway migrates to Vercel AI SDK core (`ai` + `@ai-sdk/openai-compatible`).
- Chat primary request path supports SSE streaming endpoint.
- Tool Calling baseline is enabled with allowlisted server-side tools.
- Text2SQL v2 active runtime seam 是 `RunV2LangGraphStage`（LangGraph internal runtime），不再以 `RunV2StateMachineStage` 作为主路径。
- Text2SQL v2 Phase A 运行时收口必须满足 `delegation=0`：LangGraph 主链节点不得委托 `Text2SqlV2RunnerService` / `runLegacyRuntime`。
- 开发联调入口拓扑统一为 `http://localhost:3000`（Nginx）；`/` 转前端内部 `3001`，`/api/*` 转后端内部 `3002`。
- 上述入口拓扑调整不改变 `/api/v1/*` 路由合同、SSE 事件字段或 Tool Calling 语义。

## API Changes

术语约束（governance 相关）：
- 本规范涉及治理字段时，仅使用 canonical 词典：`workspace datasource binding`、`table-permissions`、`policyVersion`。
- 不在治理主链路文档中引入 `table-acl` / `acl` / `rule-group` 兼容叙事（governance-terminology:allow-legacy）。

### Message Endpoints

- `POST /api/v1/sessions/:sessionId/messages`
- `POST /api/v1/sessions/:sessionId/messages/stream`
- Endpoint paths and response/event contracts remain unchanged; only default local access path converges to gateway entry (`http://localhost:3000/api/...`).

### Synchronous Contract (`/messages`)

- Request body:
  - `message: string`（必填）
  - `contextEnvelope?: { metricDefinition?, timeRange?, entityMappings?, mustIncludeTables?, mustExcludeTables?, businessConstraints? }`（可选）
- Response body is `AgentRunResponse`:
  - `kind: "agent-run"`
  - `outcome: "clarification" | "executionResult" | "rejected" | "failed"`
  - `run: SqlRun`
  - `run.trace.promptTemplate?`：SQL 运行时模板命中证据（`templateId/scene/scope/version/fallbackReason`）
  - `run.trace.modelingRevision?`：建模修订证据（推荐包含 `revisionId/version/updatedAt`，用于标识本次运行绑定的建模快照）
  - `run.trace.effectiveContextSummary?`：用户显式上下文生效摘要（来源优先级与槽位计数）
  - `run.trace.conflictHint?`：上下文冲突提示（`hasConflict/preferredSource/reasonCodes`）
  - `run.delivery.evidence.promptTemplate?`：与 trace 同源的模板证据镜像（用于前端回放展示）
  - `run.delivery.evidence.modelingRevision?`：与 `run.trace.modelingRevision?` 同源镜像字段，语义必须一致
  - `run.delivery.evidence.effectiveContextSummary?` / `run.delivery.evidence.conflictHint?`：trace 同语义镜像字段
  - Full Mermaid strict-completion（2026-04-27）语义：metadata 仅走 `retrieve -> assemble-context -> semantic-plan -> answer`（no-SQL）；correction 重试必须输出结构化 `correctionGrounding`
  - `run.delivery.evidence.v2` 在 strict-completion 场景应包含 `contextPackSummary`、`metadataAnswer`、`correctionGrounding`，并与 `run.trace.v2` 保持语义一致
  - hard-cut read-model：run read/save-view/replay 必须命中显式 v2 marker（`run.trace.v2.version === "v2"`、`run.trace.v2.stageOrder.length > 0`、`run.trace.v2.stages.length > 0`）；命中授权但不支持历史 shape 时返回 `410 LEGACY_RUN_UNSUPPORTED`
  - `agent: { provider, model, hasSql, hasToolCalls, hasError }`

### Stream Contract (`/messages/stream`)

- Response content type: `text/event-stream`
- Event types:
  - `start`
  - `text-delta`
  - `tool-call`
  - `tool-result`
  - `tool-error`
  - `state`
  - `finish`
  - `error`
- Each event payload is a serialized `ChatStreamEvent`.
- Required fields for every event:
  - `type`
  - `runId`
  - `sessionId`
  - `at`
  - `data`
- `data` is always a structured object, not raw string.
- `finish` 事件中的 `data.delivery.evidence.promptTemplate?`、`modelingRevision?`、`effectiveContextSummary?`、`conflictHint?` 必须与同步接口字段语义一致（不再要求历史 snake_case / alias hydration）。
- strict-completion 场景下，`finish` 事件中的 `data.delivery.evidence.v2` 也必须保持 `contextPackSummary`、`metadataAnswer`、`correctionGrounding` 与 `run.trace.v2` 的同语义镜像。

## Tool Calling Baseline

- Server-side tool registry is allowlist-based.
- First shipped tool: `runReadOnlySql`.
- Tool input validation uses schema checks and read-only SQL guard.
- Tool failures are surfaced as `tool-error` events and persisted into trace summary.

## Rollout and Fallback

- Preferred client path: SSE endpoint.
- Synchronous endpoint and stream endpoint share the same Agent-first semantic model.
- Rollback trigger suggestions:
  - sustained stream failure ratio above agreed threshold
  - sustained tool execution failure ratio above agreed threshold
  - severe regression in run persistence consistency
- Modeling parity shadow gate（发布前执行）：
  - `pnpm --filter @text2sql/backend run collect:modeling-parity-shadow-gate`
  - 若需要在发布门禁中强制失败：`pnpm --filter @text2sql/backend run collect:modeling-parity-shadow-gate:strict`
  - 结果读取：
    - `gatePass=true` 且 `rollout.recommendedStage=canary_ready` 才可进入灰度放量。
    - `rollout.recommendedStage=rollback_or_hold` 或 `rollout.rollbackSuggested=true` 时，必须先执行回滚/止损手册。

## Monitoring Checklist

- `GET /health` confirms:
  - local dev can verify health at backend internal port `http://localhost:3002/health`
  - `dependencies.llm.streamingEnabled === true`
  - `dependencies.llm.toolCallingEnabled === true`
  - stream endpoint and tool registry metadata are present
- Stream checks should run through unified gateway entry (`http://localhost:3000/api/v1/sessions/:sessionId/messages/stream`) when validating developer workflow.
- 同步/流式的错误分类在相同故障输入下保持一致。
- Compare stream endpoint success rate against legacy endpoint baseline.
- Verify trace persistence includes tool events when tools are called.
- Verify `GET /api/v1/runs/:runId`、`POST /api/v1/runs/:runId/save-as-view` 与 replay 读路径只接受显式 v2 read-model；历史 shape 返回 `410 LEGACY_RUN_UNSUPPORTED`，错误详情包含迁移 runbook hint。
- Verify modeling parity shadow gate report includes:
  - `modelingWorkspace.metrics.deployBlockRate / rollbackRate / schemaBacklogAvg`
  - `modelingWorkspace.signalCoverage.*`（样本信号覆盖率）
  - `rollout.recommendedStage` 与 `rollout.rollbackSuggested`
- Text2SQL v2 closeout must also collect focused coverage evidence after a Jest coverage run:
  - `pnpm --filter @text2sql/backend run collect:text2sql-v2-focused-coverage-gate`
  - strict release mode: `pnpm --filter @text2sql/backend run collect:text2sql-v2-focused-coverage-gate:strict`
  - the report must include scoped line/branch coverage, critical file thresholds, A-M flow-node blockers, eval fixture behavior-test traceability, and `delegationZero` static-scan结果。
  - Full Mermaid strict-completion 场景下，报告还必须包含 `strictCompletionRows`（metadata grounding / correction grounding / context-pack parity）并参与 gate 判定。
- 叙事边界：`007 closeout` 表示 LangGraph topology + `delegation=0` 收口完成；`008 strict-completion` 在此基础上要求 metadata grounding / correction grounding / context-pack parity 的可观测与可门禁。
- Text2SQL v2 closeout rollout must use `collect:text2sql-v2-eval-gate` as the aggregated report entry:
  - `pnpm --filter @text2sql/backend run collect:text2sql-v2-eval-gate`
  - strict release mode: `pnpm --filter @text2sql/backend run collect:text2sql-v2-eval-gate:strict`
  - output must include `closeoutGates.evalMetrics/evalTraceability/characterization/noLegacyCompat/focusedCoverage` and final `rollout.recommendedStage/rollbackSuggested/reasons`.
