---
title: Data Source Workflow Context Binding with Table Permissions
date: 2026-04-16
category: workflow-issues
module: data-sources
problem_type: workflow_issue
component: development_workflow
severity: high
applies_when:
  - A flow creates or edits a data source and must immediately bind workspace context
  - Session entry must keep datasource and workspace context explicit
  - Retries must avoid duplicated side effects with idempotency keys
  - Table governance is managed by workspace table-permissions endpoints
root_cause: inadequate_documentation
resolution_type: documentation_update
tags:
  - datasource
  - workflow
  - workspace-binding
  - table-permissions
  - idempotency
---

# Data Source Workflow Context Binding with Table Permissions

## Context
The earlier guidance coupled datasource create/edit workflow with inline ACL payload and `acl_apply` stage semantics. Current contracts no longer use that model: datasource workflow now handles workspace creation (optional), datasource create/update, workspace binding, idempotency replay, and audit lifecycle; table governance moved to dedicated workspace table-permissions APIs.

## Guidance
Treat `POST /api/v1/datasources/workflow` as a **context and binding orchestration endpoint**, not a governance-write endpoint.

Use this split:
- Datasource workflow (`/api/v1/datasources/workflow`) for workspace + datasource + binding lifecycle.
- Table governance (`/api/v1/system/workspaces/:workspaceId/datasources/:datasourceId/table-permissions`) for replace-style table authorization.

Practical rules:
- Do not include `acl` in datasource workflow payloads.
- Reuse one `x-idempotency-key` when retrying the same workflow submit.
- Keep session creation explicit with `datasource` (and `workspaceId` when available).
- Handle workflow failures by stage (`workspace_*`, `datasource_*`, `binding_*`) rather than legacy ACL stage names.

Reference implementation surfaces:
- Backend workflow contract: [`apps/backend/src/modules/governance/datasource/dto/upsert-datasource-workflow.dto.ts`](../../../apps/backend/src/modules/governance/datasource/dto/upsert-datasource-workflow.dto.ts), [`apps/backend/src/modules/governance/datasource/datasource-workflow.service.ts`](../../../apps/backend/src/modules/governance/datasource/datasource-workflow.service.ts)
- Frontend workflow submit + retry idempotency: [`apps/frontend/src/lib/api-client.ts`](../../../apps/frontend/src/lib/api-client.ts), [`apps/frontend/src/app/data-sources/page.tsx`](../../../apps/frontend/src/app/data-sources/page.tsx), [`apps/frontend/tests/unit/data-sources-page.spec.tsx`](../../../apps/frontend/tests/unit/data-sources-page.spec.tsx)
- Table-permissions governance API client: [`apps/frontend/src/lib/admin-api-client.ts`](../../../apps/frontend/src/lib/admin-api-client.ts)

## Why This Matters
This contract split prevents stale assumptions that break cross-layer behavior:
- Workflow retries remain deterministic with stable idempotency identity.
- Runtime error handling matches real backend stage vocabulary.
- Governance semantics are unified under table-permissions, avoiding legacy ACL/rule-group drift.
- Session routing and execution context stay explicit and auditable.

## When to Apply
- `/data-sources` wizard supports create/edit and immediate chat entry.
- You need safe retry behavior after transient network or stage failures.
- You are integrating admin governance UI with workspace datasource permissions.
- You are refreshing docs/tests that still reference inline ACL workflow payloads.

## Examples
Datasource workflow submit (no inline ACL):

```http
POST /api/v1/datasources/workflow
Content-Type: application/json
x-idempotency-key: datasource-editor-8f1b8e6b

{
  "mode": "create",
  "workspace": {
    "create": {
      "name": "增长分析"
    }
  },
  "datasource": {
    "name": "mysql-analytics",
    "type": "mysql",
    "host": "127.0.0.1",
    "port": 3306,
    "database": "analytics",
    "username": "reader",
    "password": "******"
  }
}
```

Table-permissions replace write:

```http
PUT /api/v1/system/workspaces/ws_123/datasources/ds_456/table-permissions
Content-Type: application/json
x-idempotency-key: table-permissions-replace-001

{
  "tableNames": ["orders", "users"],
  "policyVersion": 3
}
```

Session creation with explicit context:

```http
POST /api/v1/sessions
Content-Type: application/json

{
  "datasource": "ds_456",
  "workspaceId": "ws_123"
}
```

## Related
- Rollout notes: [`docs/plans/2026-04-16-004-feat-workspace-table-checklist-parity-rollout-notes.md`](../../plans/2026-04-16-004-feat-workspace-table-checklist-parity-rollout-notes.md)
- Plan: [`docs/plans/2026-04-16-005-feat-workspace-binding-table-permission-modal-entry-plan.md`](../../plans/2026-04-16-005-feat-workspace-binding-table-permission-modal-entry-plan.md)
- Requirements origin: [`docs/brainstorms/2026-04-15-user-workspace-management-sqlbot-parity-requirements.md`](../../brainstorms/2026-04-15-user-workspace-management-sqlbot-parity-requirements.md)
