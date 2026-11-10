import { Hono } from 'hono';
import { z } from 'zod';
import { allocate } from '../../shared/money';
import { addDays, addMonths, addYears, PERIOD_KINDS, previousPeriod, resolvePeriod, type Period, type PeriodKind } from '../../shared/dates';
import {
  audit, auditStmt, currencyCode, dateStr, HttpError, mapDbError, moneyStr, newId, notFound, nowIso, optText, parseBody, payMethod,
  shortText, todayOf, uid, type Ctx, type Env, type Vars,
} from '../core';
import { requireAuth } from './auth';
import { buildCashFlow, buildDre, expStatusSql, monthlySeries, recvStatusSql, type Basis } from '../services/finance';
import { helperPayables } from '../services/labor';

export const financeRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();
financeRoutes.use('*', requireAuth);

const REVENUE_CLASSES = ['revenue_services', 'revenue_other', 'financial_income'] as const;
const EXPENSE_CLASSES = ['deduction', 'direct_cost', 'operating', 'financial_expense', 'other_expense'] as const;

export function periodFromQuery(c: Ctx): Period {
  const q = c.req.query();
  const kind = (q.period ?? 'this_month') as PeriodKind;
  if (!PERIOD_KINDS.includes(kind)) throw new HttpError(400, 'invalid_period');
  try { return resolvePeriod(kind, todayOf(c), { from: q.from, to: q.to }); } catch { throw new HttpError(400, 'invalid_period'); }
}

// ───────────────────────── Categories ─────────────────────────
financeRoutes.get('/categories', async (c) => {
  const rows = await c.env.DB.prepare('SELECT id, kind, name, dre_class, active FROM financial_categories WHERE owner_id = ? ORDER BY kind, name').bind(uid(c as any)).all();
  return c.json({ categories: rows.results });
});
const catSchema = z.object({ kind: z.enum(['revenue', 'expense']), name: shortText(2, 80), dre_class: z.enum([...REVENUE_CLASSES, ...EXPENSE_CLASSES]), active: z.boolean().optional() })
  .refine((v) => (v.kind === 'revenue' ? (REVENUE_CLASSES as readonly string[]).includes(v.dre_class) : (EXPENSE_CLASSES as readonly string[]).includes(v.dre_class)), { message: 'class_kind_mismatch', path: ['dre_class'] });
financeRoutes.post('/categories', async (c) => {
  const b = await parseBody(c as any, catSchema); const id = newId();
  try { await c.env.DB.prepare('INSERT INTO financial_categories (id, owner_id, kind, name, dre_class) VALUES (?,?,?,?,?)').bind(id, uid(c as any), b.kind, b.name, b.dre_class).run(); }
  catch (e) { if (String((e as Error).message).includes('UNIQUE')) throw new HttpError(409, 'category_exists'); throw e; }
  return c.json({ id }, 201);
});
financeRoutes.patch('/categories/:id', async (c) => {
  const b = await parseBody(c as any, z.object({ name: shortText(2, 80).optional(), dre_class: z.enum([...REVENUE_CLASSES, ...EXPENSE_CLASSES]).optional(), active: z.boolean().optional() }));
  const cur = await c.env.DB.prepare('SELECT * FROM financial_categories WHERE id = ? AND owner_id = ?').bind(c.req.param('id'), uid(c as any)).first<any>();
  if (!cur) throw notFound();
  if (b.dre_class && !(cur.kind === 'revenue' ? (REVENUE_CLASSES as readonly string[]) : (EXPENSE_CLASSES as readonly string[])).includes(b.dre_class)) throw new HttpError(400, 'class_kind_mismatch');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE financial_categories SET name = ?, dre_class = ?, active = ? WHERE id = ? AND owner_id = ?')
      .bind(b.name ?? cur.name, b.dre_class ?? cur.dre_class, b.active === undefined ? cur.active : b.active ? 1 : 0, cur.id, cur.owner_id),
    audit(c as any, 'financial', 'category_changed', 'financial_categories', cur.id, { before: { name: cur.name, dre_class: cur.dre_class }, after: b }),
  ]);
  return c.json({ ok: true });
});

async function checkCategory(c: Ctx, id: string, kind: 'revenue' | 'expense') {
  const r = await c.env.DB.prepare('SELECT id FROM financial_categories WHERE id = ? AND owner_id = ? AND kind = ? AND active = 1').bind(id, uid(c), kind).first();
  if (!r) throw new HttpError(400, 'validation_error', { issues: [{ path: 'category_id', code: 'invalid_category' }] });
}
async function checkProject(c: Ctx, id?: string | null) {
  if (!id) return;
  if (!(await c.env.DB.prepare('SELECT id FROM projects WHERE id = ? AND owner_id = ?').bind(id, uid(c)).first())) throw new HttpError(400, 'validation_error', { issues: [{ path: 'project_id', code: 'invalid_project' }] });
}

const positive = moneyStr.refine((n) => n > 0, 'amount_must_be_positive');
const installments = z.object({ count: z.number().int().min(2).max(60), every: z.enum(['week', 'month']).default('month'), first_due: dateStr });
const stepDate = (d: string, every: string, i: number) => (every === 'week' ? addDays(d, 7 * i) : every === 'month' ? addMonths(d, i) : addYears(d, i));

// ───────────────────────── Receivables / revenue ─────────────────────────
const recvSchema = z.object({
  customer: shortText(1, 160), description: shortText(1, 300), project_id: z.string().uuid().nullish(), category_id: z.string().uuid(),
  amount: positive, currency: currencyCode.optional(), issue_date: dateStr, recognition_date: dateStr.optional(),
  due_date: dateStr.nullish(), expected_date: dateStr.nullish(), status: z.enum(['draft', 'open']).default('open'), notes: optText(1000),
  installments: installments.optional(),
  received_now: z.object({ date: dateStr, method: payMethod }).optional(),
});
financeRoutes.post('/receivables', async (c) => {
  const b = await parseBody(c as any, recvSchema);
  await checkCategory(c as any, b.category_id, 'revenue'); await checkProject(c as any, b.project_id);
  if (b.installments && b.received_now) throw new HttpError(400, 'validation_error', { issues: [{ path: 'received_now', code: 'not_with_installments' }] });
  const owner = uid(c as any); const now = nowIso(c as any); const db = c.env.DB; const cur = b.currency ?? c.get('user').profile.currency;
  const n = b.installments?.count ?? 1; const parts = allocate(b.amount, n); const group = b.installments ? newId() : null;
  const ids: string[] = []; const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < n; i++) {
    const id = newId(); ids.push(id);
    const due = b.installments ? stepDate(b.installments.first_due, b.installments.every, i) : b.due_date ?? null;
    stmts.push(db.prepare(`INSERT INTO receivables (id, owner_id, customer, description, project_id, category_id, original_cents, currency, issue_date, recognition_date, due_date, expected_date, status, installment_group, installment_no, notes, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, owner, b.customer, n > 1 ? `${b.description} (${i + 1}/${n})` : b.description, b.project_id ?? null, b.category_id,
      parts[i], cur, b.issue_date, b.recognition_date ?? b.issue_date, due, b.expected_date ?? null, b.status, group, n > 1 ? i + 1 : null, b.notes ?? null, now, now));
  }
  if (b.received_now && b.status === 'open') {
    stmts.push(db.prepare('INSERT INTO receipts (id, owner_id, receivable_id, amount_cents, currency, received_date, method, created_at) VALUES (?,?,?,?,?,?,?,?)').bind(newId(), owner, ids[0], b.amount, cur, b.received_now.date, b.received_now.method, now));
    stmts.push(db.prepare('UPDATE receivables SET received_cents = original_cents WHERE id = ? AND owner_id = ?').bind(ids[0], owner));
  }
  stmts.push(audit(c as any, 'financial', 'receivable_created', 'receivables', ids[0], { count: n, amount_cents: b.amount }));
  try { await db.batch(stmts); } catch (e) { mapDbError(e); }
  return c.json({ ids }, 201);
});

financeRoutes.get('/receivables', async (c) => {
  const q = c.req.query(); const today = todayOf(c as any);
  const w = ['r.owner_id = ?']; const a: unknown[] = [uid(c as any)];
  if (q.customer) { w.push("r.customer LIKE ? ESCAPE '\\'"); a.push(`%${q.customer.replace(/[\\%_]/g, (m) => '\\' + m)}%`); }
  if (q.project_id) { w.push('r.project_id = ?'); a.push(q.project_id); }
  if (q.from) { w.push('r.issue_date >= ?'); a.push(q.from); }
  if (q.to) { w.push('r.issue_date <= ?'); a.push(q.to); }
  if (q.due_from) { w.push('r.due_date >= ?'); a.push(q.due_from); }
  if (q.due_to) { w.push('r.due_date <= ?'); a.push(q.due_to); }
  const status = recvStatusSql('r');
  if (q.status) { w.push(`(${status}) = ?`); a.push(today, q.status); }
  const rows = await c.env.DB.prepare(
    `SELECT r.*, (${status}) AS display_status, r.original_cents - r.received_cents AS outstanding_cents, p.name AS project_name, fc.name AS category_name
       FROM receivables r LEFT JOIN projects p ON p.id = r.project_id AND p.owner_id = r.owner_id LEFT JOIN financial_categories fc ON fc.id = r.category_id
      WHERE ${w.join(' AND ')} ORDER BY COALESCE(r.due_date, r.issue_date) DESC LIMIT 500`).bind(today, ...a.slice(0, a.length - (q.status ? 2 : 0)), ...(q.status ? [today, q.status] : [])).all();
  return c.json({ receivables: rows.results });
});

financeRoutes.get('/receivables/summary', async (c) => {
  const today = todayOf(c as any); const owner = uid(c as any); const cur = c.get('user').profile.currency; const db = c.env.DB;
  const base = "FROM receivables r WHERE r.owner_id = ? AND r.currency = ? AND r.status = 'open' AND r.original_cents > r.received_cents";
  const one = async (extra: string, ...a: unknown[]) => (await db.prepare(`SELECT COALESCE(SUM(r.original_cents - r.received_cents),0) AS t, COUNT(*) AS n ${base} ${extra}`).bind(owner, cur, ...a).first<{ t: number; n: number }>())!;
  const byCustomer = await db.prepare(`SELECT r.customer AS name, SUM(r.original_cents - r.received_cents) AS outstanding_cents ${base} GROUP BY r.customer ORDER BY outstanding_cents DESC LIMIT 50`).bind(owner, cur).all();
  const byProject = await db.prepare(`SELECT COALESCE(p.name, '-') AS name, SUM(r.original_cents - r.received_cents) AS outstanding_cents ${base.replace('FROM receivables r', 'FROM receivables r LEFT JOIN projects p ON p.id = r.project_id AND p.owner_id = r.owner_id')} GROUP BY p.id ORDER BY outstanding_cents DESC LIMIT 50`).bind(owner, cur).all();
  const total = await one(''); const overdue = await one('AND r.due_date < ?', today);
  const upcoming = await one('AND r.due_date BETWEEN ? AND ?', today, addDays(today, 30));
  return c.json({ currency: cur, today, total_outstanding_cents: total.t, overdue_cents: overdue.t, overdue_count: overdue.n, due_next_30_days_cents: upcoming.t, by_customer: byCustomer.results, by_project: byProject.results });
});

async function ownedRecv(c: Ctx, id: string) {
  const r = await c.env.DB.prepare('SELECT * FROM receivables WHERE id = ? AND owner_id = ?').bind(id, uid(c)).first<any>();
  if (!r) throw notFound();
  return r;
}
financeRoutes.get('/receivables/:id', async (c) => {
  const r = await ownedRecv(c as any, c.req.param('id'));
  const receipts = await c.env.DB.prepare('SELECT * FROM receipts WHERE receivable_id = ? AND owner_id = ? ORDER BY received_date, created_at').bind(r.id, r.owner_id).all();
  return c.json({ ...r, outstanding_cents: r.original_cents - r.received_cents, receipts: receipts.results });
});
financeRoutes.patch('/receivables/:id', async (c) => {
  const r = await ownedRecv(c as any, c.req.param('id'));
  const b = await parseBody(c as any, z.object({
    customer: shortText(1, 160).optional(), description: shortText(1, 300).optional(), project_id: z.string().uuid().nullish(), category_id: z.string().uuid().optional(),
    amount: positive.optional(), due_date: dateStr.nullish(), expected_date: dateStr.nullish(), recognition_date: dateStr.optional(), notes: optText(1000), status: z.literal('open').optional(),
  }));
  if (['canceled', 'written_off'].includes(r.status)) throw new HttpError(409, 'record_closed');
  if (b.category_id) await checkCategory(c as any, b.category_id, 'revenue');
  if (b.project_id) await checkProject(c as any, b.project_id);
  if (b.amount !== undefined && b.amount < r.received_cents) throw new HttpError(409, 'below_received');
  const sets: string[] = []; const vals: unknown[] = []; const map: Record<string, string> = { amount: 'original_cents' };
  for (const [k, v] of Object.entries(b)) if (v !== undefined) { sets.push(`${map[k] ?? k} = ?`); vals.push(v); }
  if (!sets.length) return c.json({ ok: true });
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE receivables SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND owner_id = ?`).bind(...vals, nowIso(c as any), r.id, r.owner_id),
      audit(c as any, 'financial', 'receivable_edited', 'receivables', r.id, { before: { original_cents: r.original_cents, due_date: r.due_date, recognition_date: r.recognition_date, status: r.status }, after: b }),
    ]);
  } catch (e) { mapDbError(e); }
  return c.json({ ok: true });
});
financeRoutes.delete('/receivables/:id', async (c) => {
  const r = await ownedRecv(c as any, c.req.param('id'));
  const n = (await c.env.DB.prepare('SELECT COUNT(*) AS n FROM receipts WHERE receivable_id = ? AND owner_id = ?').bind(r.id, r.owner_id).first<{ n: number }>())!.n;
  if (n > 0) throw new HttpError(409, 'has_history'); // records with payments are canceled, never erased
  await c.env.DB.batch([c.env.DB.prepare('DELETE FROM receivables WHERE id = ? AND owner_id = ?').bind(r.id, r.owner_id), audit(c as any, 'financial', 'receivable_deleted', 'receivables', r.id, { snapshot: r })]);
  return c.json({ ok: true });
});
financeRoutes.post('/receivables/:id/cancel', async (c) => {
  const r = await ownedRecv(c as any, c.req.param('id'));
  if (r.received_cents > 0) throw new HttpError(409, 'has_receipts'); // void receipts first
  if (['canceled', 'written_off'].includes(r.status)) throw new HttpError(409, 'record_closed');
  await c.env.DB.batch([c.env.DB.prepare("UPDATE receivables SET status = 'canceled', updated_at = ? WHERE id = ? AND owner_id = ?").bind(nowIso(c as any), r.id, r.owner_id), audit(c as any, 'financial', 'receivable_canceled', 'receivables', r.id)]);
  return c.json({ ok: true });
});
financeRoutes.post('/receivables/:id/write-off', async (c) => {
  const { reason } = await parseBody(c as any, z.object({ reason: z.string().trim().min(5).max(300) }));
  const r = await ownedRecv(c as any, c.req.param('id')); const out = r.original_cents - r.received_cents;
  if (r.status !== 'open' || out <= 0) throw new HttpError(409, 'record_closed');
  const now = nowIso(c as any);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE receivables SET status = 'written_off', updated_at = ? WHERE id = ? AND owner_id = ?").bind(now, r.id, r.owner_id),
    c.env.DB.prepare('INSERT INTO accounting_adjustments (id, owner_id, kind, ref_id, amount_cents, currency, adjust_date, reason, actor_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(newId(), r.owner_id, 'receivable_writeoff', r.id, out, r.currency, todayOf(c as any), reason, r.owner_id, now),
    audit(c as any, 'financial', 'receivable_written_off', 'receivables', r.id, { amount_cents: out, reason }),
  ]);
  return c.json({ ok: true, written_off_cents: out });
});

// Generic settlement (receipt / expense payment) with idempotency, overpay guard and audit.
interface Cfg { parent: 'receivables' | 'expenses'; table: 'receipts' | 'expense_payments'; fk: string; total: string; paid: string; date: string; action: string }
const RECV: Cfg = { parent: 'receivables', table: 'receipts', fk: 'receivable_id', total: 'original_cents', paid: 'received_cents', date: 'received_date', action: 'receipt' };
const EXP: Cfg = { parent: 'expenses', table: 'expense_payments', fk: 'expense_id', total: 'amount_cents', paid: 'paid_cents', date: 'paid_date', action: 'expense_payment' };
const settleSchema = z.object({ amount: positive, date: dateStr, method: payMethod, notes: optText(500), idempotency_key: z.string().min(8).max(80).optional() });

async function settle(c: Ctx, cfg: Cfg, parentId: string, b: z.infer<typeof settleSchema>) {
  const owner = uid(c); const db = c.env.DB; const now = nowIso(c);
  const p = await db.prepare(`SELECT * FROM ${cfg.parent} WHERE id = ? AND owner_id = ?`).bind(parentId, owner).first<any>();
  if (!p) throw notFound();
  if (p.status !== 'open') throw new HttpError(409, 'not_collectible');
  if (b.date > todayOf(c)) throw new HttpError(400, 'future_date');
  if (b.idempotency_key) {
    const prior = await db.prepare(`SELECT id FROM ${cfg.table} WHERE owner_id = ? AND idempotency_key = ?`).bind(owner, b.idempotency_key).first<any>();
    if (prior) return { id: prior.id, duplicate: true, status: 200 };
  } else {
    const since = new Date(c.get('now').getTime() - 15_000).toISOString();
    const dup = await db.prepare(`SELECT id FROM ${cfg.table} WHERE owner_id = ? AND ${cfg.fk} = ? AND amount_cents = ? AND ${cfg.date} = ? AND method = ? AND voided_at IS NULL AND created_at >= ?`).bind(owner, parentId, b.amount, b.date, b.method, since).first();
    if (dup) throw new HttpError(409, 'duplicate_payment');
  }
  const outstanding = p[cfg.total] - p[cfg.paid];
  if (b.amount > outstanding) throw new HttpError(409, 'exceeds_outstanding', { outstanding_cents: outstanding });
  const id = newId();
  try {
    await db.batch([
      db.prepare(`INSERT INTO ${cfg.table} (id, owner_id, ${cfg.fk}, amount_cents, currency, ${cfg.date}, method, notes, idempotency_key, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .bind(id, owner, parentId, b.amount, p.currency, b.date, b.method, b.notes ?? null, b.idempotency_key ?? null, now),
      db.prepare(`UPDATE ${cfg.parent} SET ${cfg.paid} = ${cfg.paid} + ?, updated_at = ? WHERE id = ? AND owner_id = ?`).bind(b.amount, now, parentId, owner),
      audit(c, 'financial', `${cfg.action}_recorded`, cfg.table, id, { parent: parentId, amount_cents: b.amount, method: b.method }),
    ]);
  } catch (e) {
    if (b.idempotency_key && String((e as Error).message).includes('UNIQUE')) {
      const prior = await db.prepare(`SELECT id FROM ${cfg.table} WHERE owner_id = ? AND idempotency_key = ?`).bind(owner, b.idempotency_key).first<any>();
      if (prior) return { id: prior.id, duplicate: true, status: 200 };
    }
    mapDbError(e);
  }
  return { id, outstanding_after_cents: outstanding - b.amount, status: 201 };
}
async function voidSettlement(c: Ctx, cfg: Cfg, id: string, reason: string) {
  const owner = uid(c); const db = c.env.DB; const now = nowIso(c);
  const s = await db.prepare(`SELECT * FROM ${cfg.table} WHERE id = ? AND owner_id = ?`).bind(id, owner).first<any>();
  if (!s) throw notFound();
  if (s.voided_at) throw new HttpError(409, 'already_voided');
  try {
    await db.batch([
      db.prepare(`UPDATE ${cfg.table} SET voided_at = ?, void_reason = ? WHERE id = ? AND owner_id = ? AND voided_at IS NULL`).bind(now, reason, id, owner),
      db.prepare(`UPDATE ${cfg.parent} SET ${cfg.paid} = ${cfg.paid} - ?, updated_at = ? WHERE id = ? AND owner_id = ?`).bind(s.amount_cents, now, s[cfg.fk], owner),
      audit(c, 'financial', `${cfg.action}_voided`, cfg.table, id, { reason, amount_cents: s.amount_cents }),
    ]);
  } catch (e) { mapDbError(e); }
}
const voidSchema = z.object({ reason: z.string().trim().min(5).max(300) });

financeRoutes.post('/receivables/:id/receipts', async (c) => {
  const b = await parseBody(c as any, settleSchema); const r = await settle(c as any, RECV, c.req.param('id'), b);
  return c.json(r, r.status as 200 | 201);
});
financeRoutes.post('/receipts/:id/void', async (c) => { await voidSettlement(c as any, RECV, c.req.param('id'), (await parseBody(c as any, voidSchema)).reason); return c.json({ ok: true }); });

// ───────────────────────── Expenses / payables ─────────────────────────
const expSchema = z.object({
  description: shortText(1, 300), payee: optText(160), category_id: z.string().uuid(), project_id: z.string().uuid().nullish(),
  amount: positive, currency: currencyCode.optional(), expense_date: dateStr, due_date: dateStr.nullish(),
  recurrence: z.enum(['none', 'weekly', 'monthly', 'yearly']).default('none'), occurrences: z.number().int().min(2).max(60).optional(),
  installments: installments.optional(), paid_now: z.object({ date: dateStr, method: payMethod }).optional(), notes: optText(1000),
});
financeRoutes.post('/expenses', async (c) => {
  const b = await parseBody(c as any, expSchema);
  await checkCategory(c as any, b.category_id, 'expense'); await checkProject(c as any, b.project_id);
  if (b.recurrence !== 'none' && !b.occurrences) throw new HttpError(400, 'validation_error', { issues: [{ path: 'occurrences', code: 'required' }] });
  if ((b.installments || b.recurrence !== 'none') && b.paid_now) throw new HttpError(400, 'validation_error', { issues: [{ path: 'paid_now', code: 'only_single_expense' }] });
  const owner = uid(c as any); const db = c.env.DB; const now = nowIso(c as any); const cur = b.currency ?? c.get('user').profile.currency;
  const n = b.installments?.count ?? (b.recurrence !== 'none' ? b.occurrences! : 1);
  const parts = b.installments ? allocate(b.amount, n) : Array(n).fill(b.amount) as number[];
  const iGroup = b.installments ? newId() : null; const rGroup = b.recurrence !== 'none' ? newId() : null;
  const every = b.recurrence === 'weekly' ? 'week' : b.recurrence === 'monthly' ? 'month' : 'year';
  const ids: string[] = []; const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < n; i++) {
    const id = newId(); ids.push(id);
    const date = b.recurrence !== 'none' ? stepDate(b.expense_date, every, i) : b.expense_date;
    const due = b.installments ? stepDate(b.installments.first_due, b.installments.every, i) : b.recurrence !== 'none' && b.due_date ? stepDate(b.due_date, every, i) : b.due_date ?? null;
    stmts.push(db.prepare(`INSERT INTO expenses (id, owner_id, description, payee, category_id, project_id, amount_cents, currency, expense_date, due_date, recurrence, recurrence_group, installment_group, installment_no, notes, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, owner, b.installments ? `${b.description} (${i + 1}/${n})` : b.description, b.payee ?? null, b.category_id, b.project_id ?? null,
      parts[i], cur, date, due, b.recurrence, rGroup, iGroup, b.installments ? i + 1 : null, b.notes ?? null, now, now));
  }
  if (b.paid_now) {
    stmts.push(db.prepare('INSERT INTO expense_payments (id, owner_id, expense_id, amount_cents, currency, paid_date, method, created_at) VALUES (?,?,?,?,?,?,?,?)').bind(newId(), owner, ids[0], b.amount, cur, b.paid_now.date, b.paid_now.method, now));
    stmts.push(db.prepare('UPDATE expenses SET paid_cents = amount_cents WHERE id = ? AND owner_id = ?').bind(ids[0], owner));
  }
  stmts.push(audit(c as any, 'financial', 'expense_created', 'expenses', ids[0], { count: n, amount_cents: b.amount }));
  try { await db.batch(stmts); } catch (e) { mapDbError(e); }
  return c.json({ ids }, 201);
});

financeRoutes.get('/expenses', async (c) => {
  const q = c.req.query(); const today = todayOf(c as any);
  const w = ['e.owner_id = ?']; const a: unknown[] = [uid(c as any)];
  if (q.from) { w.push('e.expense_date >= ?'); a.push(q.from); }
  if (q.to) { w.push('e.expense_date <= ?'); a.push(q.to); }
  if (q.category_id) { w.push('e.category_id = ?'); a.push(q.category_id); }
  if (q.project_id) { w.push('e.project_id = ?'); a.push(q.project_id); }
  if (q.payee) { w.push("e.payee LIKE ? ESCAPE '\\'"); a.push(`%${q.payee.replace(/[\\%_]/g, (m) => '\\' + m)}%`); }
  const status = expStatusSql('e'); const tail: unknown[] = [];
  if (q.status) { w.push(`(${status}) = ?`); tail.push(today, q.status); }
  const rows = await c.env.DB.prepare(
    `SELECT e.*, (${status}) AS display_status, e.amount_cents - e.paid_cents AS outstanding_cents, fc.name AS category_name, p.name AS project_name
       FROM expenses e JOIN financial_categories fc ON fc.id = e.category_id AND fc.owner_id = e.owner_id LEFT JOIN projects p ON p.id = e.project_id AND p.owner_id = e.owner_id
      WHERE ${w.join(' AND ')} ORDER BY e.expense_date DESC, e.created_at DESC LIMIT 500`).bind(today, ...a, ...tail).all();
  return c.json({ expenses: rows.results });
});

/** Accounts payable view: open expense bills + per-helper payables from completed workdays (kept separate, never double counted). */
financeRoutes.get('/payables/summary', async (c) => {
  const today = todayOf(c as any); const owner = uid(c as any); const cur = c.get('user').profile.currency; const db = c.env.DB;
  const base = "FROM expenses e WHERE e.owner_id = ? AND e.currency = ? AND e.status = 'open' AND e.amount_cents > e.paid_cents";
  const one = async (extra: string, ...a: unknown[]) => (await db.prepare(`SELECT COALESCE(SUM(e.amount_cents - e.paid_cents),0) AS t, COUNT(*) AS n ${base} ${extra}`).bind(owner, cur, ...a).first<{ t: number; n: number }>())!;
  const weekEnd = addDays(today, 6 - new Date(`${today}T00:00:00Z`).getUTCDay()); const monthEnd = addDays(addMonths(`${today.slice(0, 7)}-01`, 1), -1);
  const byPayee = await db.prepare(`SELECT COALESCE(e.payee,'-') AS name, SUM(e.amount_cents - e.paid_cents) AS outstanding_cents ${base} GROUP BY e.payee ORDER BY outstanding_cents DESC LIMIT 50`).bind(owner, cur).all();
  const byProject = await db.prepare(`SELECT COALESCE(p.name,'-') AS name, SUM(e.amount_cents - e.paid_cents) AS outstanding_cents ${base.replace('FROM expenses e', 'FROM expenses e LEFT JOIN projects p ON p.id = e.project_id AND p.owner_id = e.owner_id')} GROUP BY p.id ORDER BY outstanding_cents DESC LIMIT 50`).bind(owner, cur).all();
  const total = await one(''); const overdue = await one('AND e.due_date < ?', today); const dueToday = await one('AND e.due_date = ?', today);
  const dueWeek = await one('AND e.due_date BETWEEN ? AND ?', today, weekEnd); const dueMonth = await one('AND e.due_date BETWEEN ? AND ?', today, monthEnd);
  const helpers = (await helperPayables(db, owner, cur)).filter((h) => h.outstanding_cents > 0);
  return c.json({
    currency: cur, today, total_payable_cents: total.t, overdue_cents: overdue.t, overdue_count: overdue.n, due_today_cents: dueToday.t, due_this_week_cents: dueWeek.t, due_this_month_cents: dueMonth.t,
    by_payee: byPayee.results, by_project: byProject.results,
    helper_payables: helpers, helper_payable_total_cents: helpers.reduce((s, h) => s + h.outstanding_cents, 0),
  });
});

async function ownedExp(c: Ctx, id: string) {
  const r = await c.env.DB.prepare('SELECT * FROM expenses WHERE id = ? AND owner_id = ?').bind(id, uid(c)).first<any>();
  if (!r) throw notFound();
  return r;
}
financeRoutes.get('/expenses/:id', async (c) => {
  const e = await ownedExp(c as any, c.req.param('id'));
  const pays = await c.env.DB.prepare('SELECT * FROM expense_payments WHERE expense_id = ? AND owner_id = ? ORDER BY paid_date, created_at').bind(e.id, e.owner_id).all();
  return c.json({ ...e, outstanding_cents: e.amount_cents - e.paid_cents, payments: pays.results });
});
financeRoutes.patch('/expenses/:id', async (c) => {
  const e = await ownedExp(c as any, c.req.param('id'));
  const b = await parseBody(c as any, z.object({ description: shortText(1, 300).optional(), payee: optText(160), category_id: z.string().uuid().optional(), project_id: z.string().uuid().nullish(),
    amount: positive.optional(), expense_date: dateStr.optional(), due_date: dateStr.nullish(), notes: optText(1000) }));
  if (e.status !== 'open') throw new HttpError(409, 'record_closed');
  if (b.category_id) await checkCategory(c as any, b.category_id, 'expense');
  if (b.project_id) await checkProject(c as any, b.project_id);
  if (b.amount !== undefined && b.amount < e.paid_cents) throw new HttpError(409, 'below_received');
  const sets: string[] = []; const vals: unknown[] = []; const map: Record<string, string> = { amount: 'amount_cents' };
  for (const [k, v] of Object.entries(b)) if (v !== undefined) { sets.push(`${map[k] ?? k} = ?`); vals.push(v); }
  if (!sets.length) return c.json({ ok: true });
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE expenses SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND owner_id = ?`).bind(...vals, nowIso(c as any), e.id, e.owner_id),
      audit(c as any, 'financial', 'expense_edited', 'expenses', e.id, { before: { amount_cents: e.amount_cents, expense_date: e.expense_date, due_date: e.due_date, category_id: e.category_id }, after: b }),
    ]);
  } catch (err) { mapDbError(err); }
  return c.json({ ok: true });
});
financeRoutes.delete('/expenses/:id', async (c) => {
  const e = await ownedExp(c as any, c.req.param('id'));
  const n = (await c.env.DB.prepare('SELECT COUNT(*) AS n FROM expense_payments WHERE expense_id = ? AND owner_id = ?').bind(e.id, e.owner_id).first<{ n: number }>())!.n;
  if (n > 0) throw new HttpError(409, 'has_history');
  await c.env.DB.batch([c.env.DB.prepare('DELETE FROM expenses WHERE id = ? AND owner_id = ?').bind(e.id, e.owner_id), audit(c as any, 'financial', 'expense_deleted', 'expenses', e.id, { snapshot: e })]);
  return c.json({ ok: true });
});
financeRoutes.post('/expenses/:id/cancel', async (c) => {
  const e = await ownedExp(c as any, c.req.param('id'));
  if (e.paid_cents > 0) throw new HttpError(409, 'has_receipts');
  if (e.status !== 'open') throw new HttpError(409, 'record_closed');
  await c.env.DB.batch([c.env.DB.prepare("UPDATE expenses SET status = 'canceled', updated_at = ? WHERE id = ? AND owner_id = ?").bind(nowIso(c as any), e.id, e.owner_id), audit(c as any, 'financial', 'expense_canceled', 'expenses', e.id)]);
  return c.json({ ok: true });
});
/** Forgive the remaining balance of a bill. The original expense stays recognized (accrual); only the unpaid balance stops being owed. */
financeRoutes.post('/expenses/:id/write-off', async (c) => {
  const { reason } = await parseBody(c as any, voidSchema);
  const e = await ownedExp(c as any, c.req.param('id'));
  if (e.status !== 'open' || e.amount_cents - e.paid_cents <= 0) throw new HttpError(409, 'record_closed');
  await c.env.DB.batch([c.env.DB.prepare("UPDATE expenses SET status = 'written_off', updated_at = ? WHERE id = ? AND owner_id = ?").bind(nowIso(c as any), e.id, e.owner_id),
    audit(c as any, 'financial', 'expense_written_off', 'expenses', e.id, { reason, amount_cents: e.amount_cents - e.paid_cents })]);
  return c.json({ ok: true });
});
financeRoutes.post('/expenses/:id/payments', async (c) => { const b = await parseBody(c as any, settleSchema); const r = await settle(c as any, EXP, c.req.param('id'), b); return c.json(r, r.status as 200 | 201); });
financeRoutes.post('/expense-payments/:id/void', async (c) => { await voidSettlement(c as any, EXP, c.req.param('id'), (await parseBody(c as any, voidSchema)).reason); return c.json({ ok: true }); });

// ───────────────────────── Cash movements (investing / financing) ─────────────────────────
financeRoutes.post('/cash-movements', async (c) => {
  const b = await parseBody(c as any, z.object({ kind: z.enum(['investing', 'financing']), direction: z.enum(['in', 'out']), amount: positive, move_date: dateStr, description: shortText(1, 200), currency: currencyCode.optional() }));
  const id = newId();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO cash_movements (id, owner_id, kind, direction, amount_cents, currency, move_date, description, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(id, uid(c as any), b.kind, b.direction, b.amount, b.currency ?? c.get('user').profile.currency, b.move_date, b.description, nowIso(c as any)),
    audit(c as any, 'financial', 'cash_movement_recorded', 'cash_movements', id, { amount_cents: b.amount, kind: b.kind, direction: b.direction }),
  ]);
  return c.json({ id }, 201);
});
financeRoutes.get('/cash-movements', async (c) => c.json({ movements: (await c.env.DB.prepare('SELECT * FROM cash_movements WHERE owner_id = ? AND voided_at IS NULL ORDER BY move_date DESC LIMIT 200').bind(uid(c as any)).all()).results }));
financeRoutes.post('/cash-movements/:id/void', async (c) => {
  const r = await c.env.DB.prepare('UPDATE cash_movements SET voided_at = ? WHERE id = ? AND owner_id = ? AND voided_at IS NULL').bind(nowIso(c as any), c.req.param('id'), uid(c as any)).run();
  if (!r.meta.changes) throw notFound();
  await audit(c as any, 'financial', 'cash_movement_voided', 'cash_movements', c.req.param('id')).run();
  return c.json({ ok: true });
});

// ───────────────────────── DRE / Cash flow / Dashboard ─────────────────────────
function basisFromQuery(c: Ctx): Basis {
  const b = c.req.query('basis');
  if (b === undefined) return c.get('user').profile.accounting_basis;
  if (b !== 'accrual' && b !== 'cash') throw new HttpError(400, 'invalid_basis');
  return b;
}

financeRoutes.get('/dre', async (c) => {
  const p = periodFromQuery(c as any); const basis = basisFromQuery(c as any); const owner = uid(c as any); const cur = c.get('user').profile.currency;
  const current = await buildDre(c.env.DB, owner, cur, basis, p.from, p.to);
  let compare = null;
  const cmp = c.req.query('compare');
  if (cmp === 'previous') { const pp = previousPeriod(p); compare = await buildDre(c.env.DB, owner, cur, basis, pp.from, pp.to); }
  else if (cmp === 'custom') {
    const f = c.req.query('compare_from'); const t = c.req.query('compare_to');
    try { const cp = resolvePeriod('custom', todayOf(c as any), { from: f, to: t }); compare = await buildDre(c.env.DB, owner, cur, basis, cp.from, cp.to); } catch { throw new HttpError(400, 'invalid_period'); }
  }
  return c.json({ ...current, compare });
});

financeRoutes.get('/cashflow', async (c) => {
  const p = periodFromQuery(c as any); const u = c.get('user').profile;
  return c.json(await buildCashFlow(c.env.DB, uid(c as any), { currency: u.currency, opening_cash_cents: u.opening_cash_cents, opening_cash_date: u.opening_cash_date }, p.from, p.to));
});

financeRoutes.get('/dashboard', async (c) => {
  const p = periodFromQuery(c as any); const u = c.get('user').profile; const owner = uid(c as any); const db = c.env.DB; const today = todayOf(c as any);
  const basis = basisFromQuery(c as any); const prev = previousPeriod(p);
  const [dre, dreAccrual, dreCash, drePrev, cash, series] = await Promise.all([
    buildDre(db, owner, u.currency, basis, p.from, p.to),
    buildDre(db, owner, u.currency, 'accrual', p.from, p.to),
    buildDre(db, owner, u.currency, 'cash', p.from, p.to),
    buildDre(db, owner, u.currency, basis, prev.from, prev.to),
    buildCashFlow(db, owner, { currency: u.currency, opening_cash_cents: u.opening_cash_cents, opening_cash_date: u.opening_cash_date }, p.from, p.to),
    monthlySeries(db, owner, u.currency, p.to, 6),
  ]);
  const one = async (sql: string, ...a: unknown[]) => (await db.prepare(sql).bind(...a).first<{ t: number }>())?.t ?? 0;
  const arBase = "FROM receivables WHERE owner_id = ? AND currency = ? AND status = 'open' AND original_cents > received_cents";
  const apBase = "FROM expenses WHERE owner_id = ? AND currency = ? AND status = 'open' AND amount_cents > paid_cents";
  const arTotal = await one(`SELECT COALESCE(SUM(original_cents - received_cents),0) AS t ${arBase}`, owner, u.currency);
  const arOverdue = await one(`SELECT COALESCE(SUM(original_cents - received_cents),0) AS t ${arBase} AND due_date < ?`, owner, u.currency, today);
  const arDue = await one(`SELECT COALESCE(SUM(original_cents - received_cents),0) AS t ${arBase} AND due_date BETWEEN ? AND ?`, owner, u.currency, p.from, p.to);
  const apTotal = await one(`SELECT COALESCE(SUM(amount_cents - paid_cents),0) AS t ${apBase}`, owner, u.currency);
  const apOverdue = await one(`SELECT COALESCE(SUM(amount_cents - paid_cents),0) AS t ${apBase} AND due_date < ?`, owner, u.currency, today);
  const apDue = await one(`SELECT COALESCE(SUM(amount_cents - paid_cents),0) AS t ${apBase} AND due_date BETWEEN ? AND ?`, owner, u.currency, p.from, p.to);
  const hp = await helperPayables(db, owner, u.currency, { from: p.from, to: p.to });
  const hpAll = await helperPayables(db, owner, u.currency);
  const upcomingPay = (await db.prepare(`SELECT id, description, payee, due_date, amount_cents - paid_cents AS outstanding_cents ${apBase} AND due_date >= ? ORDER BY due_date LIMIT 5`).bind(owner, u.currency, today).all()).results;
  const upcomingRec = (await db.prepare(`SELECT id, customer, description, due_date, original_cents - received_cents AS outstanding_cents ${arBase} AND due_date >= ? ORDER BY due_date LIMIT 5`).bind(owner, u.currency, today).all()).results;
  const recent = (await db.prepare(
    `SELECT * FROM (
       SELECT 'receipt' AS type, rc.received_date AS date, rc.amount_cents, r.customer AS label, rc.created_at FROM receipts rc JOIN receivables r ON r.id = rc.receivable_id AND r.owner_id = rc.owner_id WHERE rc.owner_id = ? AND rc.voided_at IS NULL
       UNION ALL SELECT 'expense_payment', ep.paid_date, ep.amount_cents, e.description, ep.created_at FROM expense_payments ep JOIN expenses e ON e.id = ep.expense_id AND e.owner_id = ep.owner_id WHERE ep.owner_id = ? AND ep.voided_at IS NULL
       UNION ALL SELECT 'helper_payment', hp.paid_date, hp.amount_cents, h.full_name, hp.created_at FROM helper_payments hp JOIN helpers h ON h.id = hp.helper_id AND h.owner_id = hp.owner_id WHERE hp.owner_id = ? AND hp.voided_at IS NULL
     ) ORDER BY date DESC, created_at DESC LIMIT 10`).bind(owner, owner, owner).all()).results;
  const recentHelperPayments = recent.filter((r: any) => r.type === 'helper_payment').slice(0, 5);
  return c.json({
    period: p, previous_period: prev, basis, currency: u.currency, today,
    cards: {
      total_revenue_cents: dre.gross_revenue.total_cents, total_expenses_cents: dre.total_expenses_cents,
      gross_result_cents: dre.gross_profit_cents, operating_expenses_cents: dre.operating_expenses.total_cents, net_result_cents: dre.net_result_cents,
      receipts_collected_cents: cash.operating.receipts_cents, payments_made_cents: cash.operating.payments_cents,
      cash_balance_cents: cash.warnings.includes('no_opening_balance') ? null : cash.closing_cents,
    },
    receivables: { total_outstanding_cents: arTotal, overdue_cents: arOverdue, due_in_period_cents: arDue },
    payables: { total_outstanding_cents: apTotal, overdue_cents: apOverdue, due_in_period_cents: apDue, helper_outstanding_cents: hpAll.reduce((s, h) => s + h.outstanding_cents, 0) },
    helper_payments: { due_in_period_cents: hp.reduce((s, h) => s + h.due_cents, 0), outstanding_in_period_cents: hp.reduce((s, h) => s + h.outstanding_cents, 0), paid_in_period_cents: cash.operating.helper_payments_cents },
    dre_summary: dre, dre_previous: drePrev, dre_accrual: dreAccrual, dre_cash: dreCash, cash_flow: cash, monthly: series,
    upcoming_payments: upcomingPay, upcoming_receipts: upcomingRec, recent_transactions: recent, recent_helper_payments: recentHelperPayments,
  });
});
export { auditStmt };
