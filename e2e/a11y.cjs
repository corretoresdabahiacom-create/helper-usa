// Accessibility (axe-core WCAG 2.0/2.1 A+AA) + responsive overflow across phone/tablet/desktop widths.
const { chromium } = require('playwright');
const fs = require('node:fs');
const B = process.env.BASE_URL || 'http://localhost:8787';
const H = { 'x-hc-csrf': '1', 'content-type': 'application/json', origin: B };
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const PAGES = ['/', '/helpers', '/helpers/new', '/schedule', '/schedule/new', '/schedule/pay', '/projects', '/money', '/money/expenses', '/reports', '/messages', '/settings', '/legal/terms'];
const WIDTHS = [[390, 844], [768, 1024], [1280, 800]];

(async () => {
  const email = `a11y${Date.now()}@example.com`, pw = 'Sup3rSecret99';
  const r = await (await fetch(B + '/api/auth/register', { method: 'POST', headers: H, body: JSON.stringify({ email, password: pw, full_name: 'A11y E2E', state: 'CA', city: 'Fresno', language: 'en', accept_terms: true }) })).json();
  await fetch(B + '/api/auth/verify-email', { method: 'POST', headers: H, body: JSON.stringify({ token: r.dev_token }) });
  const browser = await require('playwright')[process.env.BROWSER || 'chromium'].launch(process.env.CHROMIUM_PATH && !process.env.BROWSER ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const found = new Map(); let overflow = [];
  for (const [w, h] of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } }); const p = await ctx.newPage();
    const scan = async (path) => {
      await p.goto(B + path); await p.waitForTimeout(600);
      if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) overflow.push(`${path}@${w}`);
      await p.evaluate(AXE);
      const res = await p.evaluate(() => axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }));
      for (const v of res.violations) { const k = `${v.impact} ${v.id}`; const e = found.get(k) ?? { help: v.help, where: new Set(), nodes: new Set() }; e.where.add(`${path}@${w}`); v.nodes.slice(0, 2).forEach((n) => e.nodes.add(n.target.join(' '))); found.set(k, e); }
    };
    for (const path of ['/login', '/register']) await scan(path);
    await p.goto(B + '/login'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', pw); await p.click('form button'); await p.waitForURL((u) => !u.pathname.includes('login'));
    for (const path of PAGES) await scan(path);
    await ctx.close();
  }
  await browser.close();
  console.log('overflow:', overflow.length ? overflow.join(', ') : 'none');
  for (const [k, e] of [...found].sort()) console.log(k, '|', e.help, '|', [...e.where].slice(0, 6).join(','), '|', [...e.nodes].slice(0, 3).join(' ; '));
  const bad = [...found.keys()].filter((k) => /^(serious|critical)/.test(k));
  console.log(bad.length || overflow.length ? 'FAIL' : 'ALL OK'); process.exit(bad.length || overflow.length ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message.slice(0, 500)); process.exit(1); });
