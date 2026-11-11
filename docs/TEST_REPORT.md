# Test report
Command: `npm run typecheck; npm test; npm run build` — typecheck clean, 59 tests passing, Vite build OK (this environment, Node 22).
Files: `smoke` (1), `api` (16: auth, IDOR, helpers, work, payments), `finance` (13: partials, installments, DRE/cash separation, overdue), `messaging` (8: 24h expiry, bulk separation, consent/opt-out, portal), `shared` (18: money parse/allocate, validation), `i18n` (3: EN/PT/ES key parity, placeholders, static key usage).
Caveat: tests run against a Node `node:sqlite` shim of D1, not real Workers/D1. Not covered: browser/E2E UI tests, accessibility audit, load testing, real Cloudflare deployment, email delivery.

## Browser smoke (manual script, not in CI)
Run on 2026-11-11 with Playwright/Chromium at 390px width against `wrangler dev --local` (real workerd + local D1): `e2e/pages-smoke.cjs` opened 10 pages (home, helpers, schedule, projects, money, reports, messages, settings, admin, legal) with no console errors and no horizontal overflow; `e2e/create-helper.cjs` created a helper through the form (WhatsApp normalized to E.164). Run: start `npm run dev:api` after `npm run build`, then `node e2e/pages-smoke.cjs` (needs `playwright`). Not covered: schedule/payment/money flows in the UI, tablet/desktop widths, screen-reader/accessibility audit, Safari/Firefox.
