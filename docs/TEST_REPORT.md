# Test report
Command: `npm run typecheck; npm test; npm run build` — typecheck clean, 59 tests passing, Vite build OK (this environment, Node 22).
Files: `smoke` (1), `api` (16: auth, IDOR, helpers, work, payments), `finance` (13: partials, installments, DRE/cash separation, overdue), `messaging` (8: 24h expiry, bulk separation, consent/opt-out, portal), `shared` (18: money parse/allocate, validation), `i18n` (3: EN/PT/ES key parity, placeholders, static key usage).
Caveat: tests run against a Node `node:sqlite` shim of D1, not real Workers/D1. Not covered: browser/E2E UI tests, accessibility audit, load testing, real Cloudflare deployment, email delivery.

## Browser E2E (`npm run e2e`, Playwright/Chromium, 390px)
Runs against `wrangler dev --local` (workerd + fresh local D1; `e2e/run.sh` resets state). Scripts: `pages-smoke` (10 pages, no console errors, no horizontal overflow), `create-helper` (form -> E.164 WhatsApp), `finance-flow`: schedule 2 days @ $150 via UI -> complete -> partial pay $100 -> $250 overpay rejected -> pay $200 (no more pay button) -> receivable $1,000 overdue -> partial receipt $400 (remainder still receivable) -> asserts DRE accrual revenue $1,000 vs cash $400, labor $300, cash flow receipts $400 / helper payments $300 / closing $100 (unpaid receivable not counted as cash).
Bug found and fixed by this phase: Receive/Pay buttons were hidden for partial/overdue receivables and expenses (only `open`).
Locally set `CHROMIUM_PATH` if the pre-installed browser differs from Playwright's pinned version. The CI `e2e` job (`.github/workflows/ci.yml`) is written but has NOT been run on GitHub yet.
Not covered: expenses/payables, messaging and portal UI flows, tablet/desktop widths, Firefox/Safari, accessibility audit.
