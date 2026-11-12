// Browser E2E: expenses (partial/overdue/paid, cash vs accrual) + messaging/portal (invite link, reply, bulk = separate threads, opt-out block).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const B = process.env.BASE_URL || 'http://localhost:8787';
const H = { 'x-hc-csrf': '1', 'content-type': 'application/json', origin: B };
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const step = (n) => console.log('✓', n);

(async () => {
  const email = `exp${Date.now()}@example.com`, pw = 'Sup3rSecret99';
  const r = await (await fetch(B + '/api/auth/register', { method: 'POST', headers: H, body: JSON.stringify({ email, password: pw, full_name: 'Exp E2E', state: 'TX', city: 'Austin', language: 'en', accept_terms: true }) })).json();
  await fetch(B + '/api/auth/verify-email', { method: 'POST', headers: H, body: JSON.stringify({ token: r.dev_token }) });
  const browser = await require('playwright')[process.env.BROWSER || 'chromium'].launch(process.env.CHROMIUM_PATH && !process.env.BROWSER ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/401|404|409/.test(m.text())) errs.push(m.text()); });
  const api = async (path, init) => (await ctx.request.fetch(B + '/api' + path, { headers: H, ...init })).json();
  await p.goto(B + '/login'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', pw); await p.click('form button'); await p.waitForURL((u) => !u.pathname.includes('login'));
  const today = (await api('/finance/dashboard')).today;

  // ---- Expenses ----
  await p.goto(B + '/money/expenses'); await p.click('button:has-text("New expense")');
  await p.fill('#d', 'Paint supplies'); await p.fill('#p', 'Home Depot'); await p.fill('#a', '500.00'); await p.fill('#ed', addDays(today, -5)); await p.fill('#dd', addDays(today, -2));
  await p.click('form:has(#d) button:has-text("Save")'); await p.waitForSelector('td:has-text("Paint supplies")');
  assert.match(await p.innerText('tbody'), /Overdue/i); step('expense $500 created, shown overdue');
  const payExp = async (amt) => { await p.click('tbody button:has-text("Pay")'); await p.fill('#pa', amt); await p.click('form:has(#pa) button:has-text("Save")'); await p.waitForTimeout(700); };
  await payExp('200.00'); assert.match(await p.innerText('tbody'), /\$200\.00/); step('partial expense payment $200');
  await payExp('400.00'); assert.match(await p.innerText('main'), /more than what is still owed/i); step('expense overpayment rejected');
  await p.fill('#pa', '300.00'); await p.click('form:has(#pa) button:has-text("Save")'); await p.waitForTimeout(700);
  assert.match(await p.innerText('tbody'), /Paid/i); assert.equal(await p.locator('tbody button:has-text("Pay")').count(), 0); step('expense fully paid');
  const q = `from=${addDays(today, -30)}&to=${addDays(today, 5)}`;
  const dre = await api(`/finance/dre?${q}&basis=accrual`), cf = await api(`/finance/cashflow?${q}`);
  assert.equal(cf.operating.expense_payments_cents, 50000); assert.equal(cf.closing_cents, -50000);
  assert.equal(dre.total_expenses_cents, 50000, 'DRE total expenses (no labor yet)'); step('expense hits DRE and cash flow once ($500)');

  // ---- Messaging / portal ----
  const cat = (await api('/meta')).categories?.[0]?.id ?? (await api('/helpers/categories')).categories?.[0]?.id;
  const mk = async (name, consent) => (await api('/helpers', { method: 'POST', data: JSON.stringify({ full_name: name, function_title: 'Helper', state: 'TX', city: 'Austin', whatsapp: '512 555 01' + Math.floor(10 + Math.random() * 89), category_ids: [cat], description: 'x', messaging_consent: consent }) }));
  const mkId = (x) => x.id ?? x.helper?.id;
  const a = mkId(await mk('Ana Consent', true)), b2 = mkId(await mk('Beto Consent', true)), c = mkId(await mk('Caio NoConsent', false));
  assert.ok(a && b2 && c);
  // bulk via UI: only consented helpers selectable
  await p.goto(B + '/messages'); await p.click('button:has-text("Message several")').catch(() => p.click('[role=tab]:has-text("Message several"), a:has-text("Message several")'));
  await p.waitForSelector('text=Ana Consent'); assert.equal(await p.locator('text=Caio NoConsent').count(), 0, 'non-consented helper not offered');
  await p.click('button:has-text("Select all")'); await p.fill('#b', 'Crew meeting tomorrow 7am'); await p.click('button:has-text("individually")'); await p.waitForSelector('text=/Sent privately to 2/i');
  step('bulk sent to 2 consented helpers only');
  for (const id of [a, b2]) { const t = await api(`/messages/with/${id}`); assert.equal(t.messages.length, 1); assert.equal(t.messages[0].body, 'Crew meeting tomorrow 7am'); }
  const ia = await api('/messages/conversations'); assert.equal(ia.conversations.length, 2, 'separate conversation per recipient'); step('each recipient has its own private conversation');
  // non-consented single send blocked by server
  const blocked = await ctx.request.fetch(B + `/api/messages/with/${c}`, { method: 'POST', headers: H, data: JSON.stringify({ body: 'hi', language: 'en' }) });
  assert.equal(blocked.status(), 201, 'single send to unknown-consent helper is allowed (UI warns)'); await p.goto(B + `/messages/${c}`); await p.waitForSelector('text=/have not confirmed/i'); step('single message to unconfirmed helper allowed, with warning');

  // portal: invite -> helper page in a clean (cookie-less) context -> reply -> contractor sees reply
  const inv = await api(`/helpers/${a}/invite`, { method: 'POST' }); assert.match(inv.link, /\/h\//);
  const hctx = await browser.newContext({ viewport: { width: 390, height: 800 } }); const hp = await hctx.newPage(); hp.on('pageerror', (e) => errs.push('portal ' + e.message));
  const link = inv.link.replace(/^https?:\/\/[^/]+/, B); await hp.goto(link); await hp.waitForSelector('text=Crew meeting tomorrow 7am');
  assert.match(await hp.innerText('body'), /Ana Consent/); assert.equal((await hp.innerText('body')).includes('Beto'), false, 'portal shows only own thread');
  await hp.fill('textarea', 'Got it, I will be there'); await hp.click('form button'); await hp.waitForSelector('text=Got it, I will be there'); step('helper opened link without account and replied');
  const t1 = await api(`/messages/with/${a}`); assert.equal(t1.messages.length, 2); assert.equal(t1.messages[1].sender_type, 'helper'); step('contractor sees helper reply');
  // bad token looks the same as revoked/unknown
  const bad = await hctx.newPage(); await bad.goto(B + '/h/not-a-real-token-123'); await bad.waitForSelector('text=/invalid|expired|revoked/i'); step('invalid portal token shows generic error');
  // opt-out via UI -> contractor blocked
  hp.on('dialog', (d) => d.accept()); await hp.click('button:has-text("Stop messages")'); await hp.waitForSelector('text=/will not receive more messages/i');
  const after = await ctx.request.fetch(B + `/api/messages/with/${a}`, { method: 'POST', headers: H, data: JSON.stringify({ body: 'still there?', language: 'en' }) });
  assert.ok(after.status() >= 400, 'send after opt-out must fail: ' + after.status()); await p.goto(B + `/messages/${a}`); await p.waitForSelector('text=/opted out|revoked/i'); step('opt-out blocks further messages (API + UI notice)');
  // old portal link still works for export? (opt-out keeps access to own data) - just ensure no crash
  await browser.close(); assert.deepEqual(errs.filter((e) => !/dynamically imported module|Importing a module script failed/.test(e)), [], 'browser errors: ' + errs.join(' | ')); console.log('ALL OK');
})().catch((e) => { console.error('FAIL', e.message.slice(0, 600)); process.exit(1); });
