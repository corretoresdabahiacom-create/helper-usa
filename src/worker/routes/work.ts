import { Hono } from 'hono';
import { z } from 'zod';
import { STATE_CODES } from '../../shared/states';
import { centsToDecimalString, mulCents } from '../../shared/money';
import { addDays } from '../../shared/dates';
import {
  audit, auditStmt, currencyCode, dateStr, HttpError, mapDbError, moneyStr, newId, notFound, nowIso, optText, parseBody, parseWith,
  payMethod, shortText, todayOf, uid, type Ctx, type Env, type Vars,
} from '../core';
import { requireAuth } from './auth';
import { ownedHelper } from './helpers';
import { fifoAllocate, helperPayables, outstandingWorkdays, payStatus, WD_AMOUNT } from '../services/labor';

export const workRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();
workRoutes.use('*', requireAuth);

const st = z.enum(STATE_CODES);

// ───────────────────────── Projects ─────────────────────────
const projectSchema = z.object({
  name: shortText(2, 160), customer: optText(160), location: optText(300), city: optText(120), state: st.nullish(),
  start_date: dateStr.nullish(), expected_end_date: dateStr.nullish(), actual_end_date: dateStr.nullish(),
  description: optText(2000), status: z.enum(['planned', 'active', 'completed', 'canceled']).default('active'),
});
async function ownedProject(c: Ctx, id: string) {
  const p = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ? AND owner_id = ?').bind(id, uid(c)).first<any>();
  if (!p) throw notFound();
  return p;
}
workRoutes.post('/projects', async (c) => {
  const b = await parseBody(c as any, projectSchema);
  const id = newId(); const now = nowIso(c as any);
  await c.env.DB.prepare(`INSERT INTO projects (id, owner_id, name, customer, location, city, state, start_date, expected_end_date, actual_end_date, description, status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, uid(c as any), b.name, b.customer ?? null, b.location ?? null, b.city ?? null, b.state ?? null,
    b.start_date ?? null, b.expected_end_date ?? null, b.actual_end_date ?? null, b.description ?? null, b.status, now, now).run();
  return c.json({ id }, 201);
});
workRoutes.get('/projects', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT p.*, (SELECT COUNT(*) FROM workdays w WHERE w.project_id = p.id AND w.owner_id = p.owner_id AND w.status = 'completed') AS completed_days
       FROM projects p WHERE p.owner_id = ? ORDER BY p.created_at DESC`).bind(uid(c as any)).all();
  return c.json({ projects: rows.results });
});
workRoutes.get('/projects/:id', async (c) => c.json(await ownedProject(c as any, c.req.param('id'))));
workRoutes.patch('/projects/:id', async (c) => {
  const p = await ownedProject(c as any, c.req.param('id'));
  const b = await parseBody(c as any, projectSchema.partial());
  const sets: string[] = []; const vals: unknown[] = [];
  for (const [k, v] of Object.entries(b)) if (v !== undefined) { sets.push(`${k} = ?`); vals.push(v); }
  if (sets.length) await c.env.DB.prepare(`UPDATE projects SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND owner_id = ?`).bind(...vals, nowIso(c as any), p.id, uid(c as any)).run();
  return c.json({ ok: true });
});

/** Project financial summary. Only costs the user explicitly tagged to the project are included — no automatic indirect-cost allocation. */
workRoutes.get('/projects/:id/summary', async (c) => {
  const p = await ownedProject(c as any, c.req.param('id'));
  const owner = uid(c as any); const cur = c.get('user').profile.currency; const db = c.env.DB;
  const one = async (sql: string, ...a: unknown[]) => (await db.prepare(sql).bind(...a).first<any>()) ?? {};
  const rev = await one(`SELECT COALESCE(SUM(original_cents),0) AS total, COALESCE(SUM(received_cents),0) AS received FROM receivables
    WHERE owner_id = ? AND project_id = ? AND currency = ? AND status IN ('open','written_off')`, owner, p.id, cur);
  const labor = await one(`SELECT COALESCE(SUM(${WD_AMOUNT}),0) AS due, COALESCE(SUM(w.paid_cents),0) AS paid FROM workdays w
    WHERE w.owner_id = ? AND w.project_id = ? AND w.currency = ? AND w.status = 'completed'`, owner, p.id, cur);
  const exp = await db.prepare(`SELECT fc.dre_class AS cls, COALESCE(SUM(e.amount_cents),0) AS total, COALESCE(SUM(e.paid_cents),0) AS paid
    FROM expenses e JOIN financial_categories fc ON fc.id = e.category_id AND fc.owner_id = e.owner_id
    WHERE e.owner_id = ? AND e.project_id = ? AND e.currency = ? AND e.status IN ('open','written_off') GROUP BY fc.dre_class`).bind(owner, p.id, cur).all<any>();
  const sum = (classes: string[], f: 'total' | 'paid') => exp.results.filter((r) => classes.includes(r.cls)).reduce((a, r) => a + r[f], 0);
  const otherDirect = sum(['direct_cost'], 'total');
  const allocatedOpex = sum(['operating'], 'total');
  const deductions = sum(['deduction'], 'total');
  const result = rev.total - deductions - labor.due - otherDirect - allocatedOpex;
  return c.json({
    project_id: p.id, currency: cur, basis: 'accrual',
    revenue_cents: rev.total, received_cents: rev.received, outstanding_cents: rev.total - rev.received,
    direct_labor_cents: labor.due, labor_paid_cents: labor.paid, labor_payable_cents: labor.due - labor.paid,
    other_direct_costs_cents: otherDirect, allocated_operating_cents: allocatedOpex, deductions_cents: deductions,
    expenses_paid_cents: exp.results.reduce((a, r) => a + r.paid, 0),
    expenses_payable_cents: exp.results.reduce((a, r) => a + r.total - r.paid, 0),
    result_cents: result,
    note: 'Operating expenses appear only when explicitly assigned to this project. Indirect costs are never allocated automatically.',
  });
});

// ───────────────────────── Assignments ─────────────────────────
const assignmentSchema = z.object({
  helper_id: z.string().uuid(),
  project_id: z.string().uuid().nullish(),
  category_id: z.string().min(1).max(64).nullish(),
  job_name: shortText(2, 200), location: optText(300), street: optText(300), city: optText(120), state: st.nullish(),
  start_date: dateStr.optional(), end_date: dateStr.optional(),
  dates: z.array(dateStr).min(1).max(366),
  daily_rate: moneyStr, currency: currencyCode.optional(),
  details: optText(2000), notes: optText(2000),
});

async function assertNoConflicts(c: Ctx, helperId: string, dates: string[]) {
  const rows = await c.env.DB.prepare(
    `SELECT work_date FROM workdays WHERE owner_id = ? AND helper_id = ? AND status <> 'canceled' AND work_date IN (${dates.map(() => '?').join(',')})`,
  ).bind(uid(c), helperId, ...dates).all<{ work_date: string }>();
  if (rows.results.length) throw new HttpError(409, 'workday_conflict', { dates: rows.results.map((r) => r.work_date) });
}

workRoutes.post('/assignments', async (c) => {
  const b = await parseBody(c as any, assignmentSchema);
  const owner = uid(c as any); const db = c.env.DB; const now = nowIso(c as any);
  const helper = await ownedHelper(c as any, b.helper_id);
  if (helper.archived_at) throw new HttpError(409, 'helper_archived');
  if (b.project_id) await ownedProject(c as any, b.project_id);
  const dates = [...new Set(b.dates)].sort(); // the number of workdays = the days actually selected, not end - start
  const start = b.start_date ?? dates[0]; const end = b.end_date ?? dates[dates.length - 1];
  if (start > end || dates[0] < start || dates[dates.length - 1] > end) throw new HttpError(400, 'validation_error', { issues: [{ path: 'dates', code: 'dates_outside_range' }] });
  const categoryId = b.category_id ?? helper.main_category_id;
  const cat = await db.prepare('SELECT id FROM service_categories WHERE id = ? AND active = 1').bind(categoryId).first();
  if (!cat) throw new HttpError(400, 'validation_error', { issues: [{ path: 'category_id', code: 'invalid_category' }] });
  await assertNoConflicts(c as any, helper.id, dates);
  const currency = b.currency ?? c.get('user').profile.currency;
  const id = newId();
  try {
    await db.batch([
      db.prepare(`INSERT INTO work_assignments (id, owner_id, helper_id, project_id, category_id, job_name, location, street, city, state, start_date, end_date,
                  default_daily_rate_cents, currency, details, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(id, owner, helper.id, b.project_id ?? null, categoryId, b.job_name, b.location ?? null, b.street ?? null, b.city ?? helper.city, b.state ?? helper.state,
          start, end, b.daily_rate, currency, b.details ?? null, b.notes ?? null, now, now),
      ...dates.map((d) => db.prepare(`INSERT INTO workdays (id, owner_id, assignment_id, helper_id, project_id, work_date, daily_rate_cents, currency, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(newId(), owner, id, helper.id, b.project_id ?? null, d, b.daily_rate, currency, now, now)),
      audit(c as any, 'financial', 'assignment_created', 'work_assignments', id, { days: dates.length, rate_cents: b.daily_rate, currency }),
    ]);
  } catch (e) { mapDbError(e); }
  return c.json({ id, workdays: dates.length, scheduled_total_cents: mulCents(b.daily_rate, dates.length), scheduled_total: centsToDecimalString(mulCents(b.daily_rate, dates.length)), currency }, 201);
});

workRoutes.get('/assignments', async (c) => {
  const q = c.req.query(); const w = ['wa.owner_id = ?']; const a: unknown[] = [uid(c as any)];
  if (q.helper_id) { w.push('wa.helper_id = ?'); a.push(q.helper_id); }
  if (q.project_id) { w.push('wa.project_id = ?'); a.push(q.project_id); }
  const rows = await c.env.DB.prepare(
    `SELECT wa.*, h.full_name AS helper_name, p.name AS project_name,
       (SELECT COUNT(*) FROM workdays x WHERE x.assignment_id = wa.id AND x.status <> 'canceled') AS days,
       (SELECT COUNT(*) FROM workdays x WHERE x.assignment_id = wa.id AND x.status = 'completed') AS completed_days,
       (SELECT COALESCE(SUM(x.daily_rate_cents),0) FROM workdays x WHERE x.assignment_id = wa.id AND x.status <> 'canceled') AS scheduled_total_cents
     FROM work_assignments wa JOIN helpers h ON h.id = wa.helper_id AND h.owner_id = wa.owner_id
     LEFT JOIN projects p ON p.id = wa.project_id AND p.owner_id = wa.owner_id
     WHERE ${w.join(' AND ')} ORDER BY wa.start_date DESC LIMIT 200`).bind(...a).all();
  return c.json({ assignments: rows.results });
});

async function ownedAssignment(c: Ctx, id: string) {
  const r = await c.env.DB.prepare('SELECT * FROM work_assignments WHERE id = ? AND owner_id = ?').bind(id, uid(c)).first<any>();
  if (!r) throw notFound();
  return r;
}
workRoutes.get('/assignments/:id', async (c) => {
  const a = await ownedAssignment(c as any, c.req.param('id'));
  const days = await c.env.DB.prepare(`SELECT w.*, ${WD_AMOUNT} AS effective_cents FROM workdays w WHERE w.assignment_id = ? AND w.owner_id = ? ORDER BY w.work_date`).bind(a.id, uid(c as any)).all();
  return c.json({ ...a, workdays: days.results });
});

workRoutes.patch('/assignments/:id', async (c) => {
  const a = await ownedAssignment(c as any, c.req.param('id'));
  const b = await parseBody(c as any, z.object({
    job_name: shortText(2, 200).optional(), location: optText(300), street: optText(300), city: optText(120), state: st.nullish(),
    details: optText(2000), notes: optText(2000), status: z.enum(['active', 'completed', 'canceled']).optional(),
  }));
  const owner = uid(c as any); const now = nowIso(c as any); const stmts: D1PreparedStatement[] = [];
  const sets: string[] = []; const vals: unknown[] = [];
  for (const [k, v] of Object.entries(b)) if (v !== undefined) { sets.push(`${k} = ?`); vals.push(v); }
  if (sets.length) stmts.push(c.env.DB.prepare(`UPDATE work_assignments SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND owner_id = ?`).bind(...vals, now, a.id, owner));
  if (b.status === 'canceled' && a.status !== 'canceled') {
    // cancel only future/unworked days; completed and absent history is preserved
    stmts.push(c.env.DB.prepare(`UPDATE workdays SET status = 'canceled', updated_at = ? WHERE assignment_id = ? AND owner_id = ? AND status IN ('scheduled','confirmed')`).bind(now, a.id, owner));
    stmts.push(audit(c as any, 'financial', 'assignment_canceled', 'work_assignments', a.id));
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

workRoutes.post('/assignments/:id/workdays', async (c) => {
  const a = await ownedAssignment(c as any, c.req.param('id'));
  const b = await parseBody(c as any, z.object({ dates: z.array(dateStr).min(1).max(366), daily_rate: moneyStr.optional() }));
  const dates = [...new Set(b.dates)].sort(); const now = nowIso(c as any); const owner = uid(c as any);
  if (a.status === 'canceled') throw new HttpError(409, 'assignment_canceled');
  await assertNoConflicts(c as any, a.helper_id, dates);
  const rate = b.daily_rate ?? a.default_daily_rate_cents;
  try {
    await c.env.DB.batch([
      ...dates.map((d) => c.env.DB.prepare(`INSERT INTO workdays (id, owner_id, assignment_id, helper_id, project_id, work_date, daily_rate_cents, currency, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(newId(), owner, a.id, a.helper_id, a.project_id, d, rate, a.currency, now, now)),
      c.env.DB.prepare('UPDATE work_assignments SET start_date = MIN(start_date, ?), end_date = MAX(end_date, ?), updated_at = ? WHERE id = ? AND owner_id = ?').bind(dates[0], dates[dates.length - 1], now, a.id, owner),
    ]);
  } catch (e) { mapDbError(e); }
  return c.json({ added: dates.length }, 201);
});

// ───────────────────────── Workdays ─────────────────────────
const TRANSITIONS: Record<string, string[]> = {
  scheduled: ['confirmed', 'completed', 'absent', 'canceled'],
  confirmed: ['scheduled', 'completed', 'absent', 'canceled'],
  absent: ['scheduled', 'confirmed', 'completed', 'canceled'],
  completed: ['scheduled', 'absent', 'canceled'],
  canceled: ['scheduled'],
};
const reasonSchema = z.string().trim().min(5).max(300);

async function applyWorkdayChange(c: Ctx, wd: any, b: { status?: string; daily_rate?: number; amount_override?: number | null; adjustment_reason?: string }) {
  const owner = uid(c); const now = nowIso(c); const today = todayOf(c);
  const sets: string[] = []; const vals: unknown[] = []; const stmts: D1PreparedStatement[] = [];
  const before = { status: wd.status, daily_rate_cents: wd.daily_rate_cents, amount_override_cents: wd.amount_override_cents };
  const reason = b.adjustment_reason;
  let nextStatus = wd.status;

  if (b.status && b.status !== wd.status) {
    if (!TRANSITIONS[wd.status]?.includes(b.status)) throw new HttpError(409, 'invalid_transition');
    if (b.status === 'completed' && wd.work_date > today) throw new HttpError(400, 'future_workday'); // future work is not payable
    if ((wd.status === 'completed' || (wd.status === 'absent' && b.status === 'completed')) && !reason) throw new HttpError(400, 'reason_required');
    if (wd.status === 'completed' && wd.paid_cents > 0) throw new HttpError(409, 'workday_paid'); // void the payment first
    nextStatus = b.status;
    sets.push('status = ?'); vals.push(b.status);
    sets.push('completed_at = ?'); vals.push(b.status === 'completed' ? now : null);
  }
  if (b.daily_rate !== undefined && b.daily_rate !== wd.daily_rate_cents) {
    if (['completed', 'absent'].includes(nextStatus) && !reason) throw new HttpError(400, 'reason_required');
    sets.push('daily_rate_cents = ?'); vals.push(b.daily_rate); // only this workday changes; sibling days keep their own rate
  }
  if (b.amount_override !== undefined) {
    if (!reason) throw new HttpError(400, 'reason_required');
    sets.push('amount_override_cents = ?'); vals.push(b.amount_override);
  }
  if (reason) { sets.push('adjustment_reason = ?'); vals.push(reason); }
  if (!sets.length) return;
  stmts.push(c.env.DB.prepare(`UPDATE workdays SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND owner_id = ?`).bind(...vals, now, wd.id, owner));
  const newEffective = b.amount_override !== undefined ? (b.amount_override ?? (b.daily_rate ?? wd.daily_rate_cents)) : (wd.amount_override_cents ?? (b.daily_rate ?? wd.daily_rate_cents));
  const oldEffective = wd.amount_override_cents ?? wd.daily_rate_cents;
  if (nextStatus === 'completed' && newEffective !== oldEffective && reason) {
    stmts.push(c.env.DB.prepare('INSERT INTO accounting_adjustments (id, owner_id, kind, ref_id, amount_cents, currency, adjust_date, reason, actor_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(newId(), owner, b.amount_override !== undefined ? 'workday_amount' : 'workday_rate', wd.id, newEffective - oldEffective, wd.currency, today, reason, owner, now));
  }
  stmts.push(auditStmt(c.env.DB, { scope: 'financial', ownerId: owner, actorId: owner, action: 'workday_changed', entity: 'workdays', entityId: wd.id, at: now,
    details: { before, after: { status: nextStatus, daily_rate_cents: b.daily_rate ?? wd.daily_rate_cents, amount_override_cents: b.amount_override === undefined ? wd.amount_override_cents : b.amount_override }, reason } }));
  try { await c.env.DB.batch(stmts); } catch (e) { mapDbError(e); }
}

const workdayPatch = z.object({
  status: z.enum(['scheduled', 'confirmed', 'completed', 'absent', 'canceled']).optional(),
  daily_rate: moneyStr.optional(), amount_override: moneyStr.nullable().optional(), adjustment_reason: reasonSchema.optional(),
});
async function ownedWorkday(c: Ctx, id: string) {
  const w = await c.env.DB.prepare('SELECT * FROM workdays WHERE id = ? AND owner_id = ?').bind(id, uid(c)).first<any>();
  if (!w) throw notFound();
  return w;
}
workRoutes.patch('/workdays/:id', async (c) => {
  const wd = await ownedWorkday(c as any, c.req.param('id'));
  await applyWorkdayChange(c as any, wd, await parseBody(c as any, workdayPatch));
  return c.json(await ownedWorkday(c as any, wd.id));
});
workRoutes.post('/workdays/bulk-status', async (c) => {
  const b = await parseBody(c as any, z.object({ ids: z.array(z.string().uuid()).min(1).max(100), status: z.enum(['confirmed', 'completed', 'absent', 'canceled']), adjustment_reason: reasonSchema.optional() }));
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const id of b.ids) {
    try { await applyWorkdayChange(c as any, await ownedWorkday(c as any, id), { status: b.status, adjustment_reason: b.adjustment_reason }); results.push({ id, ok: true }); }
    catch (e) { results.push({ id, ok: false, error: e instanceof HttpError ? e.code : 'error' }); }
  }
  return c.json({ results });
});

workRoutes.get('/workdays', async (c) => {
  const q = c.req.query(); const w = ['w.owner_id = ?']; const a: unknown[] = [uid(c as any)];
  const from = q.from ?? addDays(todayOf(c as any), -7); const to = q.to ?? addDays(todayOf(c as any), 30);
  w.push('w.work_date BETWEEN ? AND ?'); a.push(from, to);
  if (q.helper_id) { w.push('w.helper_id = ?'); a.push(q.helper_id); }
  if (q.project_id) { w.push('w.project_id = ?'); a.push(q.project_id); }
  if (q.status) { w.push('w.status = ?'); a.push(q.status); }
  const rows = await c.env.DB.prepare(
    `SELECT w.*, ${WD_AMOUNT} AS effective_cents, h.full_name AS helper_name, wa.job_name, wa.location
       FROM workdays w JOIN helpers h ON h.id = w.helper_id AND h.owner_id = w.owner_id JOIN work_assignments wa ON wa.id = w.assignment_id AND wa.owner_id = w.owner_id
      WHERE ${w.join(' AND ')} ORDER BY w.work_date, h.full_name LIMIT 1000`).bind(...a).all<any>();
  return c.json({ from, to, workdays: rows.results.map((r) => ({ ...r, payment_status: r.status === 'completed' ? payStatus(r.effective_cents, r.paid_cents) : 'none' })) });
});

/** Individual helper calendar: scheduled / completed / canceled / absent / pending confirmation + payment status. */
workRoutes.get('/calendar', async (c) => {
  const q = c.req.query(); const h = await ownedHelper(c as any, q.helper_id ?? '');
  const from = q.from ?? addDays(todayOf(c as any), -30); const to = q.to ?? addDays(todayOf(c as any), 60);
  const rows = await c.env.DB.prepare(
    `SELECT w.id, w.work_date, w.status, w.currency, w.daily_rate_cents, w.paid_cents, ${WD_AMOUNT} AS effective_cents, wa.job_name, wa.location
       FROM workdays w JOIN work_assignments wa ON wa.id = w.assignment_id AND wa.owner_id = w.owner_id
      WHERE w.owner_id = ? AND w.helper_id = ? AND w.work_date BETWEEN ? AND ? ORDER BY w.work_date`).bind(uid(c as any), h.id, from, to).all<any>();
  const days = rows.results.map((r) => ({ ...r, payment_status: r.status === 'completed' ? payStatus(r.effective_cents, r.paid_cents) : 'none' }));
  const counts: Record<string, number> = { scheduled: 0, confirmed: 0, completed: 0, absent: 0, canceled: 0 };
  for (const d of days) counts[d.status] = (counts[d.status] ?? 0) + 1;
  return c.json({ helper_id: h.id, from, to, counts, pending_confirmation: counts.scheduled, days });
});

// ───────────────────────── Helper payments (internal control; never moves money) ─────────────────────────
const paymentSchema = z.object({
  helper_id: z.string().uuid(), amount: moneyStr, paid_date: dateStr, method: payMethod, notes: optText(500),
  from: dateStr.optional(), to: dateStr.optional(), project_id: z.string().uuid().optional(), currency: currencyCode.optional(),
  idempotency_key: z.string().min(8).max(80).optional(),
});

workRoutes.post('/helper-payments', async (c) => {
  const b = await parseBody(c as any, paymentSchema);
  const owner = uid(c as any); const db = c.env.DB; const now = nowIso(c as any);
  const helper = await ownedHelper(c as any, b.helper_id);
  if (b.paid_date > todayOf(c as any)) throw new HttpError(400, 'future_date');
  if (b.project_id) await ownedProject(c as any, b.project_id);
  const currency = b.currency ?? c.get('user').profile.currency;

  if (b.idempotency_key) {
    const prior = await db.prepare('SELECT id, amount_cents FROM helper_payments WHERE owner_id = ? AND idempotency_key = ?').bind(owner, b.idempotency_key).first<any>();
    if (prior) return c.json({ id: prior.id, duplicate: true }, 200); // same request replayed: no second payment
  } else {
    const since = new Date(c.get('now').getTime() - 15_000).toISOString();
    const dup = await db.prepare(`SELECT id FROM helper_payments WHERE owner_id = ? AND helper_id = ? AND amount_cents = ? AND paid_date = ? AND method = ? AND voided_at IS NULL AND created_at >= ?`)
      .bind(owner, helper.id, b.amount, b.paid_date, b.method, since).first();
    if (dup) throw new HttpError(409, 'duplicate_payment');
  }
  const open = await outstandingWorkdays(db, owner, helper.id, currency, { from: b.from, to: b.to, projectId: b.project_id });
  const outstanding = open.reduce((s, r) => s + r.outstanding_cents, 0);
  if (b.amount > outstanding) throw new HttpError(409, 'exceeds_outstanding', { outstanding_cents: outstanding });
  const { allocations } = fifoAllocate(open, b.amount);
  const id = newId();
  try {
    await db.batch([
      db.prepare(`INSERT INTO helper_payments (id, owner_id, helper_id, amount_cents, currency, paid_date, method, notes, idempotency_key, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .bind(id, owner, helper.id, b.amount, currency, b.paid_date, b.method, b.notes ?? null, b.idempotency_key ?? null, now),
      ...allocations.flatMap((al) => [
        db.prepare('INSERT INTO payment_allocations (id, owner_id, payment_id, workday_id, amount_cents) VALUES (?,?,?,?,?)').bind(newId(), owner, id, al.workday_id, al.amount_cents),
        // guard trigger aborts the whole batch if a concurrent payment already consumed this balance
        db.prepare('UPDATE workdays SET paid_cents = paid_cents + ?, updated_at = ? WHERE id = ? AND owner_id = ?').bind(al.amount_cents, now, al.workday_id, owner),
      ]),
      audit(c as any, 'financial', 'helper_payment_recorded', 'helper_payments', id, { helper_id: helper.id, amount_cents: b.amount, method: b.method }),
    ]);
  } catch (e) {
    if (b.idempotency_key && String((e as Error).message).includes('UNIQUE')) {
      const prior = await db.prepare('SELECT id FROM helper_payments WHERE owner_id = ? AND idempotency_key = ?').bind(owner, b.idempotency_key).first<any>();
      if (prior) return c.json({ id: prior.id, duplicate: true }, 200);
    }
    mapDbError(e);
  }
  return c.json({ id, allocations, outstanding_after_cents: outstanding - b.amount }, 201);
});

workRoutes.get('/helper-payments', async (c) => {
  const q = c.req.query(); const w = ['p.owner_id = ?']; const a: unknown[] = [uid(c as any)];
  if (q.helper_id) { w.push('p.helper_id = ?'); a.push(q.helper_id); }
  if (q.from) { w.push('p.paid_date >= ?'); a.push(q.from); }
  if (q.to) { w.push('p.paid_date <= ?'); a.push(q.to); }
  const rows = await c.env.DB.prepare(
    `SELECT p.*, h.full_name AS helper_name FROM helper_payments p JOIN helpers h ON h.id = p.helper_id AND h.owner_id = p.owner_id
      WHERE ${w.join(' AND ')} ORDER BY p.paid_date DESC, p.created_at DESC LIMIT 500`).bind(...a).all();
  return c.json({ payments: rows.results });
});

workRoutes.post('/helper-payments/:id/void', async (c) => {
  const { reason } = await parseBody(c as any, z.object({ reason: reasonSchema }));
  const owner = uid(c as any); const db = c.env.DB; const now = nowIso(c as any);
  const p = await db.prepare('SELECT * FROM helper_payments WHERE id = ? AND owner_id = ?').bind(c.req.param('id'), owner).first<any>();
  if (!p) throw notFound();
  if (p.voided_at) throw new HttpError(409, 'already_voided');
  const allocs = await db.prepare('SELECT workday_id, amount_cents FROM payment_allocations WHERE payment_id = ? AND owner_id = ?').bind(p.id, owner).all<any>();
  try {
    await db.batch([
      db.prepare('UPDATE helper_payments SET voided_at = ?, void_reason = ? WHERE id = ? AND owner_id = ? AND voided_at IS NULL').bind(now, reason, p.id, owner),
      ...allocs.results.map((al) => db.prepare('UPDATE workdays SET paid_cents = paid_cents - ?, updated_at = ? WHERE id = ? AND owner_id = ?').bind(al.amount_cents, now, al.workday_id, owner)),
      audit(c as any, 'financial', 'helper_payment_voided', 'helper_payments', p.id, { reason, amount_cents: p.amount_cents }),
    ]);
  } catch (e) { mapDbError(e); }
  return c.json({ ok: true });
});

/** Amount due per helper for completed workdays in the period: due − payments = outstanding. */
workRoutes.get('/helper-payments/summary', async (c) => {
  const q = c.req.query(); const cur = c.get('user').profile.currency;
  const rows = await helperPayables(c.env.DB, uid(c as any), cur, { from: q.from, to: q.to });
  const helpers = rows.map((r) => ({ ...r, payment_status: payStatus(r.due_cents, r.paid_cents) }));
  const totals = helpers.reduce((t, r) => ({ due_cents: t.due_cents + r.due_cents, paid_cents: t.paid_cents + r.paid_cents, outstanding_cents: t.outstanding_cents + r.outstanding_cents }), { due_cents: 0, paid_cents: 0, outstanding_cents: 0 });
  return c.json({ currency: cur, from: q.from ?? null, to: q.to ?? null, helpers, totals });
});
export { parseWith, mulCents };
