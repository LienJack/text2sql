# Local Nginx Dev Gateway (`localhost:3000`)

This gateway provides one local entrypoint:

- `/` -> frontend dev server (expected at `localhost:3001`)
- `/api/*` -> backend API server (expected at `localhost:3002`)

## Quick usage

1. Start backend and frontend dev servers.
2. Start infra (including nginx gateway) with:

```bash
docker compose -f infra/docker-compose.yml up -d
```

3. Open [http://localhost:3000](http://localhost:3000).
4. Run smoke check:

```bash
node tests/smoke/nginx-dev-gateway-smoke.mjs
```

## Smoke script behavior

The smoke script validates three paths through the unified `3000` entry:

- `GET /` (frontend upstream)
- `GET /api/v1/datasources` with workspace/user headers (backend upstream)
- `POST /api/v1/sessions/:id/messages/stream` (SSE stream path)

It exits with non-zero status on any failure and prints the failed source explicitly (`frontend upstream`, `backend upstream`, or `stream`).

## Troubleshooting

- `frontend upstream` failure:
  - confirm frontend dev server is listening on `localhost:3001`
  - confirm nginx route for `/` points to the frontend upstream
- `backend upstream` failure:
  - confirm backend is listening on `localhost:3002`
  - confirm workspace/user headers are accepted by backend context rules
  - confirm `/api/*` route points to backend upstream
- `stream` failure:
  - confirm stream route `/api/v1/sessions/:id/messages/stream` is proxied to backend
  - confirm nginx stream location has buffering disabled and a sufficiently long read timeout
  - confirm response `Content-Type` is `text/event-stream`

## Optional environment overrides for smoke

- `NGINX_GATEWAY_BASE_URL` (default: `http://localhost:3000`)
- `SMOKE_USER_ID` (default: `user_system_admin`)
- `SMOKE_USER_ROLE` (default: `admin`)
- `SMOKE_WORKSPACE_ID` (optional explicit workspace id)
