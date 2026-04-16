#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

log() {
  printf '\033[1;34m[start.dev]\033[0m %s\n' "$*"
}

error() {
  printf '\033[1;31m[start.dev]\033[0m %s\n' "$*" >&2
}

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    error "Required command not found: $cmd"
    exit 1
  fi
}

copy_if_missing() {
  local source="$1"
  local target="$2"
  if [ ! -f "$source" ]; then
    error "Missing template file: $source"
    exit 1
  fi

  if [ -f "$target" ]; then
    log "Keep existing file: $target"
  else
    cp "$source" "$target"
    log "Created file: $target"
  fi
}

require_command pnpm
require_command docker

if ! docker compose version >/dev/null 2>&1; then
  error "Docker Compose v2 is required (docker compose)."
  exit 1
fi

log "Installing dependencies..."
pnpm install

log "Starting infrastructure containers (Redis/PostgreSQL)..."
docker compose -f infra/docker-compose.yml up -d

log "Preparing environment files..."
copy_if_missing "apps/backend/.env.example" "apps/backend/.env"
copy_if_missing "apps/frontend/.env.example" "apps/frontend/.env"

if grep -q "^PORT=" "apps/backend/.env"; then
  current_backend_port=$(grep "^PORT=" "apps/backend/.env" | tail -n 1 | cut -d "=" -f2- | tr -d '[:space:]')
  if [ "$current_backend_port" = "3000" ]; then
    log "Updating backend PORT from 3000 to 3002 for unified gateway mode"
    perl -i -pe 's/^PORT=3000$/PORT=3002/' "apps/backend/.env"
  fi
else
  log "Appending default PORT=3002"
  printf '\nPORT=3002\n' >> "apps/backend/.env"
fi

if ! grep -q "^CORS_ALLOWED_ORIGINS=" "apps/backend/.env"; then
  log "Appending default CORS_ALLOWED_ORIGINS=http://localhost:3000"
  printf '\nCORS_ALLOWED_ORIGINS=http://localhost:3000\n' >> "apps/backend/.env"
fi

if grep -q "^LLM_MOCK_MODE=true" "apps/backend/.env"; then
  log "LLM_MOCK_MODE=true detected: backend will use mock response instead of real provider."
fi

if grep -q "^LLM_API_KEY=$" "apps/backend/.env"; then
  log "LLM_API_KEY is empty. Real LLM requests will fail until configured."
fi

log "Generating Prisma Client..."
pnpm --filter @text2sql/backend prisma:generate

log "Starting development servers..."
exec pnpm dev
