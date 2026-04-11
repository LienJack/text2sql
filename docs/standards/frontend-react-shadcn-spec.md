# 前端项目规范（React + shadcn-ui）

## 1. 目的
本规范用于约束 `apps/frontend` 的实现与评审，确保前端重写过程稳定、可审计、可回归，降低“风格漂移”和“改动出错”风险。

## 2. 适用范围
- 适用于 `apps/frontend/src/app` 与 `apps/frontend/src/components` 下全部页面与组件。
- 适用于新增功能、重构改造、缺陷修复与样式调整。

## 3. 强制技术约束（MUST）
- 前端 UI 必须使用 React 函数组件实现。
- 组件基线必须使用 shadcn-ui 体系（可封装业务组件，但基础交互组件来源保持一致）。
- shadcn 组件初始化与新增必须优先使用官方 CLI（`pnpm dlx shadcn@latest init` / `pnpm dlx shadcn@latest add ...`），避免手工复制导致漂移。
- Next.js 前端样式体系必须使用 Tailwind CSS v4（`tailwindcss` + `@tailwindcss/postcss`），禁止回退到 v3 配置模式。
- 业务组件中禁止常规内联样式（`style={{...}}`）；样式应通过统一样式体系表达。
- 禁止在未决策前引入第二套重型 UI 组件库（如 Ant Design、MUI）。
- 任何页面改造必须保留核心演示链路可用：进入演示页、发送消息、查看 SQL 预览与状态。

## 4. 代码组织约束（MUST）
- 页面路由放在 `apps/frontend/src/app`，可复用 UI 组件放在 `apps/frontend/src/components`。
- 新增组件应优先复用已有 shadcn 基础组件，不得重复造轮子实现同类基础控件。
- 共享类型继续使用 `@text2sql/shared-types`，避免前后端类型语义漂移。

## 5. 状态与交互约束（MUST）
- 用户可见交互必须覆盖至少四类状态：`loading`、`empty`、`error`、`success`。
- 表单与提交动作必须具备禁用态和错误反馈，不允许静默失败。
- 关键视图必须在移动端宽度（至少 375px）可用，不允许核心操作不可点击或内容溢出不可读。

## 6. 评审清单（PR Checklist）
- [ ] 本次改动仅使用 React + shadcn-ui 体系，不引入未批准 UI 框架。
- [ ] 业务组件未使用常规内联样式对象。
- [ ] 关键状态（loading/empty/error/success）可见且可验证。
- [ ] 核心链路（会话创建、消息发送、SQL 预览）无回归。
- [ ] 已补充或更新必要测试（单测/集成测试）。

## 7. 质量门禁（CI Gate）
- 合并前必须通过：
  - `pnpm --filter @text2sql/frontend lint`
  - `pnpm --filter @text2sql/frontend test`
  - `pnpm --filter @text2sql/frontend build`
- 任一检查失败时不得合并。

## 8. 变更管理
- 如需突破本规范（例如引入新 UI 框架或特殊内联样式），必须先补充决策记录并在评审中显式批准。
- 本规范由前端重写任务维护，后续所有前端 PR 默认遵循本文件。

## 9. 防错闭环（执行顺序）
1. 开发者本地提交前执行：
   - `pnpm --filter @text2sql/frontend lint`
   - `pnpm --filter @text2sql/frontend test`
2. PR 描述必须逐项勾选第 6 节检查项，并说明本次涉及页面/组件范围。
3. CI 复跑第 7 节门禁，任一失败即阻断合并。
4. 合并后执行一次核心链路冒烟验证：进入聊天页、发送消息、查看 SQL 预览与错误提示。
