#!/usr/bin/env bash
# Builds, migrates a LOCAL D1, starts wrangler dev, runs the browser E2E scripts, then stops the server.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .dev.vars ] || cp .dev.vars.example .dev.vars
rm -rf .wrangler/state  # fresh local D1 (also resets rate-limit counters)
npm run build >/dev/null
npx wrangler d1 migrations apply DB --local >/dev/null
npx wrangler dev --local --port 8787 >/tmp/hc-e2e.log 2>&1 &
PID=$!; trap 'kill $PID 2>/dev/null || true; pkill -f workerd 2>/dev/null || true' EXIT
for i in $(seq 1 60); do curl -fs localhost:8787/api/health >/dev/null && break; sleep 1; done
curl -fs localhost:8787/api/health >/dev/null
node e2e/pages-smoke.cjs
node e2e/create-helper.cjs
node e2e/finance-flow.cjs
