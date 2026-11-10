import { Hono } from 'hono';
import { z } from 'zod';
import { US_STATES, STATE_CODES } from '../../shared/states';
import { isValidTimeZone } from '../../shared/dates';
import {
  audit, auditStmt, currencyCode, HttpError, iso, lang3, newId, nowIso, optText, parseBody, shortText, uid,
  verifyPassword, type Env, type Vars, type Ctx, dateStr, moneyStr,
} from '../core';
import { requireAuth } from './auth';

type H = { Bindings: Env; Variables: Vars };

/** Public reference data (no tenant data). */
export const metaRoutes = new Hono<H>();
metaRoutes.get('/meta', async (c) => {
  const cats = await c.env.DB.prepare(
    'SELECT id, slug, name_en, name_pt, name_es, licensed_trade FROM service_categories WHERE active = 1 ORDER BY sort_order, name_en',
  ).all();
  const subs = await c.env.DB.prepare(
    'SELECT id, category_id, slug, name_en, name_pt, name_es FROM service_subcategories WHERE active = 1 ORDER BY name_en',
  ).all();
  c.header('Cache-Control', 'public, max-age=300');
  return c.json({
    states: US_STATES,
    categories: cats.results,
    subcategories: subs.results,
    languages: ['en', 'pt', 'es'],
    currencies: ['USD', 'EUR', 'BRL', 'CAD', 'MXN'],
    payment_methods: ['cash', 'bank_transfer', 'check', 'zelle', 'card', 'other'],
    capabilities: {
      attachments: !!c.env.ATTACHMENTS,
      translation: !!c.env.AI,
      whatsapp_business_api: false, // wa.me deep links only; the app never sends WhatsApp messages
    },
  });
});

export const accountRoutes = new Hono<H>();
accountRoutes.use('*', requireAuth);

accountRoutes.get('/profile', async (c) => {
  const u = c.get('user');
  const prefs = await c.env.DB.prepare('SELECT email_enabled, message_alerts, payment_reminders FROM notification_preferences WHERE user_id = ?').bind(u.id).first();
  const p = await c.env.DB.prepare('SELECT phone FROM contractor_profiles WHERE user_id = ?').bind(u.id).first<{ phone: string | null }>();
  return c.json({ email: u.email, ...u.profile, phone: p?.phone ?? null, notifications: prefs });
});

const profileSchema = z.object({
  full_name: shortText(2, 120).optional(),
  business_name: optText(160),
  phone: optText(40),
  state: z.enum(STATE_CODES).optional(),
  city: shortText(1, 120).optional(),
  language: lang3.optional(),
  timezone: z.string().refine(isValidTimeZone, 'invalid_timezone').optional(),
  notifications: z.object({ email_enabled: z.boolean(), message_alerts: z.boolean(), payment_reminders: z.boolean() }).partial().optional(),
});
accountRoutes.patch('/profile', async (c) => {
  const b = await parseBody(c as any, profileSchema);
  const u = c.get('user');
  const sets: string[] = []; const vals: unknown[] = [];
  for (const k of ['full_name', 'business_name', 'phone', 'state', 'city', 'language', 'timezone'] as const) {
    if (b[k] !== undefined) { sets.push(`${k} = ?`); vals.push(b[k]); }
  }
  const stmts = [] as D1PreparedStatement[];
  if (sets.length) stmts.push(c.env.DB.prepare(`UPDATE contractor_profiles SET ${sets.join(', ')}, updated_at = ? WHERE user_id = ?`).bind(...vals, nowIso(c as any), u.id));
  if (b.notifications) {
    for (const [k, v] of Object.entries(b.notifications)) {
      if (['email_enabled', 'message_alerts', 'payment_reminders'].includes(k) && v !== undefined)
        stmts.push(c.env.DB.prepare(`UPDATE notification_preferences SET ${k} = ? WHERE user_id = ?`).bind(v ? 1 : 0, u.id));
    }
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

/** Finance settings: accounting basis + opening cash balance (manual — no bank access). */
accountRoutes.put('/finance/settings', async (c) => {
  const b = await parseBody(c as any, z.object({
    accounting_basis: z.enum(['accrual', 'cash']).optional(),
    currency: currencyCode.optional(),
    opening_cash: moneyStr.optional(),
    opening_cash_date: dateStr.optional(),
  }));
  const u = c.get('user');
  const prev = u.profile;
  const sets: string[] = []; const vals: unknown[] = [];
  if (b.accounting_basis) { sets.push('accounting_basis = ?'); vals.push(b.accounting_basis); }
  if (b.currency) { sets.push('currency = ?'); vals.push(b.currency); }
  if (b.opening_cash !== undefined) { sets.push('opening_cash_cents = ?'); vals.push(b.opening_cash); }
  if (b.opening_cash_date) { sets.push('opening_cash_date = ?'); vals.push(b.opening_cash_date); }
  if (!sets.length) throw new HttpError(400, 'validation_error');
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE contractor_profiles SET ${sets.join(', ')}, updated_at = ? WHERE user_id = ?`).bind(...vals, nowIso(c as any), u.id),
    audit(c as any, 'financial', 'settings_changed', 'contractor_profiles', u.id, {
      before: { basis: prev.accounting_basis, currency: prev.currency, opening: prev.opening_cash_cents, opening_date: prev.opening_cash_date },
      after: b,
    }),
  ]);
  return c.json({ ok: true });
});

const OWNER_TABLES = [
  'helpers', 'helper_categories', 'helper_private', 'helper_job_history', 'projects', 'work_assignments', 'workdays',
  'financial_categories', 'receivables', 'receipts', 'expenses', 'expense_payments', 'helper_payments',
  'payment_allocations', 'cash_movements', 'accounting_adjustments', 'conversations', 'consent_records',
];
/** GDPR/CCPA-style data export: everything the contractor owns, as JSON. */
accountRoutes.get('/account/export', async (c) => {
  const u = c.get('user');
  const out: Record<string, unknown> = { exported_at: nowIso(c as any), account: { id: u.id, email: u.email, profile: u.profile } };
  for (const t of OWNER_TABLES) out[t] = (await c.env.DB.prepare(`SELECT * FROM ${t} WHERE owner_id = ?`).bind(u.id).all()).results;
  out.messages = (await c.env.DB.prepare('SELECT id, conversation_id, sender_type, body, original_language, created_at, expires_at FROM messages WHERE owner_id = ? AND expires_at > ? AND deleted_at IS NULL')
    .bind(u.id, nowIso(c as any)).all()).results;
  await audit(c as any, 'data', 'account_export').run();
  c.header('Content-Disposition', 'attachment; filename="helper-connect-export.json"');
  return c.json(out);
});

/** Account deletion: removes all tenant data in FK-safe order, then the user. */
accountRoutes.delete('/account', async (c) => {
  const { password } = await parseBody(c as any, z.object({ password: z.string().max(200), confirm: z.literal('DELETE') }));
  const u = c.get('user');
  const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(u.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(password, row.password_hash))) throw new HttpError(403, 'invalid_credentials');
  // purge attachment objects first
  if (c.env.ATTACHMENTS) {
    const atts = await c.env.DB.prepare('SELECT storage_key FROM message_attachments WHERE owner_id = ?').bind(u.id).all<{ storage_key: string }>();
    for (const a of atts.results) await c.env.ATTACHMENTS.delete(a.storage_key);
  }
  const db = c.env.DB; const id = u.id;
  const d = (t: string) => db.prepare(`DELETE FROM ${t} WHERE owner_id = ?`).bind(id);
  await db.batch([
    d('payment_allocations'), d('helper_payments'), d('workdays'), d('work_assignments'), d('receipts'), d('expense_payments'),
    d('receivables'), d('expenses'), d('projects'), d('accounting_adjustments'), d('cash_movements'), d('consent_records'),
    d('financial_categories'), d('helpers'),
    db.prepare("DELETE FROM audit_logs WHERE owner_id = ? AND scope IN ('financial','data')").bind(id),
    db.prepare('UPDATE audit_logs SET owner_id = NULL, actor_id = NULL WHERE owner_id = ?').bind(id), // keep minimal security metadata, unlinked
    db.prepare('DELETE FROM users WHERE id = ?').bind(id),
    auditStmt(db, { scope: 'security', action: 'account_deleted', at: nowIso(c as any) }),
  ]);
  c.header('Set-Cookie', 'hc_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  return c.json({ ok: true });
});

accountRoutes.post('/support', async (c) => {
  const b = await parseBody(c as any, z.object({ subject: shortText(3, 160), body: shortText(5, 4000) }));
  await c.env.DB.prepare('INSERT INTO support_requests (id, owner_id, subject, body, created_at) VALUES (?,?,?,?,?)')
    .bind(newId(), uid(c as any), b.subject, b.body, nowIso(c as any)).run();
  return c.json({ ok: true }, 201);
});
export type { Ctx };
