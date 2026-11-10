import { Hono } from 'hono';
import { z } from 'zod';
import { STATE_CODES } from '../../shared/states';
import { normalizePhone, whatsappLink } from '../../shared/phone';
import {
  audit, auditStmt, currencyCode, dateStr, HttpError, iso, lang3, moneyStr, newId, notFound, nowIso, optText, parseBody, parseWith,
  randomToken, sha256Hex, shortText, uid, type Ctx, type Env, type Vars,
} from '../core';
import { requireAuth } from './auth';

export const helperRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();
helperRoutes.use('*', requireAuth);

const phoneField = z.string().trim().max(40).transform((s, ctx) => {
  const n = normalizePhone(s);
  if (!n) { ctx.addIssue({ code: 'custom', message: 'invalid_phone' }); return z.NEVER; }
  return n;
});
const catId = z.string().min(1).max(64);

const helperSchema = z.object({
  full_name: shortText(2, 120),
  state: z.enum(STATE_CODES),
  city: shortText(1, 120),
  category_ids: z.array(catId).min(1).max(12),
  main_category_id: catId.optional(),
  function_title: shortText(2, 120),
  whatsapp: phoneField,
  phone: phoneField.optional().nullable().or(z.literal('').transform(() => null)),
  email: z.string().trim().email().max(254).optional().nullable().or(z.literal('').transform(() => null)),
  language: lang3.default('en'),
  description: shortText(1, 2000),
  experience: optText(1000), skills: optText(1000), certifications: optText(1000), licenses: optText(1000),
  availability: optText(500), work_preferences: optText(1000),
  messaging_consent: z.boolean().optional(),
});

async function ownedHelper(c: Ctx, id: string) {
  const h = await c.env.DB.prepare('SELECT * FROM helpers WHERE id = ? AND owner_id = ?').bind(id, uid(c)).first<any>();
  if (!h) throw notFound(); // 404 (not 403) so other tenants' ids cannot be probed
  return h;
}
export { ownedHelper };

async function validCategories(c: Ctx, ids: string[]) {
  const uniq = [...new Set(ids)];
  const rows = await c.env.DB.prepare(`SELECT id FROM service_categories WHERE active = 1 AND id IN (${uniq.map(() => '?').join(',')})`).bind(...uniq).all();
  if (rows.results.length !== uniq.length) throw new HttpError(400, 'validation_error', { issues: [{ path: 'category_ids', code: 'invalid_category' }] });
  return uniq;
}

helperRoutes.post('/', async (c) => {
  const b = await parseBody(c as any, helperSchema);
  const cats = await validCategories(c as any, b.category_ids);
  const main = b.main_category_id ?? cats[0];
  if (!cats.includes(main)) throw new HttpError(400, 'validation_error', { issues: [{ path: 'main_category_id', code: 'invalid_category' }] });
  const owner = uid(c as any); const now = nowIso(c as any); const id = newId(); const db = c.env.DB;
  const consent = b.messaging_consent ? 'granted' : 'unknown';
  const dup = await db.prepare('SELECT id, full_name FROM helpers WHERE owner_id = ? AND whatsapp_e164 = ? AND archived_at IS NULL').bind(owner, b.whatsapp).all();
  await db.batch([
    db.prepare(`INSERT INTO helpers (id, owner_id, full_name, state, city, main_category_id, function_title, whatsapp_e164, phone, email, language, description,
                experience, skills, certifications, licenses, availability, work_preferences, messaging_consent, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, owner, b.full_name, b.state, b.city, main, b.function_title, b.whatsapp, b.phone ?? null, b.email ?? null, b.language, b.description,
        b.experience ?? null, b.skills ?? null, b.certifications ?? null, b.licenses ?? null, b.availability ?? null, b.work_preferences ?? null, consent, now, now),
    ...cats.map((cid) => db.prepare('INSERT INTO helper_categories (helper_id, owner_id, category_id) VALUES (?,?,?)').bind(id, owner, cid)),
    db.prepare('INSERT INTO helper_private (helper_id, owner_id, updated_at) VALUES (?,?,?)').bind(id, owner, now),
    ...(b.messaging_consent ? [db.prepare('INSERT INTO consent_records (id, owner_id, helper_id, kind, status, source, created_at) VALUES (?,?,?,?,?,?,?)').bind(newId(), owner, id, 'messaging', 'granted', 'contractor_attested', now)] : []),
  ]);
  // Helpers are never merged automatically; we only warn about same-number records the contractor already owns.
  return c.json({ id, possible_duplicates: dup.results }, 201);
});

helperRoutes.get('/', async (c) => {
  const q = c.req.query();
  const where = ['h.owner_id = ?']; const args: unknown[] = [uid(c as any)];
  if (q.state) { where.push('h.state = ?'); args.push(q.state); }
  if (q.city) { where.push('h.city = ? COLLATE NOCASE'); args.push(q.city); }
  if (q.category_id) { where.push('EXISTS (SELECT 1 FROM helper_categories hc WHERE hc.helper_id = h.id AND hc.owner_id = h.owner_id AND hc.category_id = ?)'); args.push(q.category_id); }
  if (q.favorite === '1') where.push('h.favorite = 1');
  where.push(q.archived === '1' ? 'h.archived_at IS NOT NULL' : 'h.archived_at IS NULL');
  if (q.q) {
    const like = `%${q.q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    where.push("(h.full_name LIKE ? ESCAPE '\\' OR h.function_title LIKE ? ESCAPE '\\' OR h.city LIKE ? ESCAPE '\\' OR h.skills LIKE ? ESCAPE '\\')");
    args.push(like, like, like, like);
  }
  const limit = Math.min(Number(q.limit) || 100, 200); const offset = Math.max(Number(q.offset) || 0, 0);
  const rows = await c.env.DB.prepare(
    `SELECT h.id, h.full_name, h.state, h.city, h.main_category_id, h.function_title, h.whatsapp_e164, h.language, h.favorite,
            h.archived_at, h.messaging_consent, h.opted_out, h.last_contacted_at,
            p.eval_overall, p.would_hire_again, p.last_job_date, p.agreed_amount_cents, p.payment_unit,
            (SELECT group_concat(hc.category_id) FROM helper_categories hc WHERE hc.helper_id = h.id) AS category_ids
       FROM helpers h LEFT JOIN helper_private p ON p.helper_id = h.id AND p.owner_id = h.owner_id
      WHERE ${where.join(' AND ')} ORDER BY h.favorite DESC, h.full_name COLLATE NOCASE LIMIT ? OFFSET ?`,
  ).bind(...args, limit, offset).all<any>();
  return c.json({ helpers: rows.results.map((r) => ({ ...r, category_ids: r.category_ids ? r.category_ids.split(',') : [] })) });
});

helperRoutes.get('/recent', async (c) => {
  const kind = c.req.query('kind') === 'hired' ? 'hired' : 'contacted';
  const owner = uid(c as any);
  const sql = kind === 'contacted'
    ? `SELECT id, full_name, city, state, function_title, last_contacted_at AS at FROM helpers WHERE owner_id = ? AND last_contacted_at IS NOT NULL AND archived_at IS NULL ORDER BY last_contacted_at DESC LIMIT 20`
    : `SELECT h.id, h.full_name, h.city, h.state, h.function_title, MAX(wa.start_date) AS at FROM helpers h JOIN work_assignments wa ON wa.helper_id = h.id AND wa.owner_id = h.owner_id
        WHERE h.owner_id = ? AND wa.status <> 'canceled' GROUP BY h.id ORDER BY at DESC LIMIT 20`;
  return c.json({ helpers: (await c.env.DB.prepare(sql).bind(owner).all()).results });
});

helperRoutes.get('/:id', async (c) => {
  const h = await ownedHelper(c as any, c.req.param('id'));
  const owner = uid(c as any);
  const cats = await c.env.DB.prepare(
    `SELECT sc.id, sc.name_en, sc.name_pt, sc.name_es, sc.licensed_trade FROM helper_categories hc JOIN service_categories sc ON sc.id = hc.category_id
      WHERE hc.helper_id = ? AND hc.owner_id = ?`).bind(h.id, owner).all<any>();
  const priv = await c.env.DB.prepare('SELECT * FROM helper_private WHERE helper_id = ? AND owner_id = ?').bind(h.id, owner).first();
  return c.json({
    ...h, categories: cats.results, private: priv,
    // Never imply a helper may perform licensed work: surface the notice for regulated trades.
    licensed_trade_notice: cats.results.some((x) => x.licensed_trade === 1),
  });
});

const patchSchema = helperSchema.partial().extend({ category_ids: z.array(catId).min(1).max(12).optional() });
helperRoutes.patch('/:id', async (c) => {
  const h = await ownedHelper(c as any, c.req.param('id'));
  const b = await parseBody(c as any, patchSchema);
  const owner = uid(c as any); const db = c.env.DB; const now = nowIso(c as any);
  const sets: string[] = []; const vals: unknown[] = [];
  const map: Record<string, string> = { whatsapp: 'whatsapp_e164' };
  for (const [k, v] of Object.entries(b)) {
    if (['category_ids', 'main_category_id', 'messaging_consent'].includes(k) || v === undefined) continue;
    sets.push(`${map[k] ?? k} = ?`); vals.push(v);
  }
  const stmts: D1PreparedStatement[] = [];
  if (b.category_ids) {
    const cats = await validCategories(c as any, b.category_ids);
    const main = b.main_category_id ?? (cats.includes(h.main_category_id) ? h.main_category_id : cats[0]);
    if (!cats.includes(main)) throw new HttpError(400, 'validation_error', { issues: [{ path: 'main_category_id', code: 'invalid_category' }] });
    sets.push('main_category_id = ?'); vals.push(main);
    stmts.push(db.prepare('DELETE FROM helper_categories WHERE helper_id = ? AND owner_id = ?').bind(h.id, owner));
    for (const cid of cats) stmts.push(db.prepare('INSERT INTO helper_categories (helper_id, owner_id, category_id) VALUES (?,?,?)').bind(h.id, owner, cid));
  }
  if (b.messaging_consent !== undefined) {
    sets.push('messaging_consent = ?'); vals.push(b.messaging_consent ? 'granted' : 'revoked');
    stmts.push(db.prepare('INSERT INTO consent_records (id, owner_id, helper_id, kind, status, source, created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(newId(), owner, h.id, 'messaging', b.messaging_consent ? 'granted' : 'revoked', 'contractor_attested', now));
  }
  if (sets.length) stmts.unshift(db.prepare(`UPDATE helpers SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND owner_id = ?`).bind(...vals, now, h.id, owner));
  if (stmts.length) await db.batch(stmts);
  return c.json({ ok: true });
});

helperRoutes.post('/:id/favorite', async (c) => {
  const h = await ownedHelper(c as any, c.req.param('id'));
  const { favorite } = await parseBody(c as any, z.object({ favorite: z.boolean() }));
  await c.env.DB.prepare('UPDATE helpers SET favorite = ?, updated_at = ? WHERE id = ? AND owner_id = ?').bind(favorite ? 1 : 0, nowIso(c as any), h.id, uid(c as any)).run();
  return c.json({ ok: true, favorite });
});

helperRoutes.post('/:id/archive', async (c) => {
  const h = await ownedHelper(c as any, c.req.param('id'));
  const { archived } = await parseBody(c as any, z.object({ archived: z.boolean() }));
  const now = nowIso(c as any);
  await c.env.DB.prepare('UPDATE helpers SET archived_at = ?, updated_at = ? WHERE id = ? AND owner_id = ?').bind(archived ? now : null, now, h.id, uid(c as any)).run();
  return c.json({ ok: true, archived });
});

helperRoutes.delete('/:id', async (c) => {
  const h = await ownedHelper(c as any, c.req.param('id'));
  const owner = uid(c as any); const db = c.env.DB;
  const hist = await db.prepare(
    `SELECT (SELECT COUNT(*) FROM work_assignments WHERE helper_id = ? AND owner_id = ?) AS a,
            (SELECT COUNT(*) FROM helper_payments WHERE helper_id = ? AND owner_id = ?) AS p`).bind(h.id, owner, h.id, owner).first<{ a: number; p: number }>();
  if (hist && (hist.a > 0 || hist.p > 0)) throw new HttpError(409, 'has_history'); // financial history must not vanish: archive instead
  if (c.env.ATTACHMENTS) {
    const atts = await db.prepare('SELECT a.storage_key FROM message_attachments a JOIN messages m ON m.id = a.message_id JOIN conversations cv ON cv.id = m.conversation_id WHERE cv.helper_id = ? AND cv.owner_id = ?').bind(h.id, owner).all<{ storage_key: string }>();
    for (const a of atts.results) await c.env.ATTACHMENTS.delete(a.storage_key);
  }
  await db.batch([
    db.prepare('DELETE FROM helpers WHERE id = ? AND owner_id = ?').bind(h.id, owner),
    audit(c as any, 'data', 'helper_deleted', 'helpers', h.id),
  ]);
  return c.json({ ok: true });
});

// ───── private section ─────
const privateSchema = z.object({
  agreed_amount: moneyStr.nullable().optional(),
  payment_unit: z.enum(['hour', 'day', 'job', 'other']).nullable().optional(),
  last_job: optText(300), last_job_location: optText(300),
  last_job_date: dateStr.nullable().optional(),
  notes: optText(4000),
  eval_quality: z.number().int().min(1).max(5).nullable().optional(),
  eval_punctuality: z.number().int().min(1).max(5).nullable().optional(),
  eval_reliability: z.number().int().min(1).max(5).nullable().optional(),
  eval_communication: z.number().int().min(1).max(5).nullable().optional(),
  eval_overall: z.number().int().min(1).max(5).nullable().optional(),
  would_hire_again: z.boolean().nullable().optional(),
});
helperRoutes.get('/:id/private', async (c) => {
  const h = await ownedHelper(c as any, c.req.param('id'));
  return c.json(await c.env.DB.prepare('SELECT * FROM helper_private WHERE helper_id = ? AND owner_id = ?').bind(h.id, uid(c as any)).first());
});
helperRoutes.put('/:id/private', async (c) => {
  const h = await ownedHelper(c as any, c.req.param('id'));
  const b = await parseBody(c as any, privateSchema);
  const cur = await c.env.DB.prepare('SELECT * FROM helper_private WHERE helper_id = ? AND owner_id = ?').bind(h.id, uid(c as any)).first<any>();
  const pick = <T>(nv: T | undefined, ov: T) => (nv === undefined ? ov : nv);
  await c.env.DB.prepare(
    `UPDATE helper_private SET agreed_amount_cents = ?, payment_unit = ?, last_job = ?, last_job_location = ?, last_job_date = ?, notes = ?,
       eval_quality = ?, eval_punctuality = ?, eval_reliability = ?, eval_communication = ?, eval_overall = ?, would_hire_again = ?, updated_at = ?
     WHERE helper_id = ? AND owner_id = ?`,
  ).bind(
    pick(b.agreed_amount, cur.agreed_amount_cents), pick(b.payment_unit, cur.payment_unit), pick(b.last_job, cur.last_job),
    pick(b.last_job_location, cur.last_job_location), pick(b.last_job_date, cur.last_job_date), pick(b.notes, cur.notes),
    pick(b.eval_quality, cur.eval_quality), pick(b.eval_punctuality, cur.eval_punctuality), pick(b.eval_reliability, cur.eval_reliability),
    pick(b.eval_communication, cur.eval_communication), pick(b.eval_overall, cur.eval_overall),
    b.would_hire_again === undefined ? cur.would_hire_again : b.would_hire_again === null ? null : b.would_hire_again ? 1 : 0,
    nowIso(c as any), h.id, uid(c as any),
  ).run();
  return c.json({ ok: true });
});

// ───── history ─────
helperRoutes.get('/:id/history', async (c) => {
  const h = await ownedHelper(c as any, c.req.param('id'));
  const owner = uid(c as any); const db = c.env.DB;
  const manual = await db.prepare('SELECT * FROM helper_job_history WHERE helper_id = ? AND owner_id = ? ORDER BY job_date DESC').bind(h.id, owner).all();
  const jobs = await db.prepare(
    `SELECT wa.id, wa.job_name, wa.location, wa.city, wa.state, wa.start_date, wa.end_date, wa.default_daily_rate_cents, wa.currency, wa.status,
            (SELECT COUNT(*) FROM workdays w WHERE w.assignment_id = wa.id AND w.status = 'completed') AS completed_days,
            (SELECT COUNT(*) FROM workdays w WHERE w.assignment_id = wa.id AND w.status = 'absent') AS absent_days,
            (SELECT COUNT(*) FROM workdays w WHERE w.assignment_id = wa.id AND w.status IN ('scheduled','confirmed')) AS upcoming_days
       FROM work_assignments wa WHERE wa.helper_id = ? AND wa.owner_id = ? ORDER BY wa.start_date DESC`).bind(h.id, owner).all();
  return c.json({ manual: manual.results, assignments: jobs.results });
});
helperRoutes.post('/:id/history', async (c) => {
  const h = await ownedHelper(c as any, c.req.param('id'));
  const b = await parseBody(c as any, z.object({ job_name: shortText(1, 200), location: optText(300), job_date: dateStr.optional().nullable(), amount: moneyStr.optional().nullable(), currency: currencyCode.default('USD'), notes: optText(1000) }));
  const id = newId();
  await c.env.DB.prepare('INSERT INTO helper_job_history (id, owner_id, helper_id, job_name, location, job_date, amount_cents, currency, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(id, uid(c as any), h.id, b.job_name, b.location ?? null, b.job_date ?? null, b.amount ?? null, b.currency, b.notes ?? null, nowIso(c as any)).run();
  return c.json({ id }, 201);
});

// ───── WhatsApp (deep link only) ─────
helperRoutes.get('/:id/whatsapp', async (c) => {
  const h = await ownedHelper(c as any, c.req.param('id'));
  const text = c.req.query('text')?.slice(0, 1000);
  return c.json({ link: whatsappLink(h.whatsapp_e164, text), e164: h.whatsapp_e164, note: 'wa.me link; the message is sent by the user in WhatsApp, not by this app' });
});
helperRoutes.post('/:id/contacted', async (c) => {
  const h = await ownedHelper(c as any, c.req.param('id'));
  await c.env.DB.prepare('UPDATE helpers SET last_contacted_at = ? WHERE id = ? AND owner_id = ?').bind(nowIso(c as any), h.id, uid(c as any)).run();
  return c.json({ ok: true });
});

// ───── invitation (optional helper access to their own private thread) ─────
helperRoutes.post('/:id/invite', async (c) => {
  const h = await ownedHelper(c as any, c.req.param('id'));
  const owner = uid(c as any); const now = c.get('now'); const token = randomToken(24);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE invitations SET revoked_at = ? WHERE helper_id = ? AND owner_id = ? AND revoked_at IS NULL').bind(iso(now), h.id, owner),
    c.env.DB.prepare('INSERT INTO invitations (id, owner_id, helper_id, token_hash, expires_at, created_at) VALUES (?,?,?,?,?,?)')
      .bind(newId(), owner, h.id, await sha256Hex(token), iso(new Date(now.getTime() + 30 * 86_400_000)), iso(now)),
    audit(c as any, 'data', 'helper_invited', 'helpers', h.id),
  ]);
  const origin = c.env.APP_ORIGIN ?? new URL(c.req.url).origin;
  const link = `${origin}/h/${token}`; // shown once; only the hash is stored
  return c.json({ link, whatsapp_link: whatsappLink(h.whatsapp_e164, link), expires_in_days: 30 }, 201);
});
export { parseWith, auditStmt };
