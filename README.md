# Helper Connect (MVP)

Private helper directory, work scheduling, helper payments, receivables/payables, DRE, cash flow and 24-hour private messaging for US contractors. UI: EN (default) / PT / ES. Money is exact integer cents (USD default; currencies never mixed).

**Status honestly:** backend + frontend build, 74 automated API/unit tests and 4 browser E2E scripts pass locally (on a Node SQLite shim of D1, not on real Cloudflare). **Nothing has been deployed** and nothing has been pushed to GitHub from this session (no authorization/credentials were available). See `docs/KNOWN_LIMITATIONS.md`.

## Stack
Cloudflare Workers + Hono + D1 (free tier, no card). React + Vite SPA served by Workers Static Assets. Cron trigger every 15 min for message expiry. Optional: R2 attachments (needs card, disabled by default), Workers AI translation, Resend email.

## Run locally (Windows PowerShell)
Requires Node 22.13+.
```powershell
npm ci
copy .dev.vars.example .dev.vars
npm run db:migrate:local
npm run build
npm run dev:api          # http://localhost:8787 (API + built SPA)
# optional hot-reload UI in a second window:
npm run dev:web          # http://localhost:5173, proxies /api to 8787
```
Local email is not sent: with `DEV_EXPOSE_TOKENS=true` the register/reset responses include `dev_token`; the verify/reset page reads the token from the link (`?token=`); in dev copy `dev_token` into that URL.

Tests: `npm run typecheck; npm test; npm run build`. Browser E2E: `npm run e2e` (needs Playwright's Chromium).

## First admin
Register normally, then promote in D1:
```powershell
npx wrangler d1 execute DB --local --command "INSERT INTO administrator_roles (user_id, role, created_at) SELECT id, 'super_admin', datetime('now') FROM users WHERE email='you@example.com'"
```
(use `--remote` for production).

## Deploy to Cloudflare (needs YOUR authorization)
```powershell
npx wrangler login
npx wrangler d1 create helper-connect     # paste database_id into wrangler.toml
npm run db:migrate:prod
npm run deploy
# 2FA key (generate your own, keep a backup: losing it locks 2FA users out):
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" | npx wrangler secret put TOTP_ENC_KEY
```
Then set `APP_ORIGIN` in wrangler.toml (used for CSRF Origin checks and email links) and redeploy. For CI deploys add repo secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (`.github/workflows/deploy.yml`). Per your rule, every push to `main` then triggers a Cloudflare deploy.

## Environment
| Var | Purpose |
|---|---|
| ENVIRONMENT | `production` disables dev tokens and clock override |
| APP_ORIGIN | allowed Origin + link base |
| DEV_EXPOSE_TOKENS | `true` only in dev/staging |
| RESEND_API_KEY / EMAIL_FROM | optional real email |
| MAX_BULK_RECIPIENTS | bulk-send cap (default 50) |
| TOTP_ENC_KEY (secret) | 32-byte base64 key that encrypts 2FA secrets; without it 2FA is reported unavailable. `npx wrangler secret put TOTP_ENC_KEY` |
| TURNSTILE_SITE_KEY / TURNSTILE_SECRET (secret) | optional Cloudflare Turnstile on register/login/forgot-password; when the secret is set a valid token is mandatory |
| bindings: DB (required), AI, ATTACHMENTS (optional) | |

## Docs
`docs/SECURITY.md`, `docs/PENTEST_BRIEF.md`, `docs/LEGAL_REVIEW_PACKAGE.md`, `docs/CPA_REVIEW_PACKAGE.md`, `docs/TEST_REPORT.md`, `docs/FINANCE_METHODOLOGY.md`, `docs/COMPLIANCE_CHECKLIST.md`, `docs/KNOWN_LIMITATIONS.md`, `docs/COSTS_AND_COMPETITORS.md`. In-app draft legal pages live at `/legal/:doc` (templates, attorney review required).
