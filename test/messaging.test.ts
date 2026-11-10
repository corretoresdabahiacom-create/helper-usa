import { describe, expect, it } from 'vitest';
import { client, makeEnv, signup } from './helpers/app';
import { makeHelper, NOW } from './helpers/fixtures';
import { runMaintenance } from '../src/worker/services/messaging';

const at = (iso: string) => new Date(iso);

describe('messaging', () => {
  it('messages are visible for 24h, then hidden by the API and wiped by cleanup', async () => {
    const env = makeEnv({ CLOCK_OVERRIDE: NOW }); const { c } = await signup(env); const h = await makeHelper(c);
    const s = await c.call('POST', `/api/messages/with/${h}`, { body: 'Show up at 7am' });
    expect(s.status).toBe(201); expect(s.json.expires_at).toBe('2026-11-11T15:00:00.000Z');
    env.CLOCK_OVERRIDE = '2026-11-11T14:59:59Z';
    expect((await c.call('GET', `/api/messages/with/${h}`)).json.messages).toHaveLength(1);
    env.CLOCK_OVERRIDE = '2026-11-11T15:00:01Z';
    // hidden by the API immediately, even before the cleanup job runs
    expect((await c.call('GET', `/api/messages/with/${h}`)).json.messages).toHaveLength(0);
    expect(env.DB.db.prepare('SELECT body FROM messages').get().body).toBe('Show up at 7am');
    const r = await runMaintenance(env, at('2026-11-11T15:00:01Z'));
    expect(r.messages_expired).toBe(1);
    const row = env.DB.db.prepare('SELECT body, deleted_at, expiration_status FROM messages').get();
    expect(row.body).toBeNull(); expect(row.expiration_status).toBe('deleted'); expect(row.deleted_at).toBeTruthy();
    expect((await runMaintenance(env, at('2026-11-11T15:05:00Z'))).messages_expired).toBe(0); // idempotent
  });
  it('expired messages do not leak through export, account export or translation', async () => {
    const env = makeEnv({ CLOCK_OVERRIDE: NOW }); const { c } = await signup(env); const h = await makeHelper(c);
    const s = await c.call('POST', `/api/messages/with/${h}`, { body: 'secret address 123' });
    env.CLOCK_OVERRIDE = '2026-11-12T00:00:00Z';
    const ex = await c.call('GET', `/api/messages/with/${h}/export?format=txt`, undefined, { raw: true });
    expect(await ex.res.text()).not.toContain('secret address');
    expect(JSON.stringify((await c.call('GET', '/api/account/export')).json ?? {})).not.toContain('secret address');
    expect((await c.call('POST', `/api/messages/${s.json.id}/translate`, { lang: 'pt' })).status).toBe(404);
  });
  it('bulk send creates separate private conversations, skipping no-consent/opted-out/foreign helpers', async () => {
    const env = makeEnv({ CLOCK_OVERRIDE: NOW }); const { c } = await signup(env); const other = (await signup(env)).c;
    const a = await makeHelper(c, { full_name: 'Ana', whatsapp: '5125550111' });
    const b = await makeHelper(c, { full_name: 'Bob', whatsapp: '5125550112' });
    const n = await makeHelper(c, { full_name: 'NoConsent', whatsapp: '5125550113', messaging_consent: false });
    const foreign = await makeHelper(other, { whatsapp: '5125550114' });
    const r = await c.call('POST', '/api/messages/bulk', { helper_ids: [a, b, n, foreign], body: 'Work tomorrow?' });
    expect(r.status).toBe(201); expect(r.json.sent_count).toBe(2);
    expect(r.json.skipped.map((x: any) => x.reason).sort()).toEqual(['no_consent', 'not_found']);
    const convs = env.DB.db.prepare('SELECT COUNT(*) n FROM conversations').get().n; expect(convs).toBe(2);
    const parts = env.DB.db.prepare("SELECT conversation_id, COUNT(*) n FROM conversation_participants WHERE participant_type = 'helper' GROUP BY conversation_id").all();
    expect(parts.every((p: any) => p.n === 1)).toBe(true); // never a shared group
    expect((await c.call('GET', `/api/messages/with/${a}`)).json.messages[0].is_bulk).toBe(1);
    expect((await other.call('GET', `/api/messages/with/${foreign}`)).json.messages).toHaveLength(0); // foreign helper got nothing
    expect((await c.call('POST', '/api/messages/bulk', { helper_ids: [a], body: 'x'.repeat(2001) })).status).toBe(400);
  });
  it('helper portal: token-only access, sees only own thread, can reply, opt out, export; revoked/expired/unknown tokens look identical', async () => {
    const env = makeEnv({ CLOCK_OVERRIDE: NOW }); const { c } = await signup(env); const h1 = await makeHelper(c); const h2 = await makeHelper(c, { full_name: 'Other Helper', whatsapp: '5125550199' });
    await c.call('POST', `/api/messages/with/${h1}`, { body: 'For helper one only' });
    await c.call('POST', `/api/messages/with/${h2}`, { body: 'For helper two only' });
    const inv = await c.call('POST', `/api/helpers/${h1}/invite`, {}); const token = inv.json.link.split('/h/')[1];
    const anon = client(env);
    const v = await anon.call('GET', `/api/portal/${token}`);
    expect(v.status).toBe(200); expect(JSON.stringify(v.json)).toContain('For helper one only'); expect(JSON.stringify(v.json)).not.toContain('helper two');
    expect(JSON.stringify(v.json)).not.toMatch(/whatsapp|email|owner_id/i);
    expect((await anon.call('POST', `/api/portal/${token}/messages`, { body: 'On my way' })).status).toBe(201);
    expect(JSON.stringify((await c.call('GET', `/api/messages/with/${h1}`)).json.messages)).toContain('On my way');
    const tx = await anon.call('GET', `/api/portal/${token}/export?format=txt`, undefined, { raw: true }); expect(await tx.res.text()).toContain('On my way');
    // opt-out blocks both individual and bulk
    expect((await anon.call('POST', `/api/portal/${token}/opt-out`, {})).status).toBe(200);
    expect((await c.call('POST', `/api/messages/with/${h1}`, { body: 'hello?' })).status).toBe(409);
    expect((await c.call('POST', '/api/messages/bulk', { helper_ids: [h1], body: 'hi' })).json.skipped[0].reason).toBe('opted_out');
    // revoke by re-inviting
    await c.call('POST', `/api/helpers/${h1}/invite`, {});
    const gone = await anon.call('GET', `/api/portal/${token}`); const unknown = await anon.call('GET', `/api/portal/${'a'.repeat(32)}`);
    expect(gone.status).toBe(404); expect(unknown.status).toBe(404); expect(gone.json).toEqual(unknown.json);
    // token stored hashed only
    const stored = env.DB.db.prepare('SELECT token_hash FROM invitations').all().map((r: any) => r.token_hash).join();
    expect(stored).not.toContain(token);
  });
  it('conversation PDF export is valid and logged', async () => {
    const env = makeEnv({ CLOCK_OVERRIDE: NOW }); const { c } = await signup(env); const h = await makeHelper(c);
    await c.call('POST', `/api/messages/with/${h}`, { body: 'Hola (test) \\ ok' });
    const r = await c.call('GET', `/api/messages/with/${h}/export?format=pdf`, undefined, { raw: true });
    const buf = Buffer.from(await r.res.arrayBuffer()); expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(env.DB.db.prepare('SELECT COUNT(*) n FROM message_exports').get().n).toBe(1);
  });
  it('attachments and translation are honestly disabled when their bindings are missing', async () => {
    const env = makeEnv({ CLOCK_OVERRIDE: NOW }); const { c } = await signup(env); const h = await makeHelper(c);
    expect((await c.call('POST', `/api/messages/with/${h}/attachments`, {})).status).toBe(501);
    const m = await c.call('POST', `/api/messages/with/${h}`, { body: 'hello' });
    expect((await c.call('POST', `/api/messages/${m.json.id}/translate`, { lang: 'pt' })).status).toBe(503);
  });
});

describe('admin & account lifecycle', () => {
  it('non-admins are blocked; admin cannot read contractor data without a grant; suspension revokes sessions', async () => {
    const env = makeEnv({ CLOCK_OVERRIDE: NOW }); const { c } = await signup(env); const { c: adm, email } = await signup(env);
    expect((await c.call('GET', '/api/admin/users')).status).toBe(403);
    const uid = env.DB.db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;
    env.DB.db.prepare("INSERT INTO administrator_roles (user_id, role, created_at) VALUES (?, 'super_admin', ?)").run(uid, NOW);
    expect((await adm.call('GET', '/api/admin/metrics')).status).toBe(200);
    const target = env.DB.db.prepare('SELECT id FROM users WHERE id <> ? LIMIT 1').get(uid).id;
    expect((await adm.call('GET', `/api/admin/users/${target}/overview`)).status).toBe(403);
    expect((await adm.call('POST', `/api/admin/users/${target}/access-grant`, { reason: 'Support ticket #42' })).status).toBe(201);
    expect((await adm.call('GET', `/api/admin/users/${target}/overview`)).status).toBe(200);
    expect(Object.keys((await adm.call('GET', `/api/admin/users/${target}/overview`)).json).sort()).toEqual(['expenses', 'helpers', 'projects', 'receivables']);
    expect((await adm.call('POST', `/api/admin/users/${target}/status`, { status: 'suspended', reason: 'Abuse report confirmed' })).status).toBe(200);
    expect((await c.call('GET', '/api/auth/me')).status).toBe(401);
  });
  it('account deletion requires password + confirmation and removes all tenant data', async () => {
    const env = makeEnv({ CLOCK_OVERRIDE: NOW }); const { c, email } = await signup(env); const h = await makeHelper(c);
    await c.call('POST', `/api/messages/with/${h}`, { body: 'bye' });
    expect((await c.call('DELETE', '/api/account', { password: 'wrong', confirm: 'DELETE' })).status).toBeGreaterThanOrEqual(400);
    const r = await c.call('DELETE', '/api/account', { password: 'Str0ngPassw0rd', confirm: 'DELETE' });
    expect(r.status).toBe(200);
    for (const t of ['helpers', 'messages', 'conversations', 'sessions']) expect(env.DB.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n, t).toBe(0);
    expect(env.DB.db.prepare('SELECT COUNT(*) n FROM users WHERE email = ?').get(email).n).toBe(0);
  });
});
