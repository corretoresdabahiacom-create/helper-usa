const { chromium } = require('playwright');
(async () => {
  const B = 'http://localhost:8787'; const H = { 'x-hc-csrf': '1', 'content-type': 'application/json', origin: B };
  const email = `e2e${Date.now()}@example.com`, pw = 'Sup3rSecret99';
  const r = await (await fetch(B + '/api/auth/register', { method: 'POST', headers: H, body: JSON.stringify({ email, password: pw, full_name: 'E2E User', state: 'FL', city: 'Miami', language: 'en', accept_terms: true }) })).json();
  await fetch(B + '/api/auth/verify-email', { method: 'POST', headers: H, body: JSON.stringify({ token: r.dev_token }) });
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}); const ctx = await b.newContext({ viewport: { width: 390, height: 800 } });
  const p = await ctx.newPage(); const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(p.url() + ' console: ' + m.text()); });
  p.on('pageerror', e => errs.push(p.url() + ' pageerror: ' + e.message));
  await p.goto(B + '/login'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', pw);
  await p.click('form button'); await p.waitForURL(u => !u.pathname.includes('login'), { timeout: 8000 }).catch(() => console.log('LOGIN did not navigate'));
  errs.length = 0;
  for (const path of ['/', '/helpers', '/schedule', '/projects', '/money', '/reports', '/messages', '/settings', '/admin', '/legal/terms']) {
    await p.goto(B + path); await p.waitForTimeout(700);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    const txt = (await p.innerText('body')).slice(0, 80).replace(/\n/g, ' | ');
    console.log(path.padEnd(14), overflow ? 'H-OVERFLOW' : 'ok', '|', txt);
    await p.screenshot({ path: `/tmp/p${path.replace(/\W/g, '_')}.png` });
  }
  // create helper through UI
  await p.goto(B + '/helpers'); const btn = await p.$('text=/new helper/i'); console.log('new helper btn', !!btn);
  await b.close(); console.log('ERRS', errs);
})();
