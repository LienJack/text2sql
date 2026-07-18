# LLM Stream & Tool Calling Migration Spec

## Scope

- Backend LLM gateway migrates to Vercel AI SDK core (`ai` + `@ai-sdk/openai-compatible`).
- Chat primary request path supports SSE streaming endpoint.
- Tool Calling baseline is enabled with allowlisted server-side tools.
- Text2SQL v2 active runtime seam 固定为 `Text2SQLWorkflowRunner -> RunV2LangGraphStage -> Text2SqlV2LangGraphRunnerService`，并落位于 `conversation/application/workflow` 与 `conversation/runtime/{stages,langgraph,evaluation}` 分层目录；`RunV2StateMachineStage` 仅保留兼容壳角色。
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
  - Runtime intelligence（2026-04-28）语义：`run.trace.v2` 是 `runtimePlan`、`artifactRefs`、`smartDefaults` 的 canonical owner；`run.delivery.evidence.v2` 只做同语义投影；`artifactRefs` 必须由 producer-backed category policy 生成，覆盖 `context_snippets` / `schema_supplement` / `prompt_input` / `provider_output_summary` / `validation_diagnostics` / `correction_grounding` / `execution_preview` / `accuracy_receipts`
  - Accuracy closure（2026-07-17）语义：`run.trace.v2.accuracy` 保存 QueryContract、九元版本与 compact Receipt chain；`run.delivery.evidence.v2.accuracy` 只输出 Gate statuses、SQL digest、repair count、terminal reason、sealed receipt ref、stale/evidence-valid 安全摘要
  - `run.delivery.evidence.v2` 在 strict-completion 与 runtime-intelligence 场景应包含 `contextPackSummary`、`metadataAnswer`、`correctionGrounding`、`runtimePlan`、`artifactRefs`、`smartDefaults`，并与 `run.trace.v2` 保持语义一致
  - hard-cut read-model：run read/save-view/replay 必须命中显式 v2 marker（`run.trace.v2.version === "v2"`、`run.trace.v2.stageOrder.length > 0`、`run.trace.v2.stages.length > 0`）；命中授权但不支持历史 shape 时返回 `410 LEGACY_RUN_UNSUPPORTED`
  - `agent: { provider, model, hasSql, hasToolCalls, hasError }`

### Stream Contract (`/messages/stream`)

- Response content type: `text/event-stream`
- Ownership:
  - `packages/shared-types` owns `ChatStreamEvent` schema and event taxonomy.
  - `packages/chat-stream-protocol` owns reusable envelope / framing / parsing / terminal helper implementation.
  - backend / frontend / smoke compatibility glue must not become a second canonical protocol rule source.
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
- SSE writer / parser helper changes should land in `packages/chat-stream-protocol` first, then be adopted by app/test consumers.
- 前端 stop / fetch abort 必须贯通到 backend request-close、workflow runner、LangGraph runtime、SQL generation 与 LLM gateway/provider 调用；不允许只停止浏览器 reader 而让后端继续消耗 provider / tool 资源。
- 在单独的兼容性计划批准前，用户停止生成继续复用既有 terminal `error` 事件，并固定返回 `code: "USER_CANCELLED"`；不得直接新增公开 `cancelled` event type。
- `finish` 事件中的 `data.delivery.evidence.promptTemplate?`、`modelingRevision?`、`effectiveContextSummary?`、`conflictHint?` 必须与同步接口字段语义一致（不再要求历史 snake_case / alias hydration）。
- strict-completion/runtime-intelligence 场景下，`finish` 事件中的 `data.delivery.evidence.v2` 也必须保持 `contextPackSummary`、`metadataAnswer`、`correctionGrounding`、`runtimePlan`、`artifactRefs`、`smartDefaults` 与 `run.trace.v2` 的同语义镜像；`state` 事件只能暴露 runtime plan 的安全摘要，不得暴露 raw graph state/checkpoint。Full Mermaid stages 必须在 stream `state` 中产生安全的 `running` 与 terminal lifecycle（completed/skipped/failed/clarification）摘要。
- Accuracy closure 场景下，sync、stream `finish`、run view、save view 与 replay 必须共享 `evidence.v2.accuracy` 安全投影；replay 不得返回完整 accuracy Receipt payload。digest/parent chain 无效必须显示 `evidenceValid=false`，版本元组漂移必须显示 stale reason。
- Accuracy `shadow` 只允许附加诊断摘要，既不能被投影为 sealed/passed，也不能替代现有 baseline 交付合同；只有 `enforce` 才将 trusted grounding、完整 Receipt chain 与 final ValidationReceipt 作为执行/交付硬条件。

## Autonomous Analysis Task Stream

- `/api/v1/analysis/tasks/:taskId/events/stream` 使用独立 `analysis-task-protocol/v1`，不得复用或污染 Chat `ChatStreamEvent` taxonomy。
- 每个事件必须包含 `taskId/sequence/idempotencyKey/type/visibility/at/data`，有 Revision/Attempt 时同时包含 `revisionId/attemptId`。
- Analysis 客户端按 `taskId + attemptId + sequence` 合并；sequence owner 冲突必须报错，重复事件必须幂等，terminal task status 必须单调。
- SSE disconnect、切页或关闭浏览器只停止 projection，不发送 cancel；重连先按 cursor 补历史，再继续 live stream。
- Analysis replay 为 artifact-only，`externalCallCount=0`；不得在 replay 时重新调用 provider、数据库查询或 web connector。
- Analysis Evidence/Conflict/Report UI 只消费安全 read model/Claim projection，禁止暴露 Artifact 原始 SQL rows、网页正文、Prompt、凭据或可执行 HTML。
- 自治分析的最终发布入口是 additive `collect:data-agent-release-gate`；focused/eval、OTel 和合成测试不得替代签名 Outcome。

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
  - Runtime intelligence 场景下，报告还必须包含 `runtimeCoverageRows`（runtime plan / artifact refs / Smart Defaults）、`runtimeArtifactProducerRows`（七类 artifact producer coverage）、`streamLifecycleRows`（全 stage running/terminal lifecycle coverage）与 eval fixture families（plain-general-no-sql / runtime-plan-consistency / artifact-ref-compaction / smart-defaults-evidence / large-context-compaction / validation-diagnostics / correction-grounding / execution-preview / all-stage-stream-lifecycle）。
- 叙事边界：`007 closeout` 表示 LangGraph topology + `delegation=0` 收口完成；`008 strict-completion` 在此基础上要求 metadata grounding / correction grounding / context-pack parity；`009 runtime-intelligence` 额外要求 runtime plan / artifact refs / Smart Defaults 的可观测与可门禁。
- Text2SQL v2 closeout rollout must use `collect:text2sql-v2-eval-gate` as the aggregated report entry:
  - `pnpm --filter @text2sql/backend run collect:text2sql-v2-eval-gate`
  - strict release mode: `pnpm --filter @text2sql/backend run collect:text2sql-v2-eval-gate:strict`
  - output must include `closeoutGates.evalMetrics/evalTraceability/characterization/noLegacyCompat/focusedCoverage` and final `rollout.recommendedStage/rollbackSuggested/reasons`.
