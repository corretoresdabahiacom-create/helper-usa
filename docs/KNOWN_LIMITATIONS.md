# Known limitations
1. Not deployed; GitHub push and Cloudflare deploy were not performed (no authorization/credentials). CI/deploy workflows are written but never run.
2. Tests use a SQLite shim, not real D1; no browser/E2E or accessibility tests; UI never visually QA'd on real devices.
3. No automatic payments, payroll, tax filing; no real WhatsApp API (only wa.me links); no GPS/time-clock.
4. Attachments (R2) and translation (Workers AI) are disabled without bindings and return 501/503 — no fake behavior.
5. Email needs Resend config; otherwise only dev tokens in non-production.
6. Single currency per report; multi-currency conversion not supported.
7. Legal pages are drafts. No 2FA, no CAPTCHA, no SSO.
8. D1 free-tier limits apply (see COSTS_AND_COMPETITORS.md).
