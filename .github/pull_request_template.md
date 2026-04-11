## Summary
- [ ] 简述本次改动范围与目标

## Frontend Checklist
- [ ] 仅使用 React + shadcn-ui 体系，未引入未批准 UI 框架
- [ ] 业务组件未使用常规内联样式对象（`style={{...}}`）
- [ ] 覆盖并验证了关键状态（loading/empty/error/success）
- [ ] 核心链路（会话创建、消息发送、SQL 预览）无回归
- [ ] 已补充或更新必要测试

## Validation
- [ ] `pnpm --filter @text2sql/frontend lint`
- [ ] `pnpm --filter @text2sql/frontend test`
- [ ] `pnpm --filter @text2sql/frontend build`

## Post-Deploy Monitoring & Validation
- [ ] No additional operational monitoring required（前端展示层改造，无后端运行时逻辑变化）
