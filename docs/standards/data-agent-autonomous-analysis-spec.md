# Data Agent 自治分析规范

## 1. 目的与适用范围

本规范定义自治分析平台的权威状态、执行边界、证据链、安全投影和发布条件。它建立在
现有 Text2SQL v2 与准确率门禁之上，不替换
`Text2SQLWorkflowRunner -> RunV2LangGraphStage -> Text2SqlV2LangGraphRunnerService`
这一 active runtime seam。

适用范围：

- `apps/backend/src/modules/conversation/analysis/**`
- `apps/backend/src/modules/platform/{durable,artifacts,observability}/**`
- `apps/backend/src/modules/platform/data/persistence/analysis-*.ts`
- `apps/backend/src/modules/knowledge/{research,assets}/**`
- `apps/frontend/src/{app,components}/analysis/**`
- `packages/analysis-task-protocol/**`
- `apps/backend/scripts/collect-data-agent-release-gate.ts`

首版能力只允许只读分析。不得因为引入 Durable Workflow、Worker 或多 Agent 拓扑而放宽
Text2SQL 的查询、治理、预算或发布边界。

## 2. 权威状态与身份

- PostgreSQL Analysis Ledger 是 `Task/Revision/Attempt/Event/Artifact/Receipt/Decision/Manifest`
  的唯一 canonical store。Temporal history、LangGraph checkpoint、Redis、SSE、OTel 和前端
  reducer 都只是执行或投影，MUST NOT 反向覆盖账本事实。
- 生产环境缺少 PostgreSQL canonical store 时 MUST fail closed；内存 durable adapter 只允许
  测试和显式开发场景。
- 生产请求 MUST 使用受信 Principal。客户端自报用户、角色、workspace 或 admin header
  不得成为生产授权事实；`dev_headers` 只能用于本地开发，并且属于发布阻断项。
- 每个 Revision、命令、Receipt 和发布分量 MUST 绑定 Principal digest、授权策略版本和作用域。
  权限撤销后，Task、event stream 与 replay 都必须重新授权，并对无权主体返回不可枚举结果。
- 创建 Task、Revision 和生命周期命令 MUST 使用幂等键；`taskVersion` 与 `authorityEpoch`
  承担并发和迟到结果 fencing，不能用最后写入获胜替代。

## 3. Task、Revision 与 Durable Workflow

- Goal Contract MUST 冻结目标、workspace、数据源/来源范围、时间窗口、成功标准、预算、
  限制、审批点和 retention。Goal 变化必须创建新 Revision，不得原地覆盖旧目标。
- Durable Workflow 负责长任务、等待、重试、暂停、恢复、取消和 HITL；短时数据库分析仍
  复用 Text2SQL v2 LangGraph。
- 生命周期命令只允许 `start/decide/pause/resume/cancel`；修订使用独立 Revision API。
  API 返回 command accepted 不等同于 canonical transition 已完成。
- command outbox MUST 持久化、去重、可重试并记录 bounded reason code。进程重启后只能从
  PostgreSQL 恢复 pending/retry 命令，不得依赖进程内队列。
- pause/cancel 后的旧 Worker 结果必须经过 `authorityEpoch`、Revision、Attempt 和 Commit
  Guard 校验；迟到结果不得把 terminal Task 回退到 running。
- 浏览器或 SSE 断开只停止传输，不取消 Task。重连必须使用 sequence cursor 补事件；重复、
  乱序和 terminal 后旧事件不能破坏 terminal monotonicity。

## 4. WorkGraph、Worker 与 Commit Guard

- Goal Compiler 生成版本化 WorkGraph 和 mandatory obligations。模型可以提出 route、plan、
  query、search、claim 或 repair candidate，但确定性规则拥有停止、提交和发布权。
- Worker invocation MUST 绑定 `taskId/revisionId/attemptId/workItemId/authorityEpoch`、输入
  Artifact refs、预算和 capability grant。Worker 声明能力必须是 invocation grant 的子集。
- Worker 输出只能是 proposal。Commit Guard 必须校验版本、权限、预算、schema、lineage、
  obligation 和幂等性，才可提交 Artifact/Event/Receipt。
- 多 Worker 默认关闭。只有 same-budget paired evaluation 证明准确性、分析师时间、时延、
  成本和冲突的净收益时才可启用；没有正净收益时 topology 必须回退 `single_workflow`。
- Orchestrator 不得成为宽导出中枢或新的跨域 god service；依赖必须继续满足四域拓扑和
  `backend:capability-boundary:check`。

## 5. Artifact、Evidence、Calculation、Claim 与 Report

- 每个 Artifact MUST 有类型、schema version、payload digest、大小、分类、可见性、完整性、
  retention、Revision/Attempt lineage 和状态。payload 必须由有界 schema registry 校验。
- Evidence MUST 保存可审计 locator、来源 snapshot/digest、观察时间、信任等级和限制；
  Calculation MUST 引用输入 Evidence 与确定性方法；Claim MUST 引用支撑/反驳 Evidence 或
  Calculation，并携带 obligation 状态。
- competing Evidence 必须显式形成 Conflict；不得自动平均、丢弃反例或把冲突 Claim 伪装为
  已证实结论。
- Report 只能从已提交 Claim 的安全 projection 生成。缺证据、冲突、过期、stale 和未关闭
  obligation 必须在用户可见限制中披露。
- 数字没有 current Evidence/Calculation lineage 时不得进入图表、报告或业务结论。
- Artifact payload 到期后允许删除 payload，但 Manifest、digest、lineage、stale metadata 和
  审计事件必须保留。已提交 Artifact 不通过物理删除来“回滚”。

## 6. Text2SQL、Deep Search 与内容安全

- 数据库 Work Item MUST 复用 Text2SQL 准确率合同、九元版本、七层 Receipt、Execution
  Permit、deterministic result oracle 和有界 AST Repair。自治分析不得建立旁路 SQL 执行器。
- SQL 执行只读、受 workspace datasource binding、table-permissions、row filter、timeout、
  row/byte/AST 上限和 cancellation 控制；安全失败必须 fail closed。
- Deep Search 默认关闭。启用时必须同时存在版本化 workspace source policy、provider 配置、
  domain allowlist、timeout、内容大小和 retention 上限。
- 网页标题、正文、Markdown、URL 与模型内容始终 untrusted。来源内容不得改变系统指令、
  capability、预算、授权或工具选择；raw HTML、scriptable URL、伪造按钮和恶意图片/链接
  必须在 projection 层转义或拒绝。
- Search snapshot 必须记录 request/source/content digest 与 coverage；不得把网页全文、token、
  私有 URL secret 或 provider credential 写入公开 Artifact、日志或发布报告。

## 7. Correction、Replay 与 KnowledgeAsset

- Correction 必须追加 Revision，重新计算受影响的 SQL、Evidence、Calculation、Claim、Report、
  Memory、Skill 与 Eval。旧 Artifact 标记 stale/invalidated，但旧 replay 仍保持历史事实。
- artifact-only replay 只能读取冻结 Artifact/Manifest，外部调用数必须为零。任何重新访问数据库、
  RAG、Tavily、LLM 或 Temporal workflow execution 的操作都属于 refresh/recompute，必须创建
  新 Revision/Attempt。
- 生产 Memory/Skill active lookup 只能来自 PostgreSQL 中治理后的 active KnowledgeAsset。
  进程内 Map、静态默认值和 legacy bridge 只允许显式测试 fixture。
- KnowledgeAsset promotion 必须具备独立证据、paired regression、权限不放大证明、owner
  approval、canary 和 rollback target。缺任一项保持 held；回滚通过状态迁移和 compensation
  完成，不覆盖历史 transition。

## 8. 前端安全投影与可访问性

- `/analysis` 的 Task 列表、主工作区、WorkGraph、进度、Evidence、Conflict、Report、限制和
  controls 必须来自同一 canonical read model 的不同安全 projection；前端不得拼接新事实。
- UI 不得暴露 raw Artifact payload、Prompt、SQL rows、网页正文、token、secret、签名 envelope
  或个人数据。
- reducer 必须按 `taskId/attemptId/sequence` 去重和排序，并保持 terminal monotonicity。
- controls 只显示当前状态合法的操作，同时区分 accepted 与 applied。HITL 一次只呈现一个必要
  决定；Revision 变化后旧 Evidence/Report 必须清楚标记 stale。
- 必须验收桌面与 375px、键盘 Enter/Space、focus order、`aria-expanded`、live status、长内容
  和重连行为。交互控件继续遵循 React + shadcn 与 Tailwind v4 项目规范。

## 9. Telemetry 与隐私

- OTel trace/span 可关联 task、attempt、work item 与 provider activity；taskId/runId 只能用于
  trace/log correlation，MUST NOT 作为无界 metric label。
- 允许的指标包括 duration、queue wait、retry、failure reason code、预算、coverage、gate、
  backlog 和 redaction count。label 必须有固定 allowlist 和 cardinality 上限。
- Prompt、SQL rows、网页正文、token、URL secret、签名材料和个人数据不得进入 span attribute、
  log body 或 metric label。错误只记录稳定 reason code 与 bounded metadata。
- 高基数 overflow、属性拒绝和 redaction 自身必须可观测，但不得通过错误消息泄漏原值。

## 10. ReleaseManifest 与发布决策

Data Agent ReleaseManifest 是 Text2SQL accuracy gate 的 additive 门禁，必须覆盖：

1. identity/authorization
2. durability/recovery
3. Deep Search coverage
4. Evidence/Claim integrity
5. KnowledgeAsset governance
6. multi-worker paired evaluation
7. cost/safety
8. signed Text2SQL Outcome
9. representative signed analyst Outcome

每个分量 MUST 绑定 exact version、scope digest、freshness、evidence refs 和 owner approval。
required evidence 为 unknown、stale、failed、过期、scope/version 不一致或缺审批时不得 `GO`。

- `GO`：全部 required evidence 当前、可信、签名、同 scope 且阈值通过。
- `HOLD`：证据缺失/过期/不确定、准则 drift、能力不可用或只有 synthetic evidence。
- `NO_GO`：发布前明确低于阈值或安全 invariant 失败。
- `ROLLBACK`：online/canary 阶段触发安全或预声明回退条件。

缺真实签名 Text2SQL Outcome 或代表性 analyst Outcome 时，即使所有单元测试、focused/eval
和合成组件门禁通过，也 MUST 保持 `HOLD`。安全失败优先于统计收益。

## 11. 必跑门禁

```bash
pnpm --filter @text2sql/backend run prisma:generate
pnpm --filter @text2sql/backend run prisma:verify-empty-db
pnpm --filter @text2sql/backend run collect:text2sql-v2-focused-coverage-gate:strict
pnpm --filter @text2sql/backend run collect:text2sql-v2-eval-gate:strict
pnpm --filter @text2sql/backend run collect:text2sql-accuracy-gate
pnpm --filter @text2sql/backend run collect:data-agent-release-gate
pnpm run text2sql:no-legacy-compat:check
pnpm run governance:terminology:check
pnpm run backend:capability-boundary:check
pnpm run format:check
pnpm run test
pnpm run build
graphify update .
```

`collect:text2sql-accuracy-gate:strict` 与 `collect:data-agent-release-gate:strict` 只在准备发布且
具备真实证据时运行；它们在预期 `HOLD` 下必须非零退出，不能通过放宽条件绕过。

故障恢复、诊断、回滚和 GO/NO_GO 操作见
`docs/runbooks/data-agent-task-recovery-and-release.md`。
