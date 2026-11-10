import { addCents } from '../../shared/money';

/** Effective payable amount of a completed workday (adjusted amount wins over the daily rate). */
export const WD_AMOUNT = 'COALESCE(w.amount_override_cents, w.daily_rate_cents)';

export interface WorkFilters {
  from: string; to: string;
  helperIds?: string[]; projectIds?: string[]; city?: string; state?: string; currency?: string;
}

function whereFor(owner: string, f: WorkFilters) {
  const w = ['w.owner_id = ?', 'w.work_date BETWEEN ? AND ?'];
  const a: unknown[] = [owner, f.from, f.to];
  if (f.helperIds?.length) { w.push(`w.helper_id IN (${f.helperIds.map(() => '?').join(',')})`); a.push(...f.helperIds); }
  if (f.projectIds?.length) { w.push(`w.project_id IN (${f.projectIds.map(() => '?').join(',')})`); a.push(...f.projectIds); }
  if (f.city) { w.push('wa.city = ? COLLATE NOCASE'); a.push(f.city); }
  if (f.state) { w.push('wa.state = ?'); a.push(f.state); }
  if (f.currency) { w.push('w.currency = ?'); a.push(f.currency); }
  return { sql: w.join(' AND '), args: a };
}

export type PayStatus = 'unpaid' | 'partial' | 'paid' | 'none';
export const payStatus = (due: number, paid: number): PayStatus => (due <= 0 ? 'none' : paid <= 0 ? 'unpaid' : paid >= due ? 'paid' : 'partial');

export async function workReport(db: D1Database, owner: string, f: WorkFilters) {
  const { sql, args } = whereFor(owner, f);
  const rows = (await db.prepare(
    `SELECT w.id, w.work_date, w.status, w.currency, w.daily_rate_cents, w.paid_cents, ${WD_AMOUNT} AS effective_cents, w.adjustment_reason,
            h.id AS helper_id, h.full_name AS helper_name, sc.name_en AS category_en, sc.name_pt AS category_pt, sc.name_es AS category_es,
            wa.job_name, wa.location, wa.city, wa.state, p.name AS project_name
       FROM workdays w JOIN helpers h ON h.id = w.helper_id AND h.owner_id = w.owner_id
       JOIN work_assignments wa ON wa.id = w.assignment_id AND wa.owner_id = w.owner_id
       LEFT JOIN projects p ON p.id = w.project_id AND p.owner_id = w.owner_id
       LEFT JOIN service_categories sc ON sc.id = wa.category_id
      WHERE ${sql} AND w.status <> 'canceled' ORDER BY h.full_name COLLATE NOCASE, w.work_date`,
  ).bind(...args).all<any>()).results;

  const statusCounts: Record<string, number> = {};
  const byKey = new Map<string, any>();
  for (const r of rows) {
    statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
    const payable = r.status === 'completed';
    r.amount_cents = payable ? r.effective_cents : 0; // only completed workdays are payable
    if (!payable) continue;
    const key = `${r.helper_id}|${r.currency}`;
    const g = byKey.get(key) ?? { helper_id: r.helper_id, helper_name: r.helper_name, currency: r.currency, days: 0, rates: new Set<number>(), total_cents: 0, paid_cents: 0 };
    g.days += 1; g.rates.add(r.effective_cents); g.total_cents = addCents(g.total_cents, r.effective_cents); g.paid_cents = addCents(g.paid_cents, r.paid_cents);
    byKey.set(key, g);
  }
  const byHelper = [...byKey.values()].map((g) => ({
    helper_id: g.helper_id, helper_name: g.helper_name, currency: g.currency, days: g.days,
    rates_cents: [...g.rates].sort((a: number, b: number) => a - b),
    total_cents: g.total_cents, paid_cents: g.paid_cents, remaining_cents: g.total_cents - g.paid_cents,
    payment_status: payStatus(g.total_cents, g.paid_cents),
  }));
  // Totals are per currency: different currencies are never added together.
  const totals: Record<string, { days: number; total_cents: number; paid_cents: number; remaining_cents: number }> = {};
  for (const g of byHelper) {
    const t = (totals[g.currency] ??= { days: 0, total_cents: 0, paid_cents: 0, remaining_cents: 0 });
    t.days += g.days; t.total_cents += g.total_cents; t.paid_cents += g.paid_cents; t.remaining_cents += g.remaining_cents;
  }
  return { rows, by_helper: byHelper, totals, status_counts: statusCounts };
}

/** Outstanding completed workdays for a helper, oldest first (used for FIFO payment allocation). */
export async function outstandingWorkdays(db: D1Database, owner: string, helperId: string, currency: string, f: { from?: string; to?: string; projectId?: string }) {
  const w = ["w.owner_id = ?", 'w.helper_id = ?', "w.status = 'completed'", 'w.currency = ?', `${WD_AMOUNT} - w.paid_cents > 0`];
  const a: unknown[] = [owner, helperId, currency];
  if (f.from) { w.push('w.work_date >= ?'); a.push(f.from); }
  if (f.to) { w.push('w.work_date <= ?'); a.push(f.to); }
  if (f.projectId) { w.push('w.project_id = ?'); a.push(f.projectId); }
  return (await db.prepare(
    `SELECT w.id, w.work_date, ${WD_AMOUNT} AS effective_cents, w.paid_cents, ${WD_AMOUNT} - w.paid_cents AS outstanding_cents
       FROM workdays w WHERE ${w.join(' AND ')} ORDER BY w.work_date, w.id`,
  ).bind(...a).all<{ id: string; work_date: string; effective_cents: number; paid_cents: number; outstanding_cents: number }>()).results;
}

export function fifoAllocate(rows: { id: string; work_date: string; outstanding_cents: number }[], amount: number) {
  let left = amount;
  const out: { workday_id: string; work_date: string; amount_cents: number }[] = [];
  for (const r of rows) {
    if (left <= 0) break;
    const take = Math.min(left, r.outstanding_cents);
    out.push({ workday_id: r.id, work_date: r.work_date, amount_cents: take });
    left -= take;
  }
  return { allocations: out, unallocated: left };
}

/** Per-helper totals of completed work (not period-limited unless from/to are given): helper payable lines. */
export async function helperPayables(db: D1Database, owner: string, currency: string, opts: { from?: string; to?: string } = {}) {
  const w = ["w.owner_id = ?", "w.status = 'completed'", 'w.currency = ?'];
  const a: unknown[] = [owner, currency];
  if (opts.from) { w.push('w.work_date >= ?'); a.push(opts.from); }
  if (opts.to) { w.push('w.work_date <= ?'); a.push(opts.to); }
  return (await db.prepare(
    `SELECT h.id AS helper_id, h.full_name AS helper_name, COUNT(*) AS days, SUM(${WD_AMOUNT}) AS due_cents, SUM(w.paid_cents) AS paid_cents,
            SUM(${WD_AMOUNT} - w.paid_cents) AS outstanding_cents, MIN(CASE WHEN ${WD_AMOUNT} - w.paid_cents > 0 THEN w.work_date END) AS oldest_unpaid
       FROM workdays w JOIN helpers h ON h.id = w.helper_id AND h.owner_id = w.owner_id
      WHERE ${w.join(' AND ')} GROUP BY h.id, h.full_name ORDER BY outstanding_cents DESC, h.full_name`,
  ).bind(...a).all<{ helper_id: string; helper_name: string; days: number; due_cents: number; paid_cents: number; outstanding_cents: number; oldest_unpaid: string | null }>()).results;
}
