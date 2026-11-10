import { roundDiv } from '../../shared/money';
import { addDays, lastMonths } from '../../shared/dates';
import { WD_AMOUNT } from './labor';

export type Basis = 'accrual' | 'cash';
export interface Line { category_id?: string; name: string; amount_cents: number }

/** Derived status (never stored, so it can never go stale). Binds: today. */
export const recvStatusSql = (a = 'r') => `CASE WHEN ${a}.status <> 'open' THEN ${a}.status
  WHEN ${a}.original_cents - ${a}.received_cents <= 0 THEN 'received'
  WHEN ${a}.due_date IS NOT NULL AND ${a}.due_date < ? THEN 'overdue'
  WHEN ${a}.received_cents > 0 THEN 'partial' ELSE 'open' END`;
export const expStatusSql = (a = 'e') => `CASE WHEN ${a}.status <> 'open' THEN ${a}.status
  WHEN ${a}.amount_cents - ${a}.paid_cents <= 0 THEN 'paid'
  WHEN ${a}.due_date IS NOT NULL AND ${a}.due_date < ? THEN 'overdue'
  WHEN ${a}.paid_cents > 0 THEN 'partial' ELSE 'open' END`;

const sum = (xs: Line[]) => xs.reduce((a, l) => a + l.amount_cents, 0);

async function otherCurrencyCounts(db: D1Database, owner: string, currency: string, from: string, to: string) {
  const rows = await db.prepare(
    `SELECT currency, COUNT(*) AS n FROM (
       SELECT currency FROM receivables WHERE owner_id = ? AND recognition_date BETWEEN ? AND ? AND status IN ('open','written_off')
       UNION ALL SELECT currency FROM expenses WHERE owner_id = ? AND expense_date BETWEEN ? AND ? AND status IN ('open','written_off')
       UNION ALL SELECT currency FROM workdays WHERE owner_id = ? AND work_date BETWEEN ? AND ? AND status = 'completed'
     ) WHERE currency <> ? GROUP BY currency`,
  ).bind(owner, from, to, owner, from, to, owner, from, to, currency).all<{ currency: string; n: number }>();
  return Object.fromEntries(rows.results.map((r) => [r.currency, r.n]));
}

/**
 * DRE (income statement) for ONE explicit basis.
 *  accrual: revenue/expenses by recognition date; labor = completed workdays by work date; cash timing ignored.
 *  cash:    revenue = receipts by received date; expenses = payments by paid date; labor = helper payments by paid date.
 */
export async function buildDre(db: D1Database, owner: string, currency: string, basis: Basis, from: string, to: string) {
  let rev: any[]; let exp: any[]; let laborCents: number; let badDebt = 0;
  if (basis === 'accrual') {
    rev = (await db.prepare(
      `SELECT fc.id AS category_id, fc.name, fc.dre_class AS cls, SUM(r.original_cents) AS amt FROM receivables r
         JOIN financial_categories fc ON fc.id = r.category_id AND fc.owner_id = r.owner_id
        WHERE r.owner_id = ? AND r.currency = ? AND r.status IN ('open','written_off') AND r.recognition_date BETWEEN ? AND ? GROUP BY fc.id`,
    ).bind(owner, currency, from, to).all()).results;
    exp = (await db.prepare(
      `SELECT fc.id AS category_id, fc.name, fc.dre_class AS cls, SUM(e.amount_cents) AS amt FROM expenses e
         JOIN financial_categories fc ON fc.id = e.category_id AND fc.owner_id = e.owner_id
        WHERE e.owner_id = ? AND e.currency = ? AND e.status IN ('open','written_off') AND e.expense_date BETWEEN ? AND ? GROUP BY fc.id`,
    ).bind(owner, currency, from, to).all()).results;
    laborCents = (await db.prepare(
      `SELECT COALESCE(SUM(${WD_AMOUNT}),0) AS t FROM workdays w WHERE w.owner_id = ? AND w.currency = ? AND w.status = 'completed' AND w.work_date BETWEEN ? AND ?`,
    ).bind(owner, currency, from, to).first<{ t: number }>())!.t;
    badDebt = (await db.prepare(
      `SELECT COALESCE(SUM(amount_cents),0) AS t FROM accounting_adjustments WHERE owner_id = ? AND currency = ? AND kind = 'receivable_writeoff' AND adjust_date BETWEEN ? AND ?`,
    ).bind(owner, currency, from, to).first<{ t: number }>())!.t;
  } else {
    rev = (await db.prepare(
      `SELECT fc.id AS category_id, fc.name, fc.dre_class AS cls, SUM(rc.amount_cents) AS amt FROM receipts rc
         JOIN receivables r ON r.id = rc.receivable_id AND r.owner_id = rc.owner_id
         JOIN financial_categories fc ON fc.id = r.category_id AND fc.owner_id = r.owner_id
        WHERE rc.owner_id = ? AND rc.currency = ? AND rc.voided_at IS NULL AND rc.received_date BETWEEN ? AND ? GROUP BY fc.id`,
    ).bind(owner, currency, from, to).all()).results;
    exp = (await db.prepare(
      `SELECT fc.id AS category_id, fc.name, fc.dre_class AS cls, SUM(ep.amount_cents) AS amt FROM expense_payments ep
         JOIN expenses e ON e.id = ep.expense_id AND e.owner_id = ep.owner_id
         JOIN financial_categories fc ON fc.id = e.category_id AND fc.owner_id = e.owner_id
        WHERE ep.owner_id = ? AND ep.currency = ? AND ep.voided_at IS NULL AND ep.paid_date BETWEEN ? AND ? GROUP BY fc.id`,
    ).bind(owner, currency, from, to).all()).results;
    laborCents = (await db.prepare(
      `SELECT COALESCE(SUM(amount_cents),0) AS t FROM helper_payments WHERE owner_id = ? AND currency = ? AND voided_at IS NULL AND paid_date BETWEEN ? AND ?`,
    ).bind(owner, currency, from, to).first<{ t: number }>())!.t;
  }
  const pick = (rows: any[], classes: string[]): Line[] =>
    rows.filter((r) => classes.includes(r.cls)).map((r) => ({ category_id: r.category_id, name: r.name, amount_cents: r.amt }));

  const grossLines = pick(rev, ['revenue_services', 'revenue_other']);
  const deductionLines = pick(exp, ['deduction']);
  const directLines = pick(exp, ['direct_cost']);
  const opLines = pick(exp, ['operating']);
  const finIncome = pick(rev, ['financial_income']);
  const finExpense = pick(exp, ['financial_expense']);
  const otherLines = pick(exp, ['other_expense']);

  const gross = sum(grossLines);
  const deductions = sum(deductionLines);
  const netRevenue = gross - deductions;
  const directCosts = laborCents + sum(directLines);
  const grossProfit = netRevenue - directCosts;
  const operating = sum(opLines) + badDebt;
  const operatingResult = grossProfit - operating;
  const financialResult = sum(finIncome) - sum(finExpense);
  const other = sum(otherLines);
  const net = operatingResult + financialResult - other;
  return {
    basis, currency, period: { from, to },
    gross_revenue: { total_cents: gross, lines: grossLines },
    deductions: { total_cents: deductions, lines: deductionLines },
    net_revenue_cents: netRevenue,
    direct_costs: { total_cents: directCosts, labor_cents: laborCents, lines: directLines },
    gross_profit_cents: grossProfit,
    operating_expenses: { total_cents: operating, bad_debt_cents: badDebt, lines: opLines },
    operating_result_cents: operatingResult,
    financial: { income_cents: sum(finIncome), expense_cents: sum(finExpense), result_cents: financialResult, income_lines: finIncome, expense_lines: finExpense },
    other_items: { total_cents: other, lines: otherLines },
    net_result_cents: net,
    profit_margin_bps: netRevenue > 0 ? roundDiv(net * 10000, netRevenue) : null, // net result / net revenue, basis points
    total_expenses_cents: deductions + directCosts + operating + sum(finExpense) + other,
    excluded_currencies: await otherCurrencyCounts(db, owner, currency, from, to),
    disclaimer: 'Management report. Not a GAAP/tax statement; have a CPA review before using it officially.',
  };
}

interface CashProfile { currency: string; opening_cash_cents: number; opening_cash_date: string | null }

async function cashNet(db: D1Database, owner: string, currency: string, from: string, to: string) {
  const one = async (sql: string, ...a: unknown[]) => ((await db.prepare(sql).bind(owner, currency, from, to, ...a).first<{ t: number }>())?.t ?? 0);
  const receipts = await one('SELECT COALESCE(SUM(amount_cents),0) AS t FROM receipts WHERE owner_id = ? AND currency = ? AND voided_at IS NULL AND received_date BETWEEN ? AND ?');
  const expPay = await one('SELECT COALESCE(SUM(amount_cents),0) AS t FROM expense_payments WHERE owner_id = ? AND currency = ? AND voided_at IS NULL AND paid_date BETWEEN ? AND ?');
  const helperPay = await one('SELECT COALESCE(SUM(amount_cents),0) AS t FROM helper_payments WHERE owner_id = ? AND currency = ? AND voided_at IS NULL AND paid_date BETWEEN ? AND ?');
  const mv = (await db.prepare(
    `SELECT kind, direction, COALESCE(SUM(amount_cents),0) AS t FROM cash_movements WHERE owner_id = ? AND currency = ? AND voided_at IS NULL AND move_date BETWEEN ? AND ? GROUP BY kind, direction`,
  ).bind(owner, currency, from, to).all<{ kind: string; direction: string; t: number }>()).results;
  const m = (k: string, d: string) => mv.find((x) => x.kind === k && x.direction === d)?.t ?? 0;
  const investing = { in_cents: m('investing', 'in'), out_cents: m('investing', 'out') };
  const financing = { in_cents: m('financing', 'in'), out_cents: m('financing', 'out') };
  const operatingNet = receipts - expPay - helperPay;
  const net = operatingNet + investing.in_cents - investing.out_cents + financing.in_cents - financing.out_cents;
  return { receipts, expPay, helperPay, investing, financing, operatingNet, net };
}

/** Cash flow: ONLY actual money movements. Unpaid receivables/payables never appear here. */
export async function buildCashFlow(db: D1Database, owner: string, p: CashProfile, from: string, to: string) {
  const warnings: string[] = [];
  const openDate = p.opening_cash_date;
  if (!openDate) warnings.push('no_opening_balance');
  const base = openDate ? p.opening_cash_cents : 0;
  const start = openDate ?? '0001-01-01';
  let effFrom = from;
  if (openDate && from < openDate) { warnings.push('period_before_opening_balance'); effFrom = openDate; }
  let opening = base;
  if (effFrom > start) opening += (await cashNet(db, owner, p.currency, start, addDays(effFrom, -1))).net;
  const cur = effFrom > to ? { receipts: 0, expPay: 0, helperPay: 0, investing: { in_cents: 0, out_cents: 0 }, financing: { in_cents: 0, out_cents: 0 }, operatingNet: 0, net: 0 }
    : await cashNet(db, owner, p.currency, effFrom, to);
  return {
    currency: p.currency, period: { from, to }, warnings,
    opening_cents: opening,
    operating: { receipts_cents: cur.receipts, expense_payments_cents: cur.expPay, helper_payments_cents: cur.helperPay, payments_cents: cur.expPay + cur.helperPay, net_cents: cur.operatingNet },
    investing: { ...cur.investing, net_cents: cur.investing.in_cents - cur.investing.out_cents },
    financing: { ...cur.financing, net_cents: cur.financing.in_cents - cur.financing.out_cents },
    net_movement_cents: cur.net,
    closing_cents: opening + cur.net,
    disclaimer: 'Based on manually recorded transactions; the app has no access to bank balances.',
  };
}

/** Month-by-month series for dashboard charts (last N months ending at `to`). */
export async function monthlySeries(db: D1Database, owner: string, currency: string, to: string, n = 6) {
  const months = lastMonths(to, n);
  const first = `${months[0]}-01`; const last = `${months[n - 1]}-31`;
  const q = async (sql: string, ...a: unknown[]) => (await db.prepare(sql).bind(...a).all<{ m: string; t: number }>()).results;
  const rev = await q(`SELECT substr(r.recognition_date,1,7) AS m, SUM(r.original_cents) AS t FROM receivables r JOIN financial_categories fc ON fc.id = r.category_id AND fc.owner_id = r.owner_id
    WHERE r.owner_id = ? AND r.currency = ? AND r.status IN ('open','written_off') AND fc.dre_class IN ('revenue_services','revenue_other') AND r.recognition_date BETWEEN ? AND ? GROUP BY m`, owner, currency, first, last);
  const exp = await q(`SELECT substr(expense_date,1,7) AS m, SUM(amount_cents) AS t FROM expenses WHERE owner_id = ? AND currency = ? AND status IN ('open','written_off') AND expense_date BETWEEN ? AND ? GROUP BY m`, owner, currency, first, last);
  const lab = await q(`SELECT substr(w.work_date,1,7) AS m, SUM(${WD_AMOUNT}) AS t FROM workdays w WHERE w.owner_id = ? AND w.currency = ? AND w.status = 'completed' AND w.work_date BETWEEN ? AND ? GROUP BY m`, owner, currency, first, last);
  const cin = await q(`SELECT substr(received_date,1,7) AS m, SUM(amount_cents) AS t FROM receipts WHERE owner_id = ? AND currency = ? AND voided_at IS NULL AND received_date BETWEEN ? AND ? GROUP BY m`, owner, currency, first, last);
  const cex = await q(`SELECT substr(paid_date,1,7) AS m, SUM(amount_cents) AS t FROM expense_payments WHERE owner_id = ? AND currency = ? AND voided_at IS NULL AND paid_date BETWEEN ? AND ? GROUP BY m`, owner, currency, first, last);
  const chp = await q(`SELECT substr(paid_date,1,7) AS m, SUM(amount_cents) AS t FROM helper_payments WHERE owner_id = ? AND currency = ? AND voided_at IS NULL AND paid_date BETWEEN ? AND ? GROUP BY m`, owner, currency, first, last);
  const g = (rows: { m: string; t: number }[], m: string) => rows.find((r) => r.m === m)?.t ?? 0;
  return months.map((m) => ({
    month: m, revenue_cents: g(rev, m), expenses_cents: g(exp, m) + g(lab, m),
    cash_in_cents: g(cin, m), cash_out_cents: g(cex, m) + g(chp, m),
  }));
}
