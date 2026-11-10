import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { STATE_CODES, tzForState } from '../../shared/states';
import {
  audit, auditStmt, clientIp, cookieHeader, HttpError, isSecureReq, lang3, newId, nowIso, parseBody,
  passwordStrongEnough, randomToken, rateLimit, SESSION_COOKIE, sha256Hex, hashPassword, verifyPassword,
  type AuthUser, type Env, type Vars, iso, shortText,
} from '../core';
import { defaultCategoryStatements } from '../defaults';
import { sendAuthEmail } from '../mail';

const SESSION_DAYS = 30;
const HOUR = 3_600_000;

function getCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

export const requireAuth: MiddlewareHandler<{ Bindings: Env; Variables: Vars }> = async (c, next) => {
  const token = getCookie(c.req.header('cookie'), SESSION_COOKIE);
  if (!token) throw new HttpError(401, 'unauthenticated');
  const hash = await sha256Hex(token);
  const nowStr = iso(c.get('now'));
  const row = await c.env.DB.prepare(
    `SELECT s.id AS session_id, u.id, u.email, u.status, ar.role AS admin_role,
            p.full_name, p.business_name, p.language, p.timezone, p.currency, p.accounting_basis,
            p.state, p.city, p.country, p.opening_cash_cents, p.opening_cash_date
       FROM sessions s JOIN users u ON u.id = s.user_id
       JOIN contractor_profiles p ON p.user_id = u.id
       LEFT JOIN administrator_roles ar ON ar.user_id = u.id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
  ).bind(hash, nowStr).first<Record<string, any>>();
  if (!row) throw new HttpError(401, 'unauthenticated');
  if (row.status !== 'active') throw new HttpError(403, 'account_suspended');
  const user: AuthUser = {
    id: row.id, email: row.email, status: row.status, sessionId: row.session_id,
    isAdmin: !!row.admin_role, adminRole: row.admin_role ?? null,
    profile: {
      full_name: row.full_name, business_name: row.business_name, language: row.language, timezone: row.timezone,
      currency: row.currency, accounting_basis: row.accounting_basis, state: row.state, city: row.city,
      country: row.country, opening_cash_cents: row.opening_cash_cents, opening_cash_date: row.opening_cash_date,
    },
  };
  c.set('user', user);
  await next();
};

export const requireAdmin: MiddlewareHandler<{ Bindings: Env; Variables: Vars }> = async (c, next) => {
  if (!c.get('user')?.isAdmin) throw new HttpError(403, 'forbidden');
  await next();
};

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().max(200).refine(passwordStrongEnough, 'weak_password'),
  full_name: shortText(2, 120),
  business_name: z.string().trim().max(160).optional().nullable(),
  country: z.literal('US').default('US'),
  state: z.enum(STATE_CODES),
  city: shortText(1, 120),
  language: lang3.default('en'),
  accept_terms: z.literal(true),
});

export const authRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

authRoutes.post('/register', async (c) => {
  await rateLimit(c, 'register', clientIp(c), 10, 3600);
  const b = await parseBody(c as any, registerSchema);
  const now = iso(c.get('now'));
  const exists = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(b.email).first();
  const generic = { ok: true, verify_email_sent: true };
  if (exists) return c.json(generic, 201); // do not reveal whether the email is registered
  const userId = newId();
  const token = randomToken();
  const db = c.env.DB;
  await db.batch([
    db.prepare('INSERT INTO users (id, email, password_hash, status, created_at, updated_at) VALUES (?,?,?,?,?,?)')
      .bind(userId, b.email, await hashPassword(b.password), 'pending', now, now),
    db.prepare(`INSERT INTO contractor_profiles (user_id, full_name, business_name, country, state, city, language, timezone, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .bind(userId, b.full_name, b.business_name || null, b.country, b.state, b.city, b.language, tzForState(b.state), now, now),
    db.prepare('INSERT INTO notification_preferences (user_id) VALUES (?)').bind(userId),
    db.prepare('INSERT INTO email_tokens (id, user_id, kind, token_hash, expires_at, created_at) VALUES (?,?,?,?,?,?)')
      .bind(newId(), userId, 'verify_email', await sha256Hex(token), iso(new Date(c.get('now').getTime() + 24 * HOUR)), now),
    db.prepare('INSERT INTO consent_records (id, owner_id, kind, status, source, created_at) VALUES (?,?,?,?,?,?)').bind(newId(), userId, 'terms', 'granted', 'registration', now),
    db.prepare('INSERT INTO consent_records (id, owner_id, kind, status, source, created_at) VALUES (?,?,?,?,?,?)').bind(newId(), userId, 'privacy', 'granted', 'registration', now),
    ...defaultCategoryStatements(db, userId, b.language),
    auditStmt(db, { scope: 'security', ownerId: userId, actorId: userId, action: 'register', at: now }),
  ]);
  await sendAuthEmail(c.env, 'verify', b.email, b.language, token, new URL(c.req.url).origin);
  const dev = c.env.DEV_EXPOSE_TOKENS === 'true' && c.env.ENVIRONMENT !== 'production';
  return c.json(dev ? { ...generic, dev_token: token } : generic, 201);
});

authRoutes.post('/verify-email', async (c) => {
  const { token } = await parseBody(c as any, z.object({ token: z.string().min(10).max(200) }));
  const now = iso(c.get('now'));
  const row = await c.env.DB.prepare(
    "SELECT id, user_id FROM email_tokens WHERE token_hash = ? AND kind = 'verify_email' AND used_at IS NULL AND expires_at > ?",
  ).bind(await sha256Hex(token), now).first<{ id: string; user_id: string }>();
  if (!row) throw new HttpError(400, 'invalid_token');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE email_tokens SET used_at = ? WHERE id = ?').bind(now, row.id),
    c.env.DB.prepare("UPDATE users SET status = 'active', email_verified_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'").bind(now, now, row.user_id),
    auditStmt(c.env.DB, { scope: 'security', ownerId: row.user_id, actorId: row.user_id, action: 'email_verified', at: now }),
  ]);
  return c.json({ ok: true });
});

const DUMMY_HASH = 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

authRoutes.post('/login', async (c) => {
  const b = await parseBody(c as any, z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) }));
  await rateLimit(c, 'login-ip', clientIp(c), 30, 900);
  await rateLimit(c, 'login-email', b.email, 8, 900);
  const now = c.get('now');
  const nowStr = iso(now);
  const u = await c.env.DB.prepare('SELECT id, password_hash, status, failed_logins, locked_until FROM users WHERE email = ?').bind(b.email).first<any>();
  if (u?.locked_until && u.locked_until > nowStr) throw new HttpError(429, 'account_locked');
  const ok = await verifyPassword(b.password, u?.password_hash ?? DUMMY_HASH);
  if (!u || !ok) {
    if (u) {
      const fails = u.failed_logins + 1;
      await c.env.DB.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?')
        .bind(fails, fails >= 10 ? iso(new Date(now.getTime() + 15 * 60_000)) : null, u.id).run();
      await auditStmt(c.env.DB, { scope: 'security', ownerId: u.id, action: 'login_failed', at: nowStr }).run();
    }
    throw new HttpError(401, 'invalid_credentials');
  }
  if (u.status === 'pending') throw new HttpError(403, 'email_not_verified');
  if (u.status !== 'active') throw new HttpError(403, 'account_suspended');
  const token = randomToken();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').bind(u.id),
    c.env.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, user_agent, created_at, expires_at) VALUES (?,?,?,?,?,?)')
      .bind(newId(), u.id, await sha256Hex(token), (c.req.header('user-agent') ?? '').slice(0, 200), nowStr, iso(new Date(now.getTime() + SESSION_DAYS * 24 * HOUR))),
    auditStmt(c.env.DB, { scope: 'security', ownerId: u.id, actorId: u.id, action: 'login', at: nowStr }),
  ]);
  c.header('Set-Cookie', cookieHeader(token, SESSION_DAYS * 86400, isSecureReq(c as any)));
  return c.json({ ok: true });
});

authRoutes.post('/forgot-password', async (c) => {
  const { email } = await parseBody(c as any, z.object({ email: z.string().trim().toLowerCase().email() }));
  await rateLimit(c, 'forgot', clientIp(c), 10, 3600);
  const u = await c.env.DB.prepare("SELECT u.id, p.language FROM users u JOIN contractor_profiles p ON p.user_id = u.id WHERE u.email = ? AND u.status = 'active'").bind(email).first<any>();
  const out: Record<string, unknown> = { ok: true };
  if (u) {
    const token = randomToken();
    await c.env.DB.prepare('INSERT INTO email_tokens (id, user_id, kind, token_hash, expires_at, created_at) VALUES (?,?,?,?,?,?)')
      .bind(newId(), u.id, 'reset_password', await sha256Hex(token), iso(new Date(c.get('now').getTime() + HOUR)), iso(c.get('now'))).run();
    await sendAuthEmail(c.env, 'reset', email, u.language, token, new URL(c.req.url).origin);
    if (c.env.DEV_EXPOSE_TOKENS === 'true' && c.env.ENVIRONMENT !== 'production') out.dev_token = token;
  }
  return c.json(out); // identical response whether or not the account exists
});

authRoutes.post('/reset-password', async (c) => {
  const b = await parseBody(c as any, z.object({ token: z.string().min(10).max(200), password: z.string().max(200).refine(passwordStrongEnough, 'weak_password') }));
  const now = iso(c.get('now'));
  const row = await c.env.DB.prepare(
    "SELECT id, user_id FROM email_tokens WHERE token_hash = ? AND kind = 'reset_password' AND used_at IS NULL AND expires_at > ?",
  ).bind(await sha256Hex(b.token), now).first<{ id: string; user_id: string }>();
  if (!row) throw new HttpError(400, 'invalid_token');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE email_tokens SET used_at = ? WHERE id = ?').bind(now, row.id),
    c.env.DB.prepare('UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = ?')
      .bind(await hashPassword(b.password), now, row.user_id),
    c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(now, row.user_id), // revoke every session
    auditStmt(c.env.DB, { scope: 'security', ownerId: row.user_id, actorId: row.user_id, action: 'password_reset', at: now }),
  ]);
  return c.json({ ok: true });
});

// ───── authenticated session management ─────
authRoutes.use('/logout', requireAuth);
authRoutes.use('/me', requireAuth);
authRoutes.use('/sessions/*', requireAuth);
authRoutes.use('/sessions', requireAuth);
authRoutes.use('/change-password', requireAuth);

authRoutes.post('/logout', async (c) => {
  await c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').bind(nowIso(c as any), c.get('user').sessionId).run();
  c.header('Set-Cookie', cookieHeader('', 0, isSecureReq(c as any)));
  return c.json({ ok: true });
});

authRoutes.get('/me', (c) => {
  const u = c.get('user');
  return c.json({ id: u.id, email: u.email, is_admin: u.isAdmin, admin_role: u.adminRole, profile: u.profile });
});

authRoutes.get('/sessions', async (c) => {
  const u = c.get('user');
  const rows = await c.env.DB.prepare(
    'SELECT id, user_agent, created_at, expires_at FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC',
  ).bind(u.id, iso(c.get('now'))).all<any>();
  return c.json({ sessions: rows.results.map((s) => ({ ...s, current: s.id === u.sessionId })) });
});

authRoutes.delete('/sessions/:id', async (c) => {
  const u = c.get('user');
  const r = await c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
    .bind(iso(c.get('now')), c.req.param('id'), u.id).run(); // user_id check = ownership
  if (!r.meta.changes) throw new HttpError(404, 'not_found');
  return c.json({ ok: true });
});

authRoutes.post('/sessions/revoke-others', async (c) => {
  const u = c.get('user');
  await c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL').bind(iso(c.get('now')), u.id, u.sessionId).run();
  return c.json({ ok: true });
});

authRoutes.post('/change-password', async (c) => {
  const u = c.get('user');
  const b = await parseBody(c as any, z.object({ current_password: z.string().max(200), new_password: z.string().max(200).refine(passwordStrongEnough, 'weak_password') }));
  const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(u.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(b.current_password, row.password_hash))) throw new HttpError(403, 'invalid_credentials');
  const now = iso(c.get('now'));
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').bind(await hashPassword(b.new_password), now, u.id),
    c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL').bind(now, u.id, u.sessionId),
    audit(c as any, 'security', 'password_changed'),
  ]);
  return c.json({ ok: true });
});
