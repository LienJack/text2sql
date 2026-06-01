# Text2SQL

English | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

Text2SQL is a full-stack learning and demo project for enterprise-style data question answering. It turns natural-language questions into governed, executable, replayable SQL, and connects datasource onboarding, semantic knowledge, permission governance, runtime evidence, and frontend interaction into one complete workflow.

![Text2SQL platform overview](assets/readme-platform-overview.png)

## Project Background

Business teams often know what they want to ask, but not which table contains the data, how a metric is defined, or how the SQL should be written. Sending the question directly to an LLM is not enough either: the model can guess the schema incorrectly, miss business terminology, bypass table permissions, and leave little explanation for why a SQL statement was produced.

This project is not a prompt-only SQL generator. It is a Text2SQL platform prototype shaped around production-like constraints:

- Users ask questions from a datasource context, while the system binds sessions, workspaces, and data permissions.
- Before SQL generation, the agent retrieves schema, glossary terms, historical examples, and semantic assets.
- Generated SQL must pass read-only, safety, permission, dialect, and execution checks.
- Each run has a `runId` for tracing, RAG evidence, delivery artifacts, and replay.
- Frontend and backend stay aligned through shared types and an SSE protocol package for sync responses, streaming responses, and run details.

## Problems Solved

1. **The context gap between natural language and SQL**
   Users say "revenue", "active customers", or "trend over the last 30 days"; databases expose tables, columns, foreign keys, metrics, and business terms. The project uses RAG, semantic spine, glossary, and modeling workspace assets to turn that context into evidence before SQL generation.

2. **Uncontrolled LLM generation**
   The Text2SQL v2 runtime uses explicit LangGraph orchestration. Intake, retrieval, context assembly, semantic planning, SQL generation, validation, correction, execution, and answer delivery are observable stages instead of one large prompt.

3. **Data permissions and safe execution**
   A query is not accepted merely because it runs. Governance is centered on workspace datasource binding, table-permissions, and policyVersion. The execution path favors fail-closed behavior when the system is uncertain, unauthorized, or unable to parse safely.

4. **Hard-to-debug failures**
   Every analytical run is saved around a `runId`. Sync responses, streaming finish events, run views, and RAG replay all point toward the same delivery contract, making it easier to inspect retrieval hits, SQL generation, correction, execution, and frontend rendering.

5. **End-to-end demos across multiple datasource types**
   The project supports SQLite, MySQL, PostgreSQL, CSV, and Excel datasources, with frontend workbench pages such as `/data-sources`, `/chat`, `/settings`, and `/modeling` for demos and continued extension.

## Feature Preview

### Semantic Modeling Workbench

![Semantic modeling workbench](assets/screenshots/01-modeling-erd-workbench.png)

The relationship graph turns physical table structure into manageable semantic assets. The left panel contains the Models / Views asset tree, the center hosts the ERD canvas, and the selected model context can be inspected through fields, relationships, and previews. Users can sync databases, auto-layout the graph, maintain relationships, save a Modeling Draft, and publish it as the active version after checks pass.

### Datasource Onboarding Wizard

![Datasource onboarding wizard](assets/screenshots/02-datasource-create-wizard.png)

The datasource page connects databases and files to a workspace. The wizard supports CSV, Excel, SQLite, MySQL, and PostgreSQL. Creating or editing a datasource automatically binds it to the current workspace, and idempotency keys prevent duplicate submissions. After creation, users can start a data question session directly or continue with table selection and modeling initialization.

### ChatBI Workbench

![ChatBI workbench](assets/screenshots/03-chat-answer-result.png)

The Chat page is the main natural-language analytics entry point. Each session is bound to a datasource and model configuration, while the sidebar separates historical sessions by datasource. The main area shows the user question, agent runtime stages, final answer, table evidence, and the save-as-view entry point. The answer is not plain text only; it is a structured delivery result with `validation`, execution summary, and artifacts.

### SQL Evidence Replay

![SQL evidence replay](assets/screenshots/04-chat-sql-evidence.png)

The same ChatBI result can be switched to the SQL evidence tab to inspect the SQL used for the answer. This view supports human verification, debugging replay, and governance audit: users can confirm whether the generated query, ordering, aggregation, and selected fields match business expectations.

### Chart Result

![Chart result](assets/screenshots/05-chat-chart-result.png)

Result artifacts can also be projected as charts. The example renders payment-method share as a visual result. Answer, View SQL, and Chart all share evidence from the same run, avoiding drift between textual output, SQL, and visualization.

## Design Philosophy

- **Evidence before generation**: schema, glossary terms, relationships, permissions, and examples are organized as typed context before SQL is generated.
- **Graph orchestration over prompt chaining**: important stages exist as runtime nodes, making them easier to observe, test, stream, and replace locally.
- **Governance built into the main path**: workspace, datasource, table-permissions, and safety validation are part of the workflow, not after-the-fact patches.
- **Useful without silent degradation**: RAG lanes may time out or degrade independently, but the reasons are written into evidence instead of hidden.
- **Bounded correction**: SQL correction is a budgeted loop, avoiding unbounded agent retries.
- **Stable contracts**: shared-types and chat-stream-protocol packages define the frontend/backend boundary so sync, stream, and replay behavior do not drift apart.

## Architecture

### Monorepo Structure

```text
apps/backend                  NestJS API, Text2SQL runtime, governance, knowledge, and platform capabilities
apps/frontend                 Next.js frontend workbench
packages/shared-types         Shared frontend/backend types
packages/chat-stream-protocol SSE envelope, parser, terminal guard, and UI projection helpers
infra                         Local PostgreSQL, Redis, and Nginx orchestration
data                          Local uploads, SQLite files, and runtime data
docs                          Solutions, standards, troubleshooting, and understanding documents
```

### System Overview

```mermaid
flowchart LR
  User["Browser"] --> Gateway["Nginx gateway<br/>localhost:3000"]
  Gateway --> Frontend["Frontend<br/>Next.js :3001"]
  Gateway --> Backend["Backend<br/>NestJS :3002"]

  Backend --> Conversation["conversation<br/>chat + text2sql + delivery"]
  Backend --> Governance["governance<br/>workspace + datasource + table-permissions"]
  Backend --> Knowledge["knowledge<br/>RAG + glossary + semantic spine + graph"]
  Backend --> Platform["platform<br/>persistence + query + cache + config + observability"]

  Conversation --> Governance
  Conversation --> Knowledge
  Conversation --> Platform
  Governance --> Platform
  Knowledge --> Platform

  Platform --> Postgres["PostgreSQL"]
  Platform --> Redis["Redis"]
  Platform --> Datasources["SQLite / MySQL / PostgreSQL / CSV / Excel"]
```

### Four Backend Capability Domains

| Domain | Directory | Responsibility |
| --- | --- | --- |
| `conversation` | `apps/backend/src/modules/conversation` | Chat entry points, Text2SQL workflow, LangGraph runtime, delivery contract |
| `governance` | `apps/backend/src/modules/governance` | Workspaces, datasource binding, table permissions, users, and settings governance |
| `knowledge` | `apps/backend/src/modules/knowledge` | RAG retrieval, semantic assets, glossary, memory, graph, and modeling context |
| `platform` | `apps/backend/src/modules/platform` | Persistence, query execution, cache, configuration, observability, and read-model guards |

Cross-domain dependencies are intentionally constrained:

```text
conversation -> governance | knowledge | platform
governance   -> platform
knowledge    -> platform
platform     -> no business-domain dependency
```

### Text2SQL v2 Runtime

The current main runtime path is:

```text
Text2SQLWorkflowRunner
  -> RunV2LangGraphStage
  -> Text2SqlV2LangGraphRunnerService
```

A typical analytical question follows this lifecycle:

```mermaid
flowchart TD
  A["intake<br/>classify question type and risk"] --> B{"route"}
  B -- "text_to_sql / metadata" --> C["retrieve<br/>RAG retrieval"]
  B -- "general / unsafe / unsupported" --> I["answer"]
  C --> D["assemble-context<br/>build selected context"]
  D --> E["semantic-plan<br/>semantic plan and routing"]
  E -- "ready" --> F["generate-sql"]
  E -- "clarify / direct answer / fail closed" --> I
  F --> G["validate<br/>read-only, safety, permission, dialect, dry-run"]
  G -- "pass" --> H["execute"]
  G -- "correctable" --> J["correct"]
  G -- "terminal" --> I
  J -- "retry_generation" --> F
  J -- "terminal" --> I
  H --> I["answer<br/>delivery + evidence + artifact"]
```

### RAG And Semantic Context

RAG is not simple text concatenation. The current design emphasizes:

- manifest-first semantic asset preparation
- lexical, dense, and graph retrieval lanes
- permission filtering before fusion and reranking
- RRF fusion and two-stage rerank
- `selected_context`, `degradeReasons`, and `riskTags` written into runtime evidence
- `runId` threaded through trace, delivery, and replay

## Installation And Run

### Requirements

- Node.js 20 or compatible
- pnpm 10.x; this repository declares `pnpm@10.33.0`
- Docker and Docker Compose

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Start Local Infrastructure

```bash
docker compose -f infra/docker-compose.yml up -d
```

This starts:

- Nginx gateway: `http://localhost:3000`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

### 3. Initialize Environment Variables

```bash
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env
```

Important backend configuration lives in `apps/backend/.env`:

- `PORT=3002`
- `POSTGRES_HOST/POSTGRES_PORT/POSTGRES_DB/POSTGRES_USER/POSTGRES_PASSWORD`
- `REDIS_URL=redis://localhost:6379`
- `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`
- `EMBEDDING_PROVIDER`, `EMBEDDING_BASE_URL`, `EMBEDDING_API_KEY`, `EMBEDDING_MODEL`
- `RERANK_*` is optional and can fall back to the LLM provider configuration when not configured

The frontend uses same-origin `/api` by default, so `NEXT_PUBLIC_API_BASE_URL` usually does not need to be changed.

### 4. Prepare Prisma

```bash
pnpm --filter @text2sql/backend run prisma:generate
pnpm --filter @text2sql/backend exec node scripts/prisma-with-database-url.cjs migrate deploy
```

To verify that migrations can replay from an empty database, run against a separate test database:

```bash
DATABASE_URL=postgresql://admin:admin@localhost:5432/text2sql_ci \
pnpm --filter @text2sql/backend run prisma:verify-empty-db
```

### 5. Start Frontend And Backend

```bash
pnpm dev
```

Default URLs:

- Gateway: `http://localhost:3000`
- Datasource entry: `http://localhost:3000/data-sources`
- Frontend direct debugging: `http://localhost:3001`
- Backend health check: `http://localhost:3002/health`

### 6. Quick Smoke Test

```bash
node tests/smoke/nginx-dev-gateway-smoke.mjs
```

## Common Workflows

### From Datasource To Data Question

1. Open `http://localhost:3000/data-sources`
2. Create or select a SQLite, MySQL, PostgreSQL, CSV, or Excel datasource
3. Bind it to the current workspace and enter a session
4. Ask a natural-language question in `/chat`
5. Inspect the answer, SQL, execution result, and debugging evidence

### Settings And Governance

- `/settings`: LLM model, RAG configuration, RAG run, system users, and other settings
- `/glossary`: business glossary maintenance
- `/modeling`: datasource modeling, relationships, and semantic views
- `/prompts`: prompt template management

## Quality Gates

Repository-wide:

```bash
pnpm run format:check
pnpm run test
pnpm run build
```

Backend:

```bash
pnpm --filter @text2sql/backend run lint
pnpm --filter @text2sql/backend run test
pnpm --filter @text2sql/backend run build
pnpm --filter @text2sql/backend run prisma:verify-empty-db
```

Frontend:

```bash
pnpm --filter @text2sql/frontend run lint
pnpm --filter @text2sql/frontend run test
pnpm --filter @text2sql/frontend run build
```

Specialized gates:

```bash
pnpm run governance:terminology:check
pnpm run backend:capability-boundary:check
pnpm run text2sql:no-legacy-compat:check
pnpm --filter @text2sql/backend run collect:text2sql-v2-eval-gate
pnpm --filter @text2sql/backend run collect:text2sql-v2-focused-coverage-gate
pnpm --filter @text2sql/backend run collect:modeling-parity-shadow-gate
```

## Important Rules

- Prisma schema changes must start in `apps/backend/prisma/schema.prisma`, then migrations must be generated by the Prisma CLI.
- Do not handwrite or manually edit `apps/backend/prisma/migrations/*/migration.sql`.
- After table structure changes, run `pnpm --filter @text2sql/backend run prisma:generate`.
- Frontend interactive controls should reuse shadcn-ui and project business wrappers first.
- The active governance narrative uses only `workspace datasource binding`, `table-permissions`, and `policyVersion`.

## Further Reading

- `AGENTS.md`: repository execution entry point, hard boundaries, and quality gates
- `docs/text2sql-architecture-and-flow-2026-04-29.md`: current architecture and Text2SQL main flow
- `docs/rag-understanding/text2sql-rag-end-to-end-understanding.md`: end-to-end Text2SQL + RAG explanation
- `docs/rag-understanding/text2sql-rag-runid-replay-handbook.md`: runId replay and diagnosis
- `docs/rag-understanding/text2sql-rag-local-learning-lab.md`: local learning lab
- `docs/standards/backend-prisma-migration-spec.md`: Prisma migration standard
- `docs/standards/frontend-react-shadcn-spec.md`: frontend React + shadcn standard
- `docs/standards/llm-stream-tool-migration-spec.md`: LLM stream and tool calling migration standard
- `docs/standards/governance-terminology-spec.md`: governance terminology hard-cut standard
- `docs/standards/backend-business-capability-topology-spec.md`: backend capability topology standard
