# ce:review summary

- Scope: PR #23 against `origin/dev` (`b28e0df32113db7706cd65c88204ecbe2ec4a426`)
- Intent: hard-cut the Text2SQL v2 workflow spine and RAG runtime/config surfaces without regressing run-view, delivery, or deployment gates
- Reviewers completed: correctness, testing, maintainability, project-standards, security, data-migrations, frontend-agent-native
- Additional local verification: `pnpm run backend:capability-boundary:check` (failed as reported)

## Findings

1. `apps/backend/src/modules/data/persistence/rag-task-config.repository.ts`
   Stored RAG API keys are retained when provider/model/baseUrl changes omit `apiKey`, which lets persisted health checks forward the old secret to a new caller-controlled endpoint.
2. `apps/backend/src/modules/data/persistence/rag-task-config.repository.ts`
   Prisma read/write failures are swallowed and replaced with in-memory success semantics, so persisted RAG settings can appear saved but disappear after restart.
3. `apps/backend/src/modules/conversation/chat/application/run-view.usecase.ts`
   Legacy `latestRun` records now make the whole session-view endpoint unreadable because `getSessionView()` hard-fails while populating `latestRun`.
4. `apps/backend/src/modules/conversation/artifacts/text2sql-v2-artifact-ref.service.ts`
   The new conversation import of `knowledge/contracts/knowledge-facade.contract` fails the mandatory backend capability-boundary gate.
5. `.github/workflows/backend-prisma-quality.yml`
   The new hard-cut CI step only runs the synthetic focused-coverage gate spec and skips mandatory `collect:text2sql-v2-eval-gate` / `text2sql:no-legacy-compat:check` coverage.
6. `apps/backend/src/modules/conversation/delivery/delivery-contract.mapper.ts`
   Delivery evidence marks any skipped `generate-sql` stage as a saved-prior-SQL shortcut hit, which mislabels metadata/general no-SQL routes.

## Residual risks

- `/api/v1/settings/rag-configs` is still fetched on the frontend before role-gating settles, and the endpoint itself is not admin-guarded.
- Overlapping `loadRagConfigView()` requests can still restore stale config state in the settings page.
- One reviewer lane (`api-contract`) timed out; learnings were synthesized locally from plans/solutions instead of a dedicated subagent.
