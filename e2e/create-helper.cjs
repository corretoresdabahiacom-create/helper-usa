const { chromium } = require('playwright');
(async () => {
  const B = 'http://localhost:8787'; const H = { 'x-hc-csrf': '1', 'content-type': 'application/json', origin: B };
  const email = `e2f${Date.now()}@example.com`, pw = 'Sup3rSecret99';
  const r = await (await fetch(B + '/api/auth/register', { method: 'POST', headers: H, body: JSON.stringify({ email, password: pw, full_name: 'E2E', state: 'FL', city: 'Miami', language: 'en', accept_terms: true }) })).json();
  await fetch(B + '/api/auth/verify-email', { method: 'POST', headers: H, body: JSON.stringify({ token: r.dev_token }) });
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push('pageerror ' + e.message)); p.on('response', x => { if (x.status() >= 400 && x.url().includes('/api/')) errs.push(x.status() + ' ' + x.url()); });
  await p.goto(B + '/login'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', pw); await p.click('form button'); await p.waitForTimeout(1200);
  await p.goto(B + '/helpers'); await p.click('text=New helper'); await p.waitForTimeout(500);
  await p.screenshot({ path: '/tmp/e2e/newhelper.png', fullPage: true });
  console.log(await p.$$eval('form input,form select,form textarea', e => e.map(x => `${x.tagName}:${x.id || x.name || x.type}`).join(' ')));
  await p.fill('#n','Carlos Silva'); await p.fill('#ft','Painter helper'); await p.selectOption('#st','FL'); await p.fill('#ci','Orlando'); await p.fill('#w','407 555 0123');
  await p.click('text=Painting'); await p.fill('#d','Reliable painter helper.'); await p.click('form button:has-text("Save")'); await p.waitForTimeout(1200);
  console.log('URL', p.url()); console.log((await p.innerText('main')).slice(0,300).replace(/\n/g,' | '));
  await p.screenshot({ path: '/tmp/e2e/afterhelper.png' });
  await b.close(); console.log('ERRS', errs);
})();
