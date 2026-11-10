# Test report
Command: `npm run typecheck; npm test; npm run build` — typecheck clean, 59 tests passing, Vite build OK (this environment, Node 22).
Files: `smoke` (1), `api` (16: auth, IDOR, helpers, work, payments), `finance` (13: partials, installments, DRE/cash separation, overdue), `messaging` (8: 24h expiry, bulk separation, consent/opt-out, portal), `shared` (18: money parse/allocate, validation), `i18n` (3: EN/PT/ES key parity, placeholders, static key usage).
Caveat: tests run against a Node `node:sqlite` shim of D1, not real Workers/D1. Not covered: browser/E2E UI tests, accessibility audit, load testing, real Cloudflare deployment, email delivery.
