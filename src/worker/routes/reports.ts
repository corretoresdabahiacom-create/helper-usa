import { Hono } from 'hono';
import { centsToDecimalString as d } from '../../shared/money';
import { audit, HttpError, nowIso, todayOf, uid, type Ctx, type Env, type Vars } from '../core';
import { requireAuth } from './auth';
import { periodFromQuery } from './finance';
import { buildCashFlow, buildDre, type Basis } from '../services/finance';
import { workReport } from '../services/labor';
import { textToPdf } from '../services/pdf';

export const reportRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();
reportRoutes.use('*', requireAuth);

/** CSV with formula-injection protection (cells starting with = + - @ get a leading apostrophe; negative numbers are exempt because they are money). */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+@\t\r]/.test(s) || (/^-/.test(s) && !/^-\d+(\.\d+)?$/.test(s))) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (header: string[], rows: unknown[][]) => '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

function respond(c: Ctx, name: string, format: string, csv: () => string, pdfTitle: string, pdfLines: () => string[]) {
  const h = { 'cache-control': 'no-store', 'content-disposition': `attachment; filename="${name}.${format}"` };
  if (format === 'csv') return new Response(csv(), { headers: { ...h, 'content-type': 'text/csv; charset=utf-8' } });
  if (format === 'pdf') return new Response(textToPdf(pdfTitle, pdfLines()).buffer as ArrayBuffer, { headers: { ...h, 'content-type': 'application/pdf' } });
  throw new HttpError(400, 'invalid_format');
}
const fmtOf = (c: Ctx) => c.req.query('format') ?? 'json';
const money = (cur: string, n: number) => `${cur} ${d(n)}`;

reportRoutes.get('/work', async (c) => {
  const p = periodFromQuery(c as any); const q = c.req.query();
  const rep = await workReport(c.env.DB, uid(c as any), {
    from: p.from, to: p.to, helperIds: q.helper_ids?.split(',').filter(Boolean), projectIds: q.project_ids?.split(',').filter(Boolean), city: q.city, state: q.state, currency: q.currency,
  });
  const f = fmtOf(c as any);
  if (f === 'json') return c.json({ period: p, ...rep, rows: rep.rows.map((r: any) => ({ ...r })) });
  await audit(c as any, 'data', 'report_exported', 'work_report', undefined, { format: f }).run();
  return respond(c as any, `work-report-${p.from}_${p.to}`, f,
    () => toCsv(['date', 'helper', 'project', 'job', 'city', 'state', 'status', 'currency', 'daily_rate', 'payable_amount', 'paid'],
      rep.rows.map((r: any) => [r.work_date, r.helper_name, r.project_name, r.job_name, r.city, r.state, r.status, r.currency, d(r.daily_rate_cents), d(r.amount_cents), d(r.paid_cents)])),
    `Work report ${p.from} to ${p.to}`,
    () => [...rep.by_helper.map((g: any) => `${g.helper_name}: ${g.days} day(s), total ${money(g.currency, g.total_cents)}, paid ${money(g.currency, g.paid_cents)}, remaining ${money(g.currency, g.remaining_cents)} (${g.payment_status})`),
      '', ...Object.entries(rep.totals).map(([cur, t]: any) => `TOTAL ${cur}: ${t.days} day(s), ${money(cur, t.total_cents)}, paid ${money(cur, t.paid_cents)}, remaining ${money(cur, t.remaining_cents)}`),
      'Only completed workdays are payable.']);
});

function dreLines(x: Awaited<ReturnType<typeof buildDre>>) {
  const cur = x.currency; const L: string[] = [`Basis: ${x.basis}   Period: ${x.period.from} to ${x.period.to}`, ''];
  const sect = (t: string, total: number, lines: { name: string; amount_cents: number }[]) => { L.push(`${t}: ${money(cur, total)}`); for (const l of lines) L.push(`    ${l.name}: ${money(cur, l.amount_cents)}`); };
  sect('Gross revenue', x.gross_revenue.total_cents, x.gross_revenue.lines); sect('(-) Deductions', x.deductions.total_cents, x.deductions.lines);
  L.push(`= Net revenue: ${money(cur, x.net_revenue_cents)}`);
  sect('(-) Direct costs', x.direct_costs.total_cents, [{ name: 'Labor (helpers)', amount_cents: x.direct_costs.labor_cents }, ...x.direct_costs.lines]);
  L.push(`= Gross profit: ${money(cur, x.gross_profit_cents)}`);
  sect('(-) Operating expenses', x.operating_expenses.total_cents, x.operating_expenses.bad_debt_cents ? [...x.operating_expenses.lines, { name: 'Bad debt', amount_cents: x.operating_expenses.bad_debt_cents }] : x.operating_expenses.lines);
  L.push(`= Operating result: ${money(cur, x.operating_result_cents)}`, `Financial result: ${money(cur, x.financial.result_cents)}`, `Other items: ${money(cur, x.other_items.total_cents)}`, `= NET RESULT: ${money(cur, x.net_result_cents)}`, '', x.disclaimer);
  return L;
}
reportRoutes.get('/dre', async (c) => {
  const p = periodFromQuery(c as any); const u = c.get('user').profile; const basis = (c.req.query('basis') ?? u.accounting_basis) as Basis;
  if (basis !== 'accrual' && basis !== 'cash') throw new HttpError(400, 'invalid_basis');
  const x = await buildDre(c.env.DB, uid(c as any), u.currency, basis, p.from, p.to); const f = fmtOf(c as any);
  if (f === 'json') return c.json(x);
  await audit(c as any, 'data', 'report_exported', 'dre', undefined, { format: f, basis }).run();
  return respond(c as any, `dre-${basis}-${p.from}_${p.to}`, f,
    () => toCsv(['section', 'line', 'amount', 'currency', 'basis'], [
      ...x.gross_revenue.lines.map((l) => ['gross_revenue', l.name, d(l.amount_cents), x.currency, basis]), ['gross_revenue', 'TOTAL', d(x.gross_revenue.total_cents), x.currency, basis],
      ['deductions', 'TOTAL', d(x.deductions.total_cents), x.currency, basis], ['net_revenue', 'TOTAL', d(x.net_revenue_cents), x.currency, basis],
      ['direct_costs', 'Labor (helpers)', d(x.direct_costs.labor_cents), x.currency, basis], ...x.direct_costs.lines.map((l) => ['direct_costs', l.name, d(l.amount_cents), x.currency, basis]),
      ['direct_costs', 'TOTAL', d(x.direct_costs.total_cents), x.currency, basis], ['gross_profit', 'TOTAL', d(x.gross_profit_cents), x.currency, basis],
      ...x.operating_expenses.lines.map((l) => ['operating_expenses', l.name, d(l.amount_cents), x.currency, basis]), ['operating_expenses', 'Bad debt', d(x.operating_expenses.bad_debt_cents), x.currency, basis],
      ['operating_expenses', 'TOTAL', d(x.operating_expenses.total_cents), x.currency, basis], ['financial_result', 'TOTAL', d(x.financial.result_cents), x.currency, basis],
      ['other_items', 'TOTAL', d(x.other_items.total_cents), x.currency, basis], ['net_result', 'TOTAL', d(x.net_result_cents), x.currency, basis]]),
    `DRE - Income statement (${basis})`, () => dreLines(x));
});

reportRoutes.get('/cashflow', async (c) => {
  const p = periodFromQuery(c as any); const u = c.get('user').profile;
  const x = await buildCashFlow(c.env.DB, uid(c as any), { currency: u.currency, opening_cash_cents: u.opening_cash_cents, opening_cash_date: u.opening_cash_date }, p.from, p.to); const f = fmtOf(c as any);
  if (f === 'json') return c.json(x);
  await audit(c as any, 'data', 'report_exported', 'cashflow', undefined, { format: f }).run();
  const rows: [string, number][] = [['Opening balance', x.opening_cents], ['Receipts from customers', x.operating.receipts_cents], ['Expense payments', -x.operating.expense_payments_cents], ['Helper payments', -x.operating.helper_payments_cents],
    ['Operating net', x.operating.net_cents], ['Investing net', x.investing.net_cents], ['Financing net', x.financing.net_cents], ['Closing balance', x.closing_cents]];
  return respond(c as any, `cashflow-${p.from}_${p.to}`, f, () => toCsv(['line', 'amount', 'currency'], rows.map(([k, v]) => [k, d(v), x.currency])),
    'Cash flow', () => [`Period: ${p.from} to ${p.to}`, ...x.warnings.map((w) => `Warning: ${w}`), '', ...rows.map(([k, v]) => `${k}: ${money(x.currency, v)}`), '', x.disclaimer]);
});

reportRoutes.get('/receivables', async (c) => {
  const rows = (await c.env.DB.prepare('SELECT customer, description, issue_date, due_date, currency, original_cents, received_cents, status FROM receivables WHERE owner_id = ? ORDER BY issue_date DESC LIMIT 5000').bind(uid(c as any)).all<any>()).results;
  return respond(c as any, 'receivables', c.req.query('format') ?? 'csv', () => toCsv(['customer', 'description', 'issued', 'due', 'currency', 'amount', 'received', 'outstanding', 'status'],
    rows.map((r) => [r.customer, r.description, r.issue_date, r.due_date, r.currency, d(r.original_cents), d(r.received_cents), d(r.original_cents - r.received_cents), r.status])), 'Receivables',
    () => rows.map((r) => `${r.issue_date} ${r.customer} - ${r.description}: ${money(r.currency, r.original_cents)} (received ${d(r.received_cents)})`));
});
reportRoutes.get('/expenses', async (c) => {
  const rows = (await c.env.DB.prepare('SELECT description, payee, expense_date, due_date, currency, amount_cents, paid_cents, status FROM expenses WHERE owner_id = ? ORDER BY expense_date DESC LIMIT 5000').bind(uid(c as any)).all<any>()).results;
  return respond(c as any, 'expenses', c.req.query('format') ?? 'csv', () => toCsv(['description', 'payee', 'date', 'due', 'currency', 'amount', 'paid', 'outstanding', 'status'],
    rows.map((r) => [r.description, r.payee, r.expense_date, r.due_date, r.currency, d(r.amount_cents), d(r.paid_cents), d(r.amount_cents - r.paid_cents), r.status])), 'Expenses',
    () => rows.map((r) => `${r.expense_date} ${r.description}: ${money(r.currency, r.amount_cents)} (paid ${d(r.paid_cents)})`));
});
reportRoutes.get('/helper-payments', async (c) => {
  const rows = (await c.env.DB.prepare('SELECT p.paid_date, h.full_name, p.currency, p.amount_cents, p.method, p.voided_at FROM helper_payments p JOIN helpers h ON h.id = p.helper_id AND h.owner_id = p.owner_id WHERE p.owner_id = ? ORDER BY p.paid_date DESC LIMIT 5000').bind(uid(c as any)).all<any>()).results;
  return respond(c as any, 'helper-payments', c.req.query('format') ?? 'csv', () => toCsv(['date', 'helper', 'currency', 'amount', 'method', 'voided'], rows.map((r) => [r.paid_date, r.full_name, r.currency, d(r.amount_cents), r.method, r.voided_at ? 'yes' : ''])),
    'Helper payments', () => rows.map((r) => `${r.paid_date} ${r.full_name}: ${money(r.currency, r.amount_cents)} ${r.voided_at ? '(VOIDED)' : ''}`));
});
export { nowIso, todayOf };
