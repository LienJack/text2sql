# AGENTS.md - Project Guide (AI-First)

## Project Overview
Text2SQL is an AI-powered engine designed to transform natural language queries into executable SQL commands for various data sources. The project follows a structured evolution from foundation closure (R0-R1) to large-scale semantic stabilization (R2-R6).

## Monorepo Structure

- `apps/backend`: NestJS application serving the core Text2SQL logic, LLM gateway, and persistence layer. Uses Prisma ORM.
- `apps/frontend`: Next.js application (React) providing the chat interface and admin console. Built with shadcn-ui and Tailwind CSS v4.
- `packages/shared-types`: Common TypeScript definitions shared between backend and frontend to ensure interface parity.
- `infra`: Infrastructure orchestration via Docker Compose (PostgreSQL, Redis).
- `data`: Local data storage, including SQLite databases and migration snapshots.

## Technical Stack

- **Backend**: NestJS, Prisma ORM, Vercel AI SDK, LangChain/LangGraph.
- **Frontend**: Next.js 14, React 18, Tailwind CSS v4, shadcn-ui.
- **Database**: PostgreSQL (main), SQLite (local/mock), Redis (caching/buffering).
- **Quality**: Jest (backend), Vitest (frontend), ESLint, TypeScript.

## Getting Started

1. **Prerequisites**: Ensure `pnpm` and `docker` are installed.
2. **Setup Environment**:
   ```bash
   # Create .env files from templates
   cp apps/backend/.env.example apps/backend/.env
   cp apps/frontend/.env.example apps/frontend/.env
   ```
3. **Start Infrastructure**:
   ```bash
   docker compose -f infra/docker-compose.yml up -d
   ```
4. **Install Dependencies**:
   ```bash
   pnpm install
   ```
5. **Prepare Database**:
   ```bash
   # Generate Prisma client and run migrations
   pnpm --filter @text2sql/backend run prisma:generate
   pnpm --filter @text2sql/backend run prisma:migrate -- --name init
   ```
6. **Start All Servers**:
   ```bash
   pnpm dev
   ```

## Standard Operations

| Task | Command | Scope |
|------|---------|-------|
| Install Deps | `pnpm install` | Root |
| Startup All | `pnpm dev` | Root |
| Start Backend | `pnpm --filter @text2sql/backend run dev` | Backend |
| Start Frontend | `pnpm --filter @text2sql/frontend run dev` | Frontend |
| Prisma Studio | `pnpm --filter @text2sql/backend run prisma:studio` | DB Management |
| Build All | `pnpm build` | Root |

## Quality Gates

Before submitting a Pull Request, ensure all local validation steps pass:

### 1. Backend Validation
- **Lint**: `pnpm --filter @text2sql/backend run lint` (Checks TypeScript errors)
- **Test**: `pnpm --filter @text2sql/backend run test` (Runs unit tests)
- **DB Check**: `pnpm --filter @text2sql/backend run prisma:verify-empty-db` (Verifies migration reproducibility)

### 2. Frontend Validation
- **Lint**: `pnpm --filter @text2sql/frontend run lint` (Checks ESLint and TypeScript)
- **Test**: `pnpm --filter @text2sql/frontend run test` (Runs Vitest)
- **Build**: `pnpm --filter @text2sql/frontend run build` (Ensures build artifact is stable)

### 3. Shared Types Validation
- **Build**: `pnpm --filter @text2sql/shared-types run build` (Ensures shared interface integrity)

## Runtime Health Checks

The backend provides a detailed health check endpoint at `GET /health` to verify runtime configuration and connectivity.

### Critical Verification Points:
- `status`: Should be `ok`.
- `dependencies.llm.streamingEnabled`: Must be `true`.
- `dependencies.llm.toolCallingEnabled`: Must be `true` (if tool calls are supported).
- `dependencies.sqlite.ready`: Should be `true`.
- `dependencies.gateMetrics.acceptance.gatePass`: Must be `true` for R1 release.
- `datasources`: Should list the expected data source endpoints.

## Standard Guidelines

This section provides essential highlights from our standard documents. Refer to the full specs for detailed rules.

### 1. Backend Prisma Migrations
- **Scope**: `apps/backend/prisma/`
- **Key Mandatory**: No manual edits to `migration.sql`. Migrations MUST be generated via CLI.
- **Required Commands**: `prisma:migrate`, `prisma:generate`, `prisma:verify-empty-db`.
- **Full Spec**: [docs/standards/backend-prisma-migration-spec.md](docs/standards/backend-prisma-migration-spec.md)

### 2. Frontend React & shadcn-ui
- **Scope**: `apps/frontend/src/app` and `components/`
- **Key Mandatory**: Use shadcn-ui + Tailwind v4. Functional React components ONLY. No inline `style` objects.
- **Full Spec**: [docs/standards/frontend-react-shadcn-spec.md](docs/standards/frontend-react-shadcn-spec.md)

### 3. LLM Stream & Tool Calling
- **Scope**: Backend LLM gateway (`ai` + `@ai-sdk/openai-compatible`).
- **Key Mandatory**: SSE streaming endpoint support. Server-side tool registry with allowlisted tools (`runReadOnlySql`).
- **Full Spec**: [docs/standards/llm-stream-tool-migration-spec.md](docs/standards/llm-stream-tool-migration-spec.md)

### 4. R1 Gate & Rollout
- **Scope**: Acceptance criteria for R1 release.
- **Key Mandatory**: `R1_GATE_MIN_SUCCESS_RATE=0.95`, `R1_GATE_MAX_HARD_FAILURE_RATE=0.05`.
- **Full Spec**: [docs/standards/r1-gate-and-rollout-spec.md](docs/standards/r1-gate-and-rollout-spec.md)

## Maintenance Rules

- **Synchronization**: `AGENTS.md` must be updated when `package.json` scripts or `docs/standards/*.md` files change.
- **Ownership**: The engineering lead and any AI agent协作者 are responsible for keeping this entry point accurate.
