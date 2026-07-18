# Text2SQL 准确率门禁规范

## 1. 目的与适用范围

本规范定义 Text2SQL 候选版本如何用可重放证据证明真实业务结果正确。它是现有
Text2SQL v2 eval/focused gate 的增量门禁，不替换旧 closeout，也不扩大 public
runtime 状态枚举。

适用范围：

- `apps/backend/src/modules/conversation/runtime/evaluation/**`
- `apps/backend/scripts/collect-text2sql-accuracy-gate.ts`
- `apps/backend/test/fixtures/text2sql-accuracy/**`
- 后续写入 `trace.v2` 的 accuracy Receipt 与安全投影

## 2. 权威基线

- MUST 用 `guideline-baseline.json` 保存来源 project metadata、选定 RQ、内容
  SHA-256、捕获时间、适用 R-ID 和采用状态。
- MUST 比较上游当前内容与冻结摘要；发生 drift 时列出受影响 R-ID，并在对应门禁
  重跑前保持 `HOLD`。
- MUST 把 `questionSet/semantic/schema/policy/data/model/prompt/workflow/code`
  九元版本完整冻结。任一版本不一致的 Trial 不得与当前 baseline/candidate 混算。
- 上游研究 topic 处于 `exploring` 不等于整个 topic 被批准；项目只采用 baseline 中
  显式列出的内容摘要和需求映射。

## 3. Slice 与 Oracle

- 仓库内只允许脱敏问题、QueryContract 摘要、确定性小型数据、Oracle 合同和内容
  digest。真实数据行、连接串和签名私钥 MUST NOT 入库。
- baseline 与 candidate MUST 在相同问题、Fixture、QueryContract 和预声明版本下
  成对运行。
- 最终 Outcome MUST 至少包含一种 mandatory deterministic oracle：Golden Result、
  Differential、Metamorphic、Mutation 或业务不变量。LLM Judge 可以辅助，但 MUST
  NOT 成为唯一 mandatory oracle。
- 执行成功、结果非空、validation boolean 或 LLM 自评 MUST NOT 单独视为 Outcome
  正确。
- 候选运行前 MUST 冻结阈值、审批人、审批时间、最小真实配对样本、置信区间边界、
  latency SLO 和安全零容忍项。

## 4. 外部真实证据边界

- 真实 Fixture MUST 从 `TEXT2SQL_ACCURACY_FIXTURE_ROOT` 下的相对路径读取。
  loader MUST 拒绝绝对路径、`..`、canonical root 外路径与 root 外 symlink。
- release runner MUST 使用环境内私钥签发 Ed25519 Outcome envelope；项目只配置
  `TEXT2SQL_ACCURACY_TRUSTED_PUBLIC_KEYS_JSON` 公钥 allowlist。
- 签名 envelope MUST 绑定 key id、唯一 evidence id、Trial id、Fixture digest、
  EvalVersionTuple/code digest、签发时间和过期时间。
- 未签名、未知 key、签名失败、过期、超出 trust window、digest 不一致、跨 Trial
  或跨版本重放 MUST 视为无真实 Outcome 证据。
- report、日志、trace 与 delivery MUST NOT 回显 raw envelope、key material、真实行、
  setup SQL、连接串或 external fixture path。

## 5. 发布决策

权威决策只有四态：

- `GO`：预声明阈值和置信区间均通过，真实 `enforce` Outcome 配对样本充足，且安全
  不变量为零。
- `HOLD`：真实证据缺失、样本不足、统计区间不确定、准则 drift 未重跑或能力不可用。
- `NO_GO`：发布前明确低于阈值，或出现安全零容忍违例。
- `ROLLBACK`：canary/online 阶段出现安全违例或已声明的回退条件。

以下计数 MUST 为零：

- `unauthorizedSqlCount`
- `hardGateFalsePassCount`
- `outOfBoundRepairCount`

只有 sanitized/synthetic eval 时，即使 Component/Workflow gate 全部通过，发布决定也
MUST 为 `HOLD`。`gatePass=true` 仅对应 `releaseDecision=GO`。

## 6. 命令与验收

```bash
pnpm --filter @text2sql/backend run collect:text2sql-accuracy-gate
pnpm --filter @text2sql/backend run collect:text2sql-accuracy-gate:strict
```

默认 reference slice 应实际执行 baseline/candidate SQL，并由第二个 Fixture 识别
`SUM(DISTINCT amount)` 静默错误。默认没有受信真实 Receipt，因此非 strict 命令输出
`HOLD` 报告，strict 命令以非零退出码阻止误发布。

涉及本规范的改动至少执行：

```bash
pnpm --filter @text2sql/backend exec jest --runInBand \
  test/unit/text2sql-accuracy-evaluation.spec.ts \
  test/unit/text2sql-outcome-evidence-verifier.spec.ts \
  test/integration/text2sql-accuracy-gate.spec.ts
pnpm --filter @text2sql/backend run lint
```

## 7. 在线准确率 Receipt 与有界修复

- `shadow` evidence 只用于诊断候选能力，不得标记为 sealed/passed、贡献 `GO` 或阻断现有
  baseline 交付；`enforce` 才将下述 Receipt chain 作为用户可见执行与交付硬条件。
- Text-to-SQL supported Slice MUST 冻结 QueryContract 与九元版本，并按
  `intent -> semantic -> structural -> policy -> resource -> sandbox -> result`
  生成可校验 Receipt；任一 hard Gate 为 `failed/unavailable` 时 MUST NOT 执行。
- Execution Permit MUST 绑定 `runId/queryContractDigest/sqlDigest/versions` 和前五个
  Gate Receipt；SQL 或版本变化后旧 Permit 立即失效。
- 执行结果只有在 ExecutionReceipt、ResultReceipt、mandatory deterministic oracle
  与 final ValidationReceipt 全部通过后才可进入 answer。
- Correction 只允许标识符限定/引用和已登记方言等价变换，必须通过 AST semantic
  diff；指标、聚合、过滤、时间、粒度、维度、Join、数据源、策略或结果形状变化均
  MUST fail closed。每个 run 最多两次不同 Patch，`correct` 后直接回到完整
  `validate`，不得回到 LLM 自由生成。

## 8. Trace、Delivery、Replay 与发布组合门禁

- `run.trace.v2.accuracy` 是完整 compact evidence 的 canonical owner；大型或敏感
  receipt evidence 通过 `artifactRefs[accuracy_receipts]` 引用。
- `run.delivery.evidence.v2.accuracy`、stream `finish` 与 replay 只暴露同一个安全摘要：
  Gate statuses、SQL digest、repair count、terminal reason、sealed receipt ref、stale 与
  evidence-valid 状态。不得暴露 raw QueryContract、policy payload、AST、真实 Fixture
  路径或 partial rows。
- replay MUST 移除完整 `trace.v2.accuracy`；当当前版本元组与记录版本不一致时显示
  `accuracy_version_tuple_stale`，不得复用旧 ContextPack 或 Permit。
- 保存视图时若 accuracy evidence digest/parent chain 无效，MUST 拒绝保存；`enforce`
  Text-to-SQL execution 缺少 passed final ValidationReceipt 时也 MUST 拒绝保存。`shadow`
  摘要不得伪装为 final receipt，但不改变既有 baseline save-view 合同。
- accuracy collector MUST 组合 v2 eval/focused/characterization/no-legacy closeout 与真实
  Outcome 证据。closeout 通过但真实 Outcome 缺失时仍为 `HOLD`；strict 仅在最终
  `GO` 时零退出。
