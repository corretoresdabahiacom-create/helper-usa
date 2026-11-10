# Financial methodology (management reporting; CPA review recommended)
- Amounts: integer cents, one currency per record; totals per currency; DRE/cash flow use the profile currency and list `excluded_currencies`.
- Statuses derived in SQL: open / partial / paid|received / overdue (due date < today in contractor timezone, balance > 0) / canceled / written_off.
- Installments: total split with remainder on first installment (10000/3 → 3334, 3333, 3333).
- DRE accrual: revenue by issue date (net of cancellations), expenses by expense date, helper labor by completed workday date, write-offs as bad debt. DRE cash: receipts and payments by actual payment date. Never mixed.
- Cash flow: only real receipts and payments (customer receipts, expense payments, helper payments) plus investing/financing movements, from the opening balance; unpaid receivables/payables never appear.
- Helper payments: only completed workdays payable; FIFO allocation oldest first; partial allowed; overpay blocked; void with reason.
- Reconciliation checks are asserted in `test/finance.test.ts`.
