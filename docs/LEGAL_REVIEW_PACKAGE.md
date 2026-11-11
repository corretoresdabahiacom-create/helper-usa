# Package for legal counsel (attorney review not yet done)
## What the product does
A private SaaS for US contractors: directory of helpers (name, phone/WhatsApp, city, skills, private notes/ratings), scheduling with per-day rates, records of payments made outside the app, receivables/expenses, management reports, and private in-app messaging that expires after 24 hours. Helpers have no accounts and receive a revocable link. The app never moves money, never sends WhatsApp messages itself (only builds wa.me links), and states it is not payroll/staffing/employer of record.
## Texts to review (drafts, not legal advice)
`web/src/legal.ts` (EN/PT/ES): Terms, Privacy, Messaging & Retention, Financial Data, Acceptable Use; shown at `/legal/:doc`. Registration records acceptance of terms and privacy (`consent_records`).
## Questions for counsel
1. Worker classification: is the wording enough that the product does not decide employee vs independent contractor? Any state (e.g. CA ABC test) that changes the disclaimers or features (per-day rates, scheduling)?
2. Storing helpers' personal data entered by the contractor (controller/processor roles); notice duties to helpers; CCPA/CPRA and other state privacy laws; retention and deletion; data of minors; helpers outside the US.
3. Messaging: consent standard for texts (TCPA) and email (CAN-SPAM) if wa.me/in-app flows trigger notifications; WhatsApp Business policy; opt-out wording; the 24h deletion promise vs backups/D1 Time Travel and logs.
4. Private "ratings/notes" about individuals: defamation/employment-reference risk and disclosure rights.
5. Financial: disclaimers for management reports; 1099/payroll expectations; whether the "payment record" feature could be read as payroll processing.
6. Terms: liability limits, governing law, arbitration, minimum age, refunds when paid plans exist; subprocessors (Cloudflare, optional Resend).
7. Breach notification obligations and incident process.
8. Any licensing/advertising restrictions around trades (the app shows a "verify licenses" notice and does not verify them).
## Data inventory
Tables and fields: `migrations/*.sql`; export of all of a user's data: `GET /api/account/export`; deletion: `DELETE /api/account`.
