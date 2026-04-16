---
title: Data Source Create/Edit ACL Workflow Closure
date: 2026-04-15
category: workflow-issues
module: data-sources
problem_type: workflow_issue
component: development_workflow
severity: high
applies_when:
  - A UI flow creates or edits a data source and must apply workspace ACL in the same action
  - Session entry depends on explicit data source context
  - Retries must be safe without duplicated side effects
symptoms:
  - Session creation behavior diverges when datasource context is missing
  - ACL application can drift from datasource create or edit operations
  - Multi-step submit paths risk partial success without clear stage reporting
root_cause: missing_workflow_step
resolution_type: workflow_improvement
tags:
  - datasource
  - workspace-acl
  - session-context
  - idempotency
  - audit
---

# Data Source Create/Edit ACL Workflow Closure

## Context
On April 15, 2026, the repository closed a cross-layer workflow gap in `/data-sources`: create/edit, workspace binding, ACL apply, idempotency, compensation, and audit behavior were consolidated into one workflow contract. This work is reflected in the plan [2026-04-15-003](/Users/lienli/Documents/GitHub/text2sql/docs/plans/2026-04-15-003-feat-data-sources-edit-acl-workflow-plan.md) and captured in workspace memory at [`.omx/notepad.md`](/Users/lienli/Documents/GitHub/text2sql/.omx/notepad.md).

## Guidance
Use a single workflow submission for datasource create/edit and ACL application, instead of chaining separate API calls. Keep session and routing context explicit by always passing `datasource` (and `workspaceId` when available) on session operations. Reuse one idempotency key for retries of the same workflow submission so repeated requests stay side-effect safe.

Reference implementation surfaces:
- Backend workflow orchestration: [`datasource-workflow.service.ts`](/Users/lienli/Documents/GitHub/text2sql/apps/backend/src/modules/datasource/datasource-workflow.service.ts)
- Session contract enforcement: [`chat.controller.ts`](/Users/lienli/Documents/GitHub/text2sql/apps/backend/src/modules/chat/chat.controller.ts), [`chat.service.ts`](/Users/lienli/Documents/GitHub/text2sql/apps/backend/src/modules/chat/chat.service.ts)
- Frontend context alignment and submit path: [`datasource-session-context.ts`](/Users/lienli/Documents/GitHub/text2sql/apps/frontend/src/lib/datasource-session-context.ts), [`api-client.ts`](/Users/lienli/Documents/GitHub/text2sql/apps/frontend/src/lib/api-client.ts), [`data-sources/page.tsx`](/Users/lienli/Documents/GitHub/text2sql/apps/frontend/src/app/data-sources/page.tsx)

## Why This Matters
This pattern prevents half-finished state across backend and frontend boundaries:
- Session creation no longer relies on implicit datasource fallback.
- Workflow stages are explicit and auditable (`workspace_create`, `datasource_create|update`, `binding_apply`, `acl_apply`, `audit`).
- Failure paths can compensate create-stage side effects and keep final state explainable.
- ACL semantics stay consistent between settings flows and data-source flows because logic is reused instead of duplicated.

## When to Apply
- A flow can both create/edit a datasource and immediately enter chat.
- Workspace context may be absent at entry and needs inline creation.
- The same operation can be retried by users or clients after transient failures.
- Policy and audit guarantees must remain correct even when one stage fails.

## Examples
```http
POST /api/v1/sessions
Content-Type: application/json

{
  "datasource": "sqlite_main",
  "workspaceId": "ws_123"
}
```

```http
POST /api/v1/datasources/workflow
Content-Type: application/json
x-idempotency-key: datasource-workflow-create-001

{
  "mode": "create",
  "workspaceId": "ws_123",
  "datasource": {
    "name": "mysql-analytics",
    "type": "mysql",
    "host": "127.0.0.1",
    "port": 3306,
    "database": "analytics",
    "username": "reader",
    "password": "******"
  },
  "acl": {
    "subjectType": "role",
    "subjectId": "member",
    "effect": "allow",
    "tableNames": ["orders"]
  }
}
```

Evidence targets used during implementation:
- [`datasource-api.spec.ts`](/Users/lienli/Documents/GitHub/text2sql/apps/backend/test/e2e/datasource-api.spec.ts)
- [`chat-api.spec.ts`](/Users/lienli/Documents/GitHub/text2sql/apps/backend/test/e2e/chat-api.spec.ts)
- [`data-sources-page.spec.tsx`](/Users/lienli/Documents/GitHub/text2sql/apps/frontend/tests/unit/data-sources-page.spec.tsx)

## Related
- Plan: [Workspace Datasource Table ACL](/Users/lienli/Documents/GitHub/text2sql/docs/plans/2026-04-15-002-feat-workspace-datasource-table-acl-plan.md)
- Plan: [Data Sources Edit ACL Workflow](/Users/lienli/Documents/GitHub/text2sql/docs/plans/2026-04-15-003-feat-data-sources-edit-acl-workflow-plan.md)
- Requirements origin: [User Workspace Management SQLBot Parity](/Users/lienli/Documents/GitHub/text2sql/docs/brainstorms/2026-04-15-user-workspace-management-sqlbot-parity-requirements.md)
