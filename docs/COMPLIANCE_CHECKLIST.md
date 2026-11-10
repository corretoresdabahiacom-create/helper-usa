# Compliance checklist (for an attorney/CPA; no compliance is claimed)
- [ ] Attorney review of Terms, Privacy, Messaging & Retention, Financial Data, AUP drafts (`web/src/legal.ts`).
- [ ] Worker classification: product disclaims; confirm wording with counsel (IRS/DOL tests, state ABC tests, e.g. CA).
- [ ] Messaging: consent capture, opt-out honored (built); confirm TCPA/CAN-SPAM/WhatsApp policy applicability. Product only generates wa.me links and in-app messages.
- [ ] Privacy: state laws (CCPA/CPRA etc.), retention, export/delete (built), DPA/subprocessor list (Cloudflare, optional Resend).
- [ ] 24h message deletion vs. backup/log retention (D1 Time Travel keeps history ~30 days: disclose or evaluate).
- [ ] Financial: 1099 / sales tax / licensing questions are out of scope; CPA review of reports.
- [ ] Security: pen test, incident response plan, breach-notification process.
