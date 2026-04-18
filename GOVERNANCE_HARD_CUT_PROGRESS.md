# Governance Hard Cut Progress (2026-04-18)

Branch: `codex/governance-terminology-hard-cut-exec`

## Current Status

- Unit 1 (boundary scaffold): done
- Unit 2 (physical migration + import cutover): done
- Unit 3 (canonical contract hard cut): done
- Unit 4 (regression matrix realignment): done
- Unit 5 (docs alignment): done
- Unit 6 (terminology gate + pilot output): done

## What Landed

1. Governance modules moved to `apps/backend/src/modules/governance/**`.
2. Backend source/test import graph rewired off legacy governance roots.
3. Frontend governance client tightened to canonical table-permissions payload fields.
4. Backend e2e now asserts legacy table-permissions payload keys are rejected.
5. Terminology drift guard added:
   - `scripts/check-governance-terminology.ts`
   - `.github/workflows/governance-terminology-quality.yml`
   - `pnpm run governance:terminology:check`
6. Governance mainline internals completed terminology hard cut:
   - query execution input key renamed from `acl` to `tablePermissions`
   - guard/domain error codes renamed to `TABLE_PERMISSIONS_*`
   - audit event type renamed to `workspace.datasource.table-permissions.denied`
7. Regression matrix aligned with canonical wording:
   - renamed test suites/files from `*acl*` to `*table-permissions*`
   - updated assertions to new error/event codes
8. Documentation hard-cut alignment completed on core standards/docs:
   - `README.md`
   - `AGENTS.md`
   - `docs/business-logic.md`
   - `docs/standards/frontend-react-shadcn-spec.md`
   - `docs/standards/llm-stream-tool-migration-spec.md`
   - `docs/standards/backend-prisma-migration-spec.md`
   - `docs/standards/governance-terminology-spec.md`
9. Unit 6 guardrail outputs are in place and validated:
   - terminology check script + CI workflow
   - execution log / progress tracker updates synchronized

## Validation Snapshot

- `pnpm --filter @text2sql/backend run build` pass
- `pnpm --filter @text2sql/backend run lint` pass
- `pnpm --filter @text2sql/frontend run lint` pass
- `pnpm --filter @text2sql/frontend run build` pass
- `pnpm run test` pass
- `pnpm run build` pass
- `pnpm run governance:terminology:check` pass
- `pnpm --filter @text2sql/backend run test -- test/unit/sql-table-access-guard.spec.ts test/unit/safety-check.node.spec.ts test/integration/query-executor-router-table-permissions.spec.ts test/integration/audit-log.repository.spec.ts test/e2e/workspace-datasource-audit.spec.ts` pass
- `pnpm --filter @text2sql/backend run test -- test/e2e/chat-table-permissions-policy.spec.ts test/integration/workspace-datasource-table-permissions-schema.spec.ts` pass
- `pnpm --filter @text2sql/frontend run test -- settings-retired-governance-management.spec.tsx` pass
- `pnpm run governance:terminology:check` pass (post-doc-alignment recheck)
- `graphify update .` pass (post-change graph refresh)

## Next Steps

1. Add Gate A owner sign-off record and close Gate C.
2. Final PR scope decision for graphify artifact updates.
3. Stage/commit by logical units and prepare PR description.

## Detailed Log

- Full execution notes: `docs/plans/2026-04-18-004-refactor-governance-domain-terminology-hard-cut-execution-log.md`
