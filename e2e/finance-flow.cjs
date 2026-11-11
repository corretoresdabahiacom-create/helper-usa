// Browser E2E: schedule -> complete -> pay helper (partial/overpay/full) -> receivable -> partial receipt -> DRE/cash reconciliation.
// Usage: npm run build && npm run dev:api (other terminal) && node e2e/finance-flow.cjs   (needs `playwright`)
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const B = process.env.BASE_URL || 'http://localhost:8787';
const H = { 'x-hc-csrf': '1', 'content-type': 'application/json', origin: B };
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

(async () => {
  const email = `fin${Date.now()}@example.com`, pw = 'Sup3rSecret99';
  const r = await (await fetch(B + '/api/auth/register', { method: 'POST', headers: H, body: JSON.stringify({ email, password: pw, full_name: 'Fin E2E', state: 'FL', city: 'Miami', language: 'en', accept_terms: true }) })).json();
  await fetch(B + '/api/auth/verify-email', { method: 'POST', headers: H, body: JSON.stringify({ token: r.dev_token }) });
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}); const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/401|409/.test(m.text())) errs.push(m.text()); });
  const api = async (path, init) => { const res = await ctx.request.fetch(B + '/api' + path, { headers: H, ...init }); return res.json(); };
  const step = (n) => console.log('✓', n);

  await p.goto(B + '/login'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', pw); await p.click('form button'); await p.waitForURL((u) => !u.pathname.includes('login'));
  const today = (await api('/finance/dashboard')).today; const yday = addDays(today, -1);
  const cats = (await api('/meta')).categories ?? []; // service categories (may be under another key)
  const catId = (cats[0] && cats[0].id) || (await api('/helpers/categories')).categories?.[0]?.id;
  const helper = await api('/helpers', { method: 'POST', data: JSON.stringify({ full_name: 'Pay Test', function_title: 'Painter', state: 'FL', city: 'Miami', whatsapp: '305 555 0100', category_ids: [catId], description: 'x', messaging_consent: false }) });
  assert.ok(helper.id ?? helper.helper?.id, 'helper created via API: ' + JSON.stringify(helper).slice(0, 200));

  // 1. schedule two days at $150 via UI
  await p.goto(B + '/schedule/new'); await p.selectOption('select#h', { label: 'Pay Test' }); await p.fill('#j', 'Kitchen painting'); await p.fill('#r', '150.00');
  for (const d of [yday, today]) { await p.fill('input[aria-label="Date"]', d); await p.click('button:has-text("Add")'); }
  assert.match(await p.innerText('form'), /2\s+day\(s\) selected/); assert.match(await p.innerText('form'), /\$300\.00/); await p.click('form > div:last-of-type button'); await p.waitForURL(/\/schedule$/);
  await p.waitForSelector('tbody tr td:has-text("Kitchen painting")'); step('scheduled 2 days, total $300.00');

  // 2. complete both
  for (let i = 0; i < 2; i++) { await p.click('button:has-text("Complete") >> nth=0'); await p.waitForTimeout(500); }
  assert.equal(await p.locator('td .badge:has-text("Completed"), td span:has-text("Completed")').count() >= 2, true); step('both days completed');

  // 3. pay: partial 100, overpay rejected, rest 200
  const payFlow = async (amount) => { await p.goto(B + '/schedule/pay'); await p.click('button:has-text("Pay")'); await p.fill('#a', amount); await p.click('form:has(#a) button:has-text("Save")'); await p.waitForTimeout(700); };
  await p.goto(B + '/schedule/pay'); await p.waitForSelector('td:has-text("Pay Test")'); assert.match(await p.innerText('main'), /\$300\.00/);
  await payFlow('100.00'); assert.match(await p.innerText('main'), /\$200\.00/); step('partial payment $100 -> outstanding $200');
  await p.goto(B + '/schedule/pay'); await p.click('button:has-text("Pay")'); await p.fill('#a', '250.00'); await p.click('form:has(#a) button:has-text("Save")'); await p.waitForTimeout(700);
  assert.match(await p.innerText('main'), /more than what is still owed/i); step('overpayment $250 rejected');
  await p.fill('#a', '200.00'); await p.click('form:has(#a) button:has-text("Save")'); await p.waitForTimeout(700);
  await p.goto(B + '/schedule/pay'); assert.equal(await p.locator('button:has-text("Pay")').count(), 0, 'no Pay button once fully paid'); step('fully paid, no further payment possible');

  // 4. receivable $1000 overdue, partial receipt $400 then remaining must still be receivable (regression: button hidden for partial/overdue)
  await p.goto(B + '/money'); await p.click('button:has-text("New receivable")'); await p.fill('#cu', 'ACME Homes'); await p.fill('#de', 'Kitchen job'); await p.fill('#am', '1000.00'); await p.fill('#id', addDays(today, -10)); await p.fill('#dd', addDays(today, -3));
  await p.click('form:has(#cu) button:has-text("Save")'); await p.waitForSelector('td:has-text("ACME Homes")'); assert.match(await p.innerText('tbody'), /Overdue/i); step('receivable created and shown overdue');
  await p.click('button:has-text("Receive")'); await p.fill('#pa', '400.00'); await p.click('form:has(#pa) button:has-text("Save")'); await p.waitForTimeout(700);
  assert.match(await p.innerText('tbody'), /\$400\.00\s+Overdue/i, 'received 400, still overdue (overdue outranks partial)'); assert.equal(await p.locator('button:has-text("Receive")').count(), 1, 'can still receive the remainder'); step('partial receipt $400; remainder still receivable');

  // 5. reconcile DRE vs cash (API numbers)
  const q = `from=${addDays(today, -30)}&to=${addDays(today, 5)}`;
  const dre = await api(`/finance/dre?${q}&basis=accrual`), dreCash = await api(`/finance/dre?${q}&basis=cash`), cf = await api(`/finance/cashflow?${q}`);
  assert.equal(dre.gross_revenue.total_cents, 100000, 'accrual revenue = full invoice'); assert.equal(dre.direct_costs.labor_cents, 30000, 'labor = completed days');
  assert.equal(dreCash.gross_revenue.total_cents, 40000, 'cash revenue = only received'); assert.equal(dreCash.direct_costs.labor_cents, 30000);
  assert.equal(cf.operating.receipts_cents, 40000); assert.equal(cf.operating.helper_payments_cents, 30000); assert.equal(cf.net_movement_cents, 10000); assert.equal(cf.closing_cents, 10000, 'unpaid $600 receivable not in cash');
  step('accrual $1000 vs cash $400, labor $300, cash net $100, unpaid receivable excluded from cash');

  await browser.close(); assert.deepEqual(errs, [], 'browser errors: ' + errs.join(' | ')); console.log('ALL OK');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
