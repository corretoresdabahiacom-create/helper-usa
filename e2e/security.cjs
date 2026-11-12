// Browser E2E: 2FA enable via Settings, login with TOTP/recovery code, CSP headers and no CSP violations.
const { chromium } = require('playwright');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const B = process.env.BASE_URL || 'http://localhost:8787';
const H = { 'x-hc-csrf': '1', 'content-type': 'application/json', origin: B };
const step = (n) => console.log('✓', n);
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32 = (s) => { let bits = 0, v = 0; const o = []; for (const ch of s) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(o); };
const totp = (secret, offset = 0) => { const c = Math.floor(Date.now() / 30000) + offset; const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(c)); const h = crypto.createHmac('sha1', b32(secret)).update(b).digest(); const o = h[19] & 15; return String(((h.readUInt32BE(o) & 0x7fffffff) % 1000000)).padStart(6, '0'); };

(async () => {
  const email = `sec${Date.now()}@example.com`, pw = 'Sup3rSecret99';
  const r = await (await fetch(B + '/api/auth/register', { method: 'POST', headers: H, body: JSON.stringify({ email, password: pw, full_name: 'Sec E2E', state: 'NY', city: 'Albany', language: 'en', accept_terms: true }) })).json();
  await fetch(B + '/api/auth/verify-email', { method: 'POST', headers: H, body: JSON.stringify({ token: r.dev_token }) });
  const browser = await require('playwright')[process.env.BROWSER || 'chromium'].launch(process.env.CHROMIUM_PATH && !process.env.BROWSER ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/status of 40[01]/.test(m.text())) errs.push(m.text()); });
  const login = async (code) => { await p.goto(B + '/login'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', pw); await p.click('form button'); if (code === undefined) return p.waitForURL((u) => !u.pathname.includes('login')); await p.waitForSelector('#tc'); await p.fill('#tc', code); await p.click('form button'); };

  const home = await p.goto(B + '/login'); const csp = home.headers()['content-security-policy'] || '';
  assert.match(csp, /default-src 'self'/); assert.match(csp, /frame-ancestors 'none'/); assert.equal(home.headers()['x-frame-options'], 'DENY'); step('static pages carry CSP + security headers');
  await login(); await p.goto(B + '/settings'); await p.waitForSelector('text=Two-factor authentication');
  await p.fill('#tfp', pw); await p.click('button:has-text("Set up")'); await p.waitForSelector('[data-testid=totp-secret]');
  const qr = await p.locator('img[alt^="QR code"]'); assert.equal(await qr.count(), 1, 'QR code shown'); assert.ok((await qr.getAttribute('src')).startsWith('data:image/'), 'QR is a local data URL'); step('QR code rendered locally');
  const secret = (await p.innerText('[data-testid=totp-secret]')).trim(); assert.match(secret, /^[A-Z2-7]{32}$/);
  await p.fill('#tfc', '000000'); await p.click('button:has-text("Turn on")'); await p.waitForSelector('text=/not valid/i'); step('wrong code rejected during setup');
  await p.fill('#tfc', totp(secret)); await p.click('button:has-text("Turn on")'); await p.waitForSelector('[data-testid=recovery-codes]');
  const codes = (await p.innerText('[data-testid=recovery-codes]')).trim().split(/\s+/); assert.equal(codes.length, 8); assert.match(codes[0], /^[a-z2-7]{5}-[a-z2-7]{5}$/); step('2FA enabled, 8 recovery codes shown once');
  await p.click('button:has-text("I saved them")'); await p.waitForSelector('text=/Two-factor is on/');

  await ctx.clearCookies(); await p.goto(B + '/login'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', pw); await p.click('form button');
  await p.waitForSelector('#tc'); assert.ok(p.url().includes('login'), 'still on login until the code is given'); step('login asks for the code');
  await p.fill('#tc', '123456'); await p.click('form button'); await p.waitForSelector('text=/not valid/i'); step('wrong login code rejected');
  await p.fill('#tc', totp(secret, 1)); await p.click('form button'); await p.waitForURL((u) => !u.pathname.includes('login')); step('login with TOTP code');
  await ctx.clearCookies(); await login(codes[0]); await p.waitForURL((u) => !u.pathname.includes('login')); step('login with recovery code');
  await ctx.clearCookies(); await login(codes[0]); await p.waitForSelector('text=/not valid/i'); step('recovery code cannot be reused');
  await browser.close(); assert.deepEqual(errs.filter((e) => !/dynamically imported module|Importing a module script failed/.test(e)), [], 'browser/CSP errors: ' + errs.join(' | ')); console.log('ALL OK');
})().catch((e) => { console.error('FAIL', e.message.slice(0, 600)); process.exit(1); });
