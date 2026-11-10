import { Hono } from 'hono';
import { z } from 'zod';
import { audit, HttpError, iso, newId, notFound, nowIso, parseBody, shortText, type Env, type Vars } from '../core';
import { requireAdmin, requireAuth } from './auth';
import { runMaintenance } from '../services/messaging';

/** Admin sees accounts/health/support only. Contractor business data (helpers, finances, messages) is NOT readable here, even with a grant: grants only unlock aggregate counts. */
export const adminRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();
adminRoutes.use('*', requireAuth, requireAdmin);

adminRoutes.get('/metrics', async (c) => {
  const one = async (sql: string) => (await c.env.DB.prepare(sql).first<{ n: number }>())?.n ?? 0;
  return c.json({
    users: await one('SELECT COUNT(*) n FROM users'), active_users: await one("SELECT COUNT(*) n FROM users WHERE status = 'active'"),
    helpers: await one('SELECT COUNT(*) n FROM helpers'), active_messages: await one("SELECT COUNT(*) n FROM messages WHERE expiration_status = 'active'"),
    open_abuse_reports: await one("SELECT COUNT(*) n FROM abuse_reports WHERE status <> 'closed'"), open_support: await one("SELECT COUNT(*) n FROM support_requests WHERE status = 'open'"),
    last_job: await c.env.DB.prepare('SELECT job, started_at, finished_at, ok, details FROM job_runs ORDER BY started_at DESC LIMIT 1').first(),
  });
});
adminRoutes.get('/users', async (c) => {
  const q = c.req.query('q'); const like = q ? `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%` : '%';
  const rows = await c.env.DB.prepare("SELECT u.id, u.email, u.status, u.created_at, p.full_name, p.state FROM users u JOIN contractor_profiles p ON p.user_id = u.id WHERE u.email LIKE ? ESCAPE '\\' ORDER BY u.created_at DESC LIMIT 200").bind(like).all();
  return c.json({ users: rows.results });
});
adminRoutes.post('/users/:id/status', async (c) => {
  const b = await parseBody(c as any, z.object({ status: z.enum(['active', 'suspended']), reason: shortText(5, 300) }));
  const id = c.req.param('id');
  if (id === c.get('user').id) throw new HttpError(400, 'cannot_change_self');
  const t = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first(); if (!t) throw notFound();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET status = ? WHERE id = ?').bind(b.status, id),
    ...(b.status === 'suspended' ? [c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(nowIso(c as any), id)] : []),
    audit(c as any, 'admin', `user_${b.status}`, 'users', id, { reason: b.reason }),
  ]);
  return c.json({ ok: true });
});
/** Support access grant: time-boxed (1h), reason-required, audited. Unlocks only aggregate counts for that account. */
adminRoutes.post('/users/:id/access-grant', async (c) => {
  const b = await parseBody(c as any, z.object({ reason: shortText(10, 300) })); const id = c.req.param('id');
  if (!(await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first())) throw notFound();
  const now = c.get('now'); const gid = newId();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO admin_access_grants (id, admin_id, owner_id, reason, expires_at, created_at) VALUES (?,?,?,?,?,?)').bind(gid, c.get('user').id, id, b.reason, iso(new Date(now.getTime() + 3_600_000)), iso(now)),
    audit(c as any, 'admin', 'access_grant_created', 'users', id, { reason: b.reason }),
  ]);
  return c.json({ id: gid, expires_in_minutes: 60 }, 201);
});
adminRoutes.get('/users/:id/overview', async (c) => {
  const id = c.req.param('id');
  const g = await c.env.DB.prepare('SELECT id FROM admin_access_grants WHERE admin_id = ? AND owner_id = ? AND expires_at > ?').bind(c.get('user').id, id, nowIso(c as any)).first();
  if (!g) throw new HttpError(403, 'access_grant_required');
  const n = async (t: string) => (await c.env.DB.prepare(`SELECT COUNT(*) n FROM ${t} WHERE owner_id = ?`).bind(id).first<{ n: number }>())!.n;
  await audit(c as any, 'admin', 'overview_viewed', 'users', id).run();
  return c.json({ helpers: await n('helpers'), projects: await n('projects'), receivables: await n('receivables'), expenses: await n('expenses') });
});
adminRoutes.get('/audit-logs', async (c) => {
  const scope = c.req.query('scope') === 'admin' ? 'admin' : 'security'; // financial/data logs belong to the contractor
  const rows = await c.env.DB.prepare('SELECT id, scope, owner_id, actor_id, action, entity, created_at FROM audit_logs WHERE scope = ? ORDER BY created_at DESC LIMIT 200').bind(scope).all();
  return c.json({ logs: rows.results });
});
adminRoutes.get('/abuse-reports', async (c) => c.json({ reports: (await c.env.DB.prepare('SELECT * FROM abuse_reports ORDER BY created_at DESC LIMIT 200').all()).results }));
adminRoutes.post('/abuse-reports/:id', async (c) => {
  const b = await parseBody(c as any, z.object({ status: z.enum(['open', 'reviewing', 'closed']) }));
  const r = await c.env.DB.prepare('UPDATE abuse_reports SET status = ? WHERE id = ?').bind(b.status, c.req.param('id')).run();
  if (!r.meta.changes) throw notFound();
  await audit(c as any, 'admin', 'abuse_report_updated', 'abuse_reports', c.req.param('id'), b).run();
  return c.json({ ok: true });
});
adminRoutes.get('/support', async (c) => c.json({ requests: (await c.env.DB.prepare('SELECT * FROM support_requests ORDER BY created_at DESC LIMIT 200').all()).results }));
adminRoutes.post('/support/:id', async (c) => {
  const b = await parseBody(c as any, z.object({ status: z.enum(['open', 'answered', 'closed']) }));
  const r = await c.env.DB.prepare('UPDATE support_requests SET status = ? WHERE id = ?').bind(b.status, c.req.param('id')).run();
  if (!r.meta.changes) throw notFound();
  return c.json({ ok: true });
});
adminRoutes.post('/jobs/maintenance', async (c) => c.json(await runMaintenance(c.env, c.get('now'))));
