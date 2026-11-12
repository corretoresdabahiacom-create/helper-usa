import { afterEach, describe, expect, it, vi } from 'vitest';
import { base32Decode, base32Encode, decryptSecret, encryptSecret, totpAt, verifyTotp } from '../src/worker/services/totp';
import { client, makeEnv, signup } from './helpers/app';

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const T0 = Date.parse('2026-11-10T15:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

describe('TOTP primitives', () => {
  const rfc = base32Encode(new TextEncoder().encode('12345678901234567890'));
  it('matches RFC 6238 test vectors (last 6 digits)', async () => {
    expect(await totpAt(rfc, 59_000)).toBe('287082');
    expect(await totpAt(rfc, 1111111109_000)).toBe('081804');
    expect(await totpAt(rfc, 1234567890_000)).toBe('005924');
  });
  it('base32 round trips', () => { const b = crypto.getRandomValues(new Uint8Array(20)); expect([...base32Decode(base32Encode(b))]).toEqual([...b]); });
  it('accepts ±1 step, rejects ±2 and replays', async () => {
    const now = 1111111109_000, step = Math.floor(now / 30000);
    expect(await verifyTotp(rfc, await totpAt(rfc, now - 30000), now)).toBe(step - 1);
    expect(await verifyTotp(rfc, await totpAt(rfc, now - 90000), now)).toBeNull();
    expect(await verifyTotp(rfc, await totpAt(rfc, now), now, step)).toBeNull(); // replay of the same step
    expect(await verifyTotp(rfc, 'abcdef', now)).toBeNull();
  });
  it('secret encryption round-trips and detects tampering', async () => {
    const enc = await encryptSecret('JBSWY3DPEHPK3PXP', KEY);
    expect(enc).not.toContain('JBSWY3DP'); expect(await decryptSecret(enc, KEY)).toBe('JBSWY3DPEHPK3PXP');
    const [iv, ct] = enc.split('.'); const bad = `${iv}.${ct!.slice(0, -4)}AAAA`;
    await expect(decryptSecret(bad, KEY)).rejects.toBeTruthy();
    await expect(decryptSecret(enc, btoa(String.fromCharCode(...new Uint8Array(32).fill(9))))).rejects.toBeTruthy();
  });
});

describe('two-factor login flow', () => {
  it('is unavailable (503) without TOTP_ENC_KEY', async () => {
    const env = makeEnv(); const { c } = await signup(env);
    expect((await c.call('POST', '/api/auth/2fa/setup', { password: 'Str0ngPassw0rd' })).status).toBe(503);
    expect((await c.call('GET', '/api/auth/2fa/status')).json).toMatchObject({ available: false, enabled: false });
  });
  it('enable → login needs code → replay/recovery/disable', async () => {
    const env = makeEnv({ TOTP_ENC_KEY: KEY, CLOCK_OVERRIDE: iso(T0) });
    const { c, email } = await signup(env);
    expect((await c.call('POST', '/api/auth/2fa/setup', { password: 'wrong-password-1' })).status).toBe(403);
    const setup = await c.call('POST', '/api/auth/2fa/setup', { password: 'Str0ngPassw0rd' });
    expect(setup.status).toBe(200); expect(setup.json.otpauth_uri).toContain('otpauth://totp/');
    const secret: string = setup.json.secret;
    // secret is stored encrypted, never plaintext
    const raw = await env.DB.prepare('SELECT totp_secret FROM users WHERE email = ?').bind(email).first();
    expect(raw.totp_secret).not.toContain(secret);
    expect((await c.call('POST', '/api/auth/2fa/enable', { code: '000000' })).status).toBe(400);
    const en = await c.call('POST', '/api/auth/2fa/enable', { code: await totpAt(secret, T0) });
    expect(en.status).toBe(200); expect(en.json.recovery_codes).toHaveLength(8);
    const hashes = await env.DB.prepare('SELECT code_hash FROM recovery_codes').all();
    expect(hashes.results.some((r: any) => en.json.recovery_codes.includes(r.code_hash))).toBe(false); // hashed at rest

    const login = (body: any) => client(env).call('POST', '/api/auth/login', { email, password: 'Str0ngPassw0rd', ...body });
    expect((await login({})).status).toBe(401); expect((await login({})).json.error).toBe('totp_required');
    expect((await login({ code: '123456' })).json.error).toBe('invalid_code');
    expect((await login({ code: await totpAt(secret, T0) })).json.error).toBe('invalid_code'); // same step used at enable → replay blocked
    env.CLOCK_OVERRIDE = iso(T0 + 30_000);
    const code2 = await totpAt(secret, T0 + 30_000);
    const ok = await login({ code: code2 }); expect(ok.status).toBe(200);
    expect((await login({ code: code2 })).json.error).toBe('invalid_code'); // replay of the code just used
    env.CLOCK_OVERRIDE = iso(T0 + 20 * 60_000); // new rate-limit window
    const rc = en.json.recovery_codes[0];
    expect((await login({ code: rc })).status).toBe(200);
    expect((await login({ code: rc })).json.error).toBe('invalid_code'); // one-time
    expect((await c.call('GET', '/api/auth/2fa/status')).json).toMatchObject({ enabled: true, recovery_codes_left: 7 });
    // disable requires password + code
    expect((await c.call('POST', '/api/auth/2fa/disable', { password: 'Str0ngPassw0rd', code: '111111' })).status).toBe(400);
    env.CLOCK_OVERRIDE = iso(T0 + 40 * 60_000);
    expect((await c.call('POST', '/api/auth/2fa/disable', { password: 'Str0ngPassw0rd', code: await totpAt(secret, T0 + 40 * 60_000) })).status).toBe(200);
    expect((await login({})).status).toBe(200);
  });
  it('failed 2FA codes count toward account lockout', async () => {
    const env = makeEnv({ TOTP_ENC_KEY: KEY, CLOCK_OVERRIDE: iso(T0) });
    const { c, email } = await signup(env);
    const s = await c.call('POST', '/api/auth/2fa/setup', { password: 'Str0ngPassw0rd' });
    await c.call('POST', '/api/auth/2fa/enable', { code: await totpAt(s.json.secret, T0) });
    let last = 0;
    for (let i = 0; i < 11; i++) { env.CLOCK_OVERRIDE = iso(T0 + i * 1000); last = (await client(env).call('POST', '/api/auth/login', { email, password: 'Str0ngPassw0rd', code: '999999' }, { headers: { 'cf-connecting-ip': `10.0.0.${i}` } })).status; }
    expect([401, 429]).toContain(last); expect(last).toBe(429);
  });
});

describe('Turnstile', () => {
  afterEach(() => vi.unstubAllGlobals());
  const reg = (env: any, extra = {}) => client(env).call('POST', '/api/auth/register', { email: `t${Math.random()}@example.com`, password: 'Str0ngPassw0rd', full_name: 'Tee Test', state: 'TX', city: 'Austin', accept_terms: true, ...extra });
  it('is a no-op when not configured', async () => { expect((await reg(makeEnv())).status).toBe(201); });
  it('requires a valid token when configured (fail closed)', async () => {
    const env = makeEnv({ TURNSTILE_SECRET: 's', TURNSTILE_SITE_KEY: 'k' });
    expect((await reg(env)).json.error).toBe('captcha_failed');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true }))));
    expect((await reg(env, { turnstile_token: 'good' })).status).toBe(201);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false }))));
    expect((await reg(env, { turnstile_token: 'bad' })).json.error).toBe('captcha_failed');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    expect((await reg(env, { turnstile_token: 'x' })).json.error).toBe('captcha_failed');
    expect((await client(env).call('POST', '/api/auth/login', { email: 'a@b.co', password: 'x' })).json.error).toBe('captcha_failed');
    expect((await client(env).call('POST', '/api/auth/forgot-password', { email: 'a@b.co' })).json.error).toBe('captcha_failed');
  });
  it('/api/meta exposes the site key only when fully configured', async () => {
    expect((await client(makeEnv({ TURNSTILE_SITE_KEY: 'k' })).call('GET', '/api/meta')).json.turnstile_site_key).toBeNull();
    expect((await client(makeEnv({ TURNSTILE_SITE_KEY: 'k', TURNSTILE_SECRET: 's' })).call('GET', '/api/meta')).json.turnstile_site_key).toBe('k');
  });
});

describe('request size limits', () => {
  it('rejects oversized JSON bodies with 413 before parsing', async () => {
    const env = makeEnv(); const c = client(env);
    const res = await c.call('POST', '/api/auth/login', { email: 'a@b.co', password: 'x'.repeat(300_000) });
    expect(res.status).toBe(413); expect(res.json.error).toBe('payload_too_large');
  });
});

describe('admin 2FA enforcement', () => {
  it('admin needs 2FA when the server supports it; works again after enabling', async () => {
    const env = makeEnv({ TOTP_ENC_KEY: KEY, CLOCK_OVERRIDE: iso(T0) });
    const { c, email } = await signup(env);
    const uid = env.DB.db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;
    env.DB.db.prepare("INSERT INTO administrator_roles (user_id, role, created_at) VALUES (?, 'super_admin', ?)").run(uid, iso(T0));
    const blocked = await c.call('GET', '/api/admin/metrics'); expect(blocked.status).toBe(403); expect(blocked.json.error).toBe('two_factor_required');
    const s = await c.call('POST', '/api/auth/2fa/setup', { password: 'Str0ngPassw0rd' });
    expect((await c.call('POST', '/api/auth/2fa/enable', { code: await totpAt(s.json.secret, T0) })).status).toBe(200);
    expect((await c.call('GET', '/api/admin/metrics')).status).toBe(200);
  });
});
