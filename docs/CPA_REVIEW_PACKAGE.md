# Package for a CPA (accountant review not yet done)
Methodology: `docs/FINANCE_METHODOLOGY.md`. The reports are management information, not GAAP financial statements or tax filings.
## Reconciliation scenario (automated, `e2e/finance-flow.cjs`, `e2e/expenses-messaging.cjs`)
Invoice $1,000 (overdue) with $400 received; helper labor 2 completed days × $150 = $300 fully paid ($100 then $200; a $250 overpayment is rejected); expense $500 paid $200 + $300. Results: DRE accrual revenue $1,000; DRE cash revenue $400; labor $300; cash flow receipts $400, helper payments $300, expense payments $500; unpaid $600 receivable never appears in cash.
## Questions for the CPA
1. Is the DRE layout (gross revenue, deductions, direct costs incl. helper labor on completed days, operating expenses incl. bad debt write-offs, financial result, other) acceptable for a small contractor's management view? Where should bad debt sit?
2. Cash basis vs accrual: any rule of thumb the user should follow for taxes (cash-basis taxpayers) given the app shows both?
3. Helper labor recorded when a workday is *completed* (accrual) and when paid (cash): confirm. Contractor vs employee reporting (1099-NEC thresholds, W-9 collection) is out of scope of the app: what wording should the app show?
4. Sales tax, estimated taxes, depreciation, inventory, retainage and progress billing are not modeled: which matter most for the target users?
5. Rounding: installments split in cents with the remainder on the first installment; confirm acceptable.
6. Voided payments and written-off receivables: audit trail sufficiency (audit log, no deletions).
7. Currency: one currency per report, no conversion; acceptable?
8. Exports (CSV/PDF): fields and labels needed by accountants.
