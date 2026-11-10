import { beforeEach, describe, expect, it } from 'vitest';
import { makeEnv, signup, type Client } from './helpers/app';
import { complete, makeAssignment, makeHelper, NOW, workdaysOf } from './helpers/fixtures';

let env: ReturnType<typeof makeEnv>;
beforeEach(() => { env = makeEnv({ CLOCK_OVERRIDE: NOW }); });

async function cats(c: Client) {
  const l = (await c.call('GET', '/api/finance/categories')).json.categories as any[];
  const by = (cls: string) => l.find((x) => x.dre_class === cls).id as string;
  return { revenue: by('revenue_services'), direct: by('direct_cost'), operating: by('operating'), deduction: by('deduction') };
}
const recv = (c: Client, category_id: string, over: Record<string, unknown> = {}) =>
  c.call('POST', '/api/finance/receivables', { customer: 'ACME', description: 'Job', category_id, amount: '1000.00', issue_date: '2026-11-01', due_date: '2026-11-20', ...over });
const exp = (c: Client, category_id: string, over: Record<string, unknown> = {}) =>
  c.call('POST', '/api/finance/expenses', { description: 'Materials', category_id, amount: '400.00', expense_date: '2026-11-03', due_date: '2026-11-25', ...over });
const P = 'period=custom&from=2026-11-01&to=2026-11-30';

describe('receivables', () => {
  it('splits installments without losing a cent; partial receipts; no overpay; derived overdue', async () => {
    const { c } = await signup(env); const k = await cats(c);
    const r = await recv(c, k.revenue, { amount: '100.00', installments: { count: 3, every: 'month', first_due: '2026-11-05' } });
    expect(r.json.ids).toHaveLength(3);
    const list = (await c.call('GET', '/api/finance/receivables')).json.receivables as any[];
    expect(list.map((x) => x.original_cents).sort()).toEqual([3333, 3333, 3334]);
    expect(list.reduce((s, x) => s + x.original_cents, 0)).toBe(10000);
    const first = list.find((x) => x.installment_no === 1);
    expect(first.display_status).toBe('overdue'); // due 2026-11-05 < today 2026-11-10
    const pay = (id: string, amount: string, extra = {}) => c.call('POST', `/api/finance/receivables/${id}/receipts`, { amount, date: '2026-11-10', method: 'zelle', ...extra });
    expect((await pay(first.id, '10.00')).status).toBe(201);
    expect((await c.call('GET', `/api/finance/receivables/${first.id}`)).json.outstanding_cents).toBe(2334);
    const over = await pay(first.id, '23.35', { method: 'cash' }); expect(over.status).toBe(409);
    expect((await pay(first.id, '23.34', { method: 'cash' })).status).toBe(201);
    const after = (await c.call('GET', `/api/finance/receivables/${first.id}`)).json;
    expect(after.outstanding_cents).toBe(0);
    expect((await c.call('GET', '/api/finance/receivables?status=received')).json.receivables).toHaveLength(1);
  });
  it('receipts are idempotent, duplicates are blocked and voiding restores the balance', async () => {
    const { c } = await signup(env); const k = await cats(c); const id = (await recv(c, k.revenue)).json.ids[0];
    const body = { amount: '250.00', date: '2026-11-10', method: 'check', idempotency_key: 'rcpt-key-0001' };
    const a = await c.call('POST', `/api/finance/receivables/${id}/receipts`, body); const b = await c.call('POST', `/api/finance/receivables/${id}/receipts`, body);
    expect(a.status).toBe(201); expect(b.status).toBe(200); expect(b.json.duplicate).toBe(true);
    expect((await c.call('GET', `/api/finance/receivables/${id}`)).json.received_cents).toBe(25000);
    expect((await c.call('POST', `/api/finance/receivables/${id}/receipts`, { amount: '10.00', date: '2026-11-10', method: 'cash' })).status).toBe(201);
    expect((await c.call('POST', `/api/finance/receivables/${id}/receipts`, { amount: '10.00', date: '2026-11-10', method: 'cash' })).status).toBe(409);
    expect((await c.call('POST', `/api/finance/receipts/${a.json.id}/void`, { reason: 'Check bounced' })).status).toBe(200);
    expect((await c.call('GET', `/api/finance/receivables/${id}`)).json.received_cents).toBe(1000);
  });
  it('rejects float-ish / malformed money and negative amounts', async () => {
    const { c } = await signup(env); const k = await cats(c);
    for (const amount of ['10.999', '1e3', '-5.00', '0.00', 'abc', '1,000.00']) expect((await recv(c, k.revenue, { amount })).status, amount).toBe(400);
  });
  it('a receivable with receipts cannot be deleted or canceled', async () => {
    const { c } = await signup(env); const k = await cats(c); const id = (await recv(c, k.revenue)).json.ids[0];
    await c.call('POST', `/api/finance/receivables/${id}/receipts`, { amount: '5.00', date: '2026-11-10', method: 'cash' });
    expect((await c.call('DELETE', `/api/finance/receivables/${id}`)).status).toBe(409);
    expect((await c.call('POST', `/api/finance/receivables/${id}/cancel`, {})).status).toBe(409);
  });
});

describe('expenses & payables', () => {
  it('recurring and installment expenses generate correct records; payments cannot exceed the balance', async () => {
    const { c } = await signup(env); const k = await cats(c);
    const r = await exp(c, k.operating, { amount: '100.00', recurrence: 'monthly', occurrences: 3 });
    expect(r.json.ids).toHaveLength(3);
    const e = (await c.call('GET', '/api/finance/expenses')).json.expenses as any[];
    expect(e.map((x) => x.expense_date).sort()).toEqual(['2026-11-03', '2026-12-03', '2027-01-03']);
    const id = r.json.ids[0];
    expect((await c.call('POST', `/api/finance/expenses/${id}/payments`, { amount: '100.01', date: '2026-11-10', method: 'card' })).status).toBe(409);
    expect((await c.call('POST', `/api/finance/expenses/${id}/payments`, { amount: '100.00', date: '2026-11-10', method: 'card' })).status).toBe(201);
    const s = (await c.call('GET', '/api/finance/payables/summary')).json;
    expect(s.total_payable_cents).toBe(20000);
  });
  it('payables summary keeps helper payables separate from bills (no double counting)', async () => {
    const { c } = await signup(env); const k = await cats(c); const h = await makeHelper(c);
    await exp(c, k.operating, { amount: '300.00' });
    await makeAssignment(c, h, ['2026-11-02'], '100.00'); await complete(c, (await workdaysOf(c, h))[0].id);
    const s = (await c.call('GET', '/api/finance/payables/summary')).json;
    expect(s.total_payable_cents).toBe(30000); expect(s.helper_payable_total_cents).toBe(10000);
  });
});

describe('DRE, cash flow and reconciliation', () => {
  async function scenario() {
    const { c } = await signup(env); const k = await cats(c); const h = await makeHelper(c);
    await c.call('PUT', '/api/finance/settings', { accounting_basis: 'accrual', opening_cash: '500.00', opening_cash_date: '2026-11-01' });
    const r1 = (await recv(c, k.revenue, { amount: '1000.00' })).json.ids[0];          // received 600 in Nov
    await recv(c, k.revenue, { customer: 'Beta', amount: '500.00', due_date: '2026-12-15' }); // unpaid
    await c.call('POST', `/api/finance/receivables/${r1}/receipts`, { amount: '600.00', date: '2026-11-05', method: 'zelle' });
    const e1 = (await exp(c, k.direct, { amount: '200.00' })).json.ids[0];               // paid 120
    await exp(c, k.operating, { amount: '300.00', description: 'Insurance' });            // unpaid
    await c.call('POST', `/api/finance/expenses/${e1}/payments`, { amount: '120.00', date: '2026-11-06', method: 'card' });
    await makeAssignment(c, h, ['2026-11-02', '2026-11-03'], '100.00');                  // labor 200 completed
    for (const w of await workdaysOf(c, h)) await complete(c, w.id);
    await c.call('POST', '/api/work/helper-payments', { helper_id: h, amount: '100.00', paid_date: '2026-11-08', method: 'cash' });
    return { c, k, h };
  }
  it('accrual DRE uses recognition dates and counts unpaid items; cash DRE counts only money moved', async () => {
    const { c } = await scenario();
    const acc = (await c.call('GET', `/api/finance/dre?${P}&basis=accrual`)).json;
    expect(acc.gross_revenue.total_cents).toBe(150000);
    expect(acc.direct_costs.labor_cents).toBe(20000);
    expect(acc.direct_costs.total_cents).toBe(40000);          // 200 labor + 200 direct expense
    expect(acc.gross_profit_cents).toBe(110000);
    expect(acc.operating_expenses.total_cents).toBe(30000);
    expect(acc.net_result_cents).toBe(80000);
    const cash = (await c.call('GET', `/api/finance/dre?${P}&basis=cash`)).json;
    expect(cash.gross_revenue.total_cents).toBe(60000);         // only the 600 actually received
    expect(cash.direct_costs.labor_cents).toBe(10000);          // only the 100 actually paid to the helper
    expect(cash.direct_costs.total_cents).toBe(22000);          // 100 helper + 120 expense payment
    expect(cash.operating_expenses.total_cents).toBe(0);        // insurance still unpaid
    expect(cash.net_result_cents).toBe(60000 - 22000);
    expect(acc.net_result_cents).not.toBe(cash.net_result_cents);
  });
  it('cash flow shows only real movements and reconciles opening + net = closing', async () => {
    const { c } = await scenario();
    await c.call('POST', '/api/finance/cash-movements', { kind: 'financing', direction: 'in', amount: '1000.00', move_date: '2026-11-04', description: 'Owner contribution' });
    await c.call('POST', '/api/finance/cash-movements', { kind: 'investing', direction: 'out', amount: '250.00', move_date: '2026-11-07', description: 'Truck tools' });
    const cf = (await c.call('GET', `/api/finance/cashflow?${P}`)).json;
    expect(cf.opening_cents).toBe(50000);
    expect(cf.operating.receipts_cents).toBe(60000);
    expect(cf.operating.payments_cents).toBe(22000);
    expect(cf.financing.net_cents).toBe(100000); expect(cf.investing.net_cents).toBe(-25000);
    expect(cf.closing_cents).toBe(50000 + 60000 - 22000 + 100000 - 25000);
    expect(cf.closing_cents).toBe(cf.opening_cents + cf.net_movement_cents);
    // next period opens where this one closed
    const dec = (await c.call('GET', '/api/finance/cashflow?period=custom&from=2026-12-01&to=2026-12-31')).json;
    expect(dec.opening_cents).toBe(cf.closing_cents);
  });
  it('dashboard totals reconcile with DRE and cash flow and never mix bases', async () => {
    const { c } = await scenario();
    const d = (await c.call('GET', `/api/finance/dashboard?${P}&basis=accrual`)).json;
    expect(d.cards.total_revenue_cents).toBe(d.dre_accrual.gross_revenue.total_cents);
    expect(d.dre_accrual.net_result_cents).toBe(80000); expect(d.dre_cash.net_result_cents).toBe(38000);
    expect(d.cards.receipts_collected_cents).toBe(d.cash_flow.operating.receipts_cents);
    expect(d.receivables.total_outstanding_cents).toBe(40000 + 50000);
    expect(d.payables.total_outstanding_cents).toBe(8000 + 30000);
    expect(d.payables.helper_outstanding_cents).toBe(10000);
    expect(d.cards.cash_balance_cents).toBe(d.cash_flow.closing_cents);
    expect(d.monthly).toHaveLength(6);
  });
  it('period comparison returns the previous period with the same basis', async () => {
    const { c } = await scenario();
    const r = (await c.call('GET', `/api/finance/dre?${P}&basis=accrual&compare=previous`)).json;
    expect(r.compare.period.to).toBe('2026-10-31'); expect(r.compare.gross_revenue.total_cents).toBe(0);
  });
  it('never mixes currencies: other-currency records are excluded and reported', async () => {
    const { c } = await signup(env); const k = await cats(c);
    await recv(c, k.revenue, { amount: '100.00' });
    await recv(c, k.revenue, { amount: '999.00', currency: 'EUR' });
    const dre = (await c.call('GET', `/api/finance/dre?${P}&basis=accrual`)).json;
    expect(dre.gross_revenue.total_cents).toBe(10000); expect(dre.excluded_currencies.EUR).toBe(1);
  });
  it('write-off converts the unpaid balance into bad debt without touching cash', async () => {
    const { c } = await signup(env); const k = await cats(c); const id = (await recv(c, k.revenue, { amount: '200.00' })).json.ids[0];
    await c.call('POST', `/api/finance/receivables/${id}/receipts`, { amount: '50.00', date: '2026-11-05', method: 'cash' });
    expect((await c.call('POST', `/api/finance/receivables/${id}/write-off`, { reason: 'Customer vanished' })).json.written_off_cents).toBe(15000);
    const dre = (await c.call('GET', `/api/finance/dre?${P}&basis=accrual`)).json;
    expect(dre.gross_revenue.total_cents).toBe(20000); expect(dre.operating_expenses.bad_debt_cents).toBe(15000); expect(dre.net_result_cents).toBe(5000);
    expect((await c.call('GET', `/api/finance/cashflow?${P}`)).json.operating.receipts_cents).toBe(5000);
    expect((await c.call('GET', '/api/finance/receivables/summary')).json.total_outstanding_cents).toBe(0);
  });
});

describe('exports', () => {
  it('CSV neutralizes formula injection and PDF is a valid file', async () => {
    const { c } = await signup(env); const k = await cats(c);
    await recv(c, k.revenue, { customer: '=HYPERLINK("http://evil")', description: '+cmd' });
    const csv = await c.call('GET', '/api/reports/receivables?format=csv', undefined, { raw: true });
    const t = await csv.res.text(); expect(t).toContain("'=HYPERLINK"); expect(t).toContain("'+cmd");
    const pdf = await c.call('GET', `/api/reports/dre?${P}&format=pdf`, undefined, { raw: true });
    const buf = Buffer.from(await pdf.res.arrayBuffer());
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-'); expect(buf.toString('latin1')).toContain('%%EOF');
    expect(pdf.res.headers.get('content-type')).toBe('application/pdf');
  });
});
