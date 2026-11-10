import { beforeEach, describe, expect, it } from 'vitest';
import { client, makeEnv, signup } from './helpers/app';
import { complete, makeAssignment, makeHelper, NOW, workdaysOf } from './helpers/fixtures';

let env: ReturnType<typeof makeEnv>;
beforeEach(() => { env = makeEnv({ CLOCK_OVERRIDE: NOW }); });

describe('auth & security', () => {
  it('requires auth, CSRF header, and never reveals whether an email exists', async () => {
    const anon = client(env);
    expect((await anon.call('GET', '/api/helpers')).status).toBe(401);
    expect((await anon.call('POST', '/api/auth/login', { email: 'a@b.co', password: 'x' }, { headers: { 'x-hc-csrf': '0' } })).status).toBe(403);
    const { email } = await signup(env);
    const again = await anon.call('POST', '/api/auth/register', { email, password: 'Str0ngPassw0rd', full_name: 'Dup', state: 'TX', city: 'Austin', accept_terms: true });
    expect(again.status).toBe(201);
    expect(again.json.dev_token).toBeUndefined();
    const bad1 = await anon.call('POST', '/api/auth/login', { email, password: 'wrongpass1' });
    const bad2 = await anon.call('POST', '/api/auth/login', { email: 'nobody@example.com', password: 'wrongpass1' });
    expect(bad1.status).toBe(401); expect(bad2.status).toBe(401);
    expect(bad1.json).toEqual(bad2.json);
  });
  it('rejects weak passwords and stores no plaintext', async () => {
    const r = await client(env).call('POST', '/api/auth/register', { email: 'w@example.com', password: 'short', full_name: 'W W', state: 'TX', city: 'Austin', accept_terms: true });
    expect(r.status).toBe(400);
    await signup(env, { email: 'p@example.com' });
    const row = env.DB.db.prepare("SELECT password_hash FROM users WHERE email='p@example.com'").get();
    expect(row.password_hash).toMatch(/^pbkdf2\$/);
    expect(row.password_hash).not.toContain('Str0ngPassw0rd');
  });
  it('locks the account after repeated failures', async () => {
    const { email } = await signup(env);
    const c = client(env); let last = 0;
    for (let i = 0; i < 12; i++) last = (await c.call('POST', '/api/auth/login', { email, password: 'Wrong-pass-1' })).status;
    expect([429]).toContain(last);
    expect((await c.call('POST', '/api/auth/login', { email, password: 'Str0ngPassw0rd' })).status).toBe(429);
  });
  it('sets hardened headers and an HttpOnly SameSite=Strict cookie', async () => {
    const c = client(env); const email = 'h@example.com';
    const reg = await c.call('POST', '/api/auth/register', { email, password: 'Str0ngPassw0rd', full_name: 'H H', state: 'TX', city: 'Austin', accept_terms: true });
    await c.call('POST', '/api/auth/verify-email', { token: reg.json.dev_token });
    const l = await c.call('POST', '/api/auth/login', { email, password: 'Str0ngPassw0rd' });
    const sc = l.res.headers.get('set-cookie')!;
    expect(sc).toMatch(/HttpOnly/i); expect(sc).toMatch(/SameSite=Strict/i);
    expect(l.res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(l.res.headers.get('cache-control')).toBe('no-store');
  });
  it('password reset revokes existing sessions', async () => {
    const { c, email } = await signup(env);
    const f = await client(env).call('POST', '/api/auth/forgot-password', { email });
    const r = await client(env).call('POST', '/api/auth/reset-password', { token: f.json.dev_token, password: 'N3wStrongPassw0rd' });
    expect(r.status).toBe(200);
    expect((await c.call('GET', '/api/auth/me')).status).toBe(401);
  });
});

describe('tenant isolation (IDOR)', () => {
  it('a contractor can never read or change another contractor\'s data', async () => {
    const a = (await signup(env)).c; const b = (await signup(env)).c;
    const hid = await makeHelper(a); const aid = await makeAssignment(a, hid, ['2026-11-12']);
    const wd = (await workdaysOf(a, hid))[0];
    const proj = (await a.call('POST', '/api/work/projects', { name: 'Job A' })).json.id;
    const recv = (await a.call('POST', '/api/finance/receivables', { customer: 'ACME', description: 'x', category_id: (await a.call('GET', '/api/finance/categories')).json.categories.find((x: any) => x.kind === 'revenue').id, amount: '100.00', issue_date: '2026-11-01' })).json.ids[0];
    const probes: [string, string, unknown?][] = [
      ['GET', `/api/helpers/${hid}`], ['PATCH', `/api/helpers/${hid}`, { city: 'X' }], ['DELETE', `/api/helpers/${hid}`], ['GET', `/api/helpers/${hid}/private`],
      ['PUT', `/api/helpers/${hid}/private`, { notes: 'hack' }], ['POST', `/api/helpers/${hid}/invite`, {}],
      ['GET', `/api/work/assignments/${aid}`], ['PATCH', `/api/work/workdays/${wd.id}`, { status: 'confirmed' }],
      ['GET', `/api/work/projects/${proj}`], ['GET', `/api/work/projects/${proj}/summary`],
      ['GET', `/api/finance/receivables/${recv}`], ['POST', `/api/finance/receivables/${recv}/receipts`, { amount: '1.00', date: '2026-11-10', method: 'cash' }],
      ['POST', `/api/finance/receivables/${recv}/cancel`, {}], ['GET', `/api/messages/with/${hid}`], ['POST', `/api/messages/with/${hid}`, { body: 'hi' }],
      ['POST', '/api/work/helper-payments', { helper_id: hid, amount: '1.00', paid_date: '2026-11-10', method: 'cash' }],
    ];
    for (const [m, p, body] of probes) {
      const r = await b.call(m, p, body);
      expect(r.status, `${m} ${p}`).toBe(404);
    }
    expect((await b.call('GET', '/api/helpers')).json.helpers).toHaveLength(0);
    expect((await b.call('GET', '/api/work/workdays?from=2026-01-01&to=2026-12-31')).json.workdays).toHaveLength(0);
    // and A's data is intact
    expect((await a.call('GET', `/api/helpers/${hid}`)).status).toBe(200);
  });
  it('cannot reference another tenant\'s helper/project/category when creating records', async () => {
    const a = (await signup(env)).c; const b = (await signup(env)).c;
    const hid = await makeHelper(a); const proj = (await a.call('POST', '/api/work/projects', { name: 'Proj P' })).json.id;
    expect((await b.call('POST', '/api/work/assignments', { helper_id: hid, job_name: 'Job', dates: ['2026-11-12'], daily_rate: '100.00' })).status).toBe(404);
    const myHelper = await makeHelper(b);
    expect((await b.call('POST', '/api/work/assignments', { helper_id: myHelper, project_id: proj, job_name: 'Job', dates: ['2026-11-12'], daily_rate: '100.00' })).status).toBe(404);
    const aCat = (await a.call('GET', '/api/finance/categories')).json.categories.find((x: any) => x.kind === 'expense').id;
    const r = await b.call('POST', '/api/finance/expenses', { description: 'x', category_id: aCat, amount: '5.00', expense_date: '2026-11-01' });
    expect(r.status).toBe(400);
  });
  it('there are no public helper records or ratings endpoints', async () => {
    const c = client(env);
    for (const p of ['/api/helpers', '/api/public/helpers', '/api/ratings']) expect([401, 404]).toContain((await c.call('GET', p)).status);
  });
});

describe('helpers', () => {
  it('creates, filters, favorites, archives, keeps private notes private, builds WhatsApp link', async () => {
    const { c } = await signup(env); const id = await makeHelper(c);
    expect((await c.call('GET', '/api/helpers?state=TX&q=carlos')).json.helpers).toHaveLength(1);
    expect((await c.call('GET', '/api/helpers?state=CA')).json.helpers).toHaveLength(0);
    await c.call('PUT', `/api/helpers/${id}/private`, { notes: 'late twice', rating: 4 });
    expect(JSON.stringify((await c.call('GET', `/api/helpers/${id}`)).json)).toContain('late twice');
    const w = await c.call('GET', `/api/helpers/${id}/whatsapp`);
    expect(JSON.stringify(w.json)).toContain('wa.me/15125550101');
    expect((await c.call('POST', `/api/helpers/${id}/favorite`, { favorite: true })).status).toBe(200);
    expect((await c.call('POST', `/api/helpers/${id}/archive`, { archived: true })).status).toBe(200);
    expect((await c.call('GET', '/api/helpers')).json.helpers).toHaveLength(0);
  });
  it('warns about possible duplicates without merging', async () => {
    const { c } = await signup(env); await makeHelper(c);
    const cat = (await c.call('GET', '/api/meta')).json.categories[0].id;
    const r = await c.call('POST', '/api/helpers', { full_name: 'Carlos Silva', state: 'TX', city: 'Austin', category_ids: [cat], function_title: 'x1', whatsapp: '5125550101', description: 'd' });
    expect(r.status).toBe(201); expect(r.json.possible_duplicates?.length).toBeGreaterThan(0);
  });
});

describe('scheduling & helper payments', () => {
  it('counts the selected days (not end-start), blocks double booking, only completed days are payable', async () => {
    const { c } = await signup(env); const h = await makeHelper(c);
    const r = await c.call('POST', '/api/work/assignments', { helper_id: h, job_name: 'Roof', dates: ['2026-11-02', '2026-11-04', '2026-11-09'], daily_rate: '150.00' });
    expect(r.json.workdays).toBe(3); expect(r.json.scheduled_total_cents).toBe(45000);
    const dup = await c.call('POST', '/api/work/assignments', { helper_id: h, job_name: 'Other', dates: ['2026-11-04'], daily_rate: '100.00' });
    expect(dup.status).toBe(409); expect(dup.json.error).toBe('workday_conflict');
    const wds = await workdaysOf(c, h);
    expect((await complete(c, wds[0].id)).status).toBe(200); expect((await complete(c, wds[1].id)).status).toBe(200);
    const rep = await c.call('GET', '/api/reports/work?period=custom&from=2026-11-01&to=2026-11-30');
    expect(rep.json.totals.USD.total_cents).toBe(30000);
    expect(rep.json.totals.USD.days).toBe(2);
  });
  it('different daily rates per day are honored and a rate edit affects only that day', async () => {
    const { c } = await signup(env); const h = await makeHelper(c);
    await makeAssignment(c, h, ['2026-11-02', '2026-11-03'], '100.00');
    const [d1, d2] = await workdaysOf(c, h);
    await c.call('PATCH', `/api/work/workdays/${d2.id}`, { daily_rate: '175.50' });
    await complete(c, d1.id); await complete(c, d2.id);
    const rep = await c.call('GET', '/api/reports/work?period=custom&from=2026-11-01&to=2026-11-30');
    expect(rep.json.totals.USD.total_cents).toBe(27550);
    expect(rep.json.by_helper[0].rates_cents).toEqual([10000, 17550]);
  });
  it('cannot complete a future workday; editing a completed day requires a reason', async () => {
    const { c } = await signup(env); const h = await makeHelper(c);
    await makeAssignment(c, h, ['2026-11-20', '2026-11-02']);
    const wds = await workdaysOf(c, h);
    const fut = await complete(c, wds.find((w) => w.work_date === '2026-11-20').id); expect(fut.status).toBe(400); expect(fut.json.error).toBe('future_workday');
    const past = wds.find((w) => w.work_date === '2026-11-02'); await complete(c, past.id);
    expect((await c.call('PATCH', `/api/work/workdays/${past.id}`, { amount_override: '90.00' })).status).toBe(400);
    expect((await c.call('PATCH', `/api/work/workdays/${past.id}`, { amount_override: '90.00', adjustment_reason: 'Left 2 hours early' })).status).toBe(200);
  });
  it('partial and full payments allocate FIFO, never exceed what is owed, and are idempotent', async () => {
    const { c } = await signup(env); const h = await makeHelper(c);
    await makeAssignment(c, h, ['2026-11-02', '2026-11-03', '2026-11-04'], '100.00');
    for (const w of await workdaysOf(c, h)) await complete(c, w.id);
    const pay = (amount: string, extra: Record<string, unknown> = {}) => c.call('POST', '/api/work/helper-payments', { helper_id: h, amount, paid_date: '2026-11-10', method: 'zelle', ...extra });
    const p1 = await pay('150.00', { idempotency_key: 'key-0001-abc' }); expect(p1.status).toBe(201);
    const replay = await pay('150.00', { idempotency_key: 'key-0001-abc' }); expect(replay.status).toBe(200); expect(replay.json.duplicate).toBe(true);
    expect((await pay('150.00')).status).toBe(409); // duplicate-submission guard
    const over = await pay('150.01', { method: 'cash' }); expect(over.status).toBe(409); expect(over.json.error).toBe('exceeds_outstanding'); expect(over.json.outstanding_cents).toBe(15000);
    expect((await pay('150.00', { method: 'cash' })).status).toBe(201);
    const wds = await workdaysOf(c, h); expect(wds.map((w) => w.paid_cents)).toEqual([10000, 10000, 10000]);
    expect(wds.every((w) => w.payment_status === 'paid')).toBe(true);
    expect((await pay('0.01', { method: 'check' })).status).toBe(409);
  });
  it('voiding a payment restores the balance and keeps an audit trail', async () => {
    const { c } = await signup(env); const h = await makeHelper(c);
    await makeAssignment(c, h, ['2026-11-02'], '100.00'); await complete(c, (await workdaysOf(c, h))[0].id);
    const p = await c.call('POST', '/api/work/helper-payments', { helper_id: h, amount: '100.00', paid_date: '2026-11-10', method: 'cash' });
    expect((await c.call('POST', `/api/work/helper-payments/${p.json.id}/void`, { reason: 'Entered by mistake' })).status).toBe(200);
    expect((await workdaysOf(c, h))[0].paid_cents).toBe(0);
    expect((await c.call('POST', `/api/work/helper-payments/${p.json.id}/void`, { reason: 'Entered by mistake' })).status).toBe(409);
    const n = env.DB.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action LIKE 'helper_payment%'").get().n;
    expect(n).toBeGreaterThanOrEqual(2);
  });
  it('db-level guard blocks overpayment even if the API check is bypassed', async () => {
    const { c } = await signup(env); const h = await makeHelper(c);
    await makeAssignment(c, h, ['2026-11-02'], '100.00'); const wd = (await workdaysOf(c, h))[0]; await complete(c, wd.id);
    expect(() => env.DB.db.prepare('UPDATE workdays SET paid_cents = 10001 WHERE id = ?').run(wd.id)).toThrow();
  });
});
