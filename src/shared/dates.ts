// Business dates are plain 'YYYY-MM-DD' strings in the contractor's time zone.
// All arithmetic is done on UTC calendar math so DST can never shift a date.
export type DateStr = string;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateStr(s: unknown): s is DateStr {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

const toUtc = (s: DateStr) => {
  const m = DATE_RE.exec(s)!;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};
const fromUtc = (ms: number): DateStr => new Date(ms).toISOString().slice(0, 10);

export function addDays(s: DateStr, n: number): DateStr {
  return fromUtc(toUtc(s) + n * 86_400_000);
}
export function addMonths(s: DateStr, n: number): DateStr {
  const [y, m, d] = s.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${String(ny).padStart(4, '0')}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
export function addYears(s: DateStr, n: number): DateStr {
  return addMonths(s, n * 12);
}
/** 0 = Sunday */
export function dayOfWeek(s: DateStr): number {
  return new Date(toUtc(s)).getUTCDay();
}
export function diffDays(a: DateStr, b: DateStr): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}
export function eachDay(from: DateStr, to: DateStr): DateStr[] {
  const out: DateStr[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    out.push(d);
    if (out.length > 3660) throw new Error('range_too_large');
  }
  return out;
}

/** Today's calendar date in an IANA time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): DateStr {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return parts; // en-CA => YYYY-MM-DD
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const PERIOD_KINDS = [
  'today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month',
  'this_quarter', 'last_quarter', 'this_year', 'last_year', 'custom',
] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];
export interface Period { kind: PeriodKind; from: DateStr; to: DateStr }

const startOfWeek = (s: DateStr) => addDays(s, -dayOfWeek(s)); // US convention: week starts Sunday
const startOfMonth = (s: DateStr) => `${s.slice(0, 7)}-01`;
const endOfMonth = (s: DateStr) => addDays(addMonths(startOfMonth(s), 1), -1);
const startOfQuarter = (s: DateStr) => {
  const m = Number(s.slice(5, 7));
  const qm = Math.floor((m - 1) / 3) * 3 + 1;
  return `${s.slice(0, 4)}-${String(qm).padStart(2, '0')}-01`;
};

export function resolvePeriod(kind: PeriodKind, today: DateStr, custom?: { from?: string; to?: string }): Period {
  switch (kind) {
    case 'today': return { kind, from: today, to: today };
    case 'yesterday': { const d = addDays(today, -1); return { kind, from: d, to: d }; }
    case 'this_week': { const f = startOfWeek(today); return { kind, from: f, to: addDays(f, 6) }; }
    case 'last_week': { const f = addDays(startOfWeek(today), -7); return { kind, from: f, to: addDays(f, 6) }; }
    case 'this_month': return { kind, from: startOfMonth(today), to: endOfMonth(today) };
    case 'last_month': { const f = addMonths(startOfMonth(today), -1); return { kind, from: f, to: endOfMonth(f) }; }
    case 'this_quarter': { const f = startOfQuarter(today); return { kind, from: f, to: addDays(addMonths(f, 3), -1) }; }
    case 'last_quarter': { const f = addMonths(startOfQuarter(today), -3); return { kind, from: f, to: addDays(addMonths(f, 3), -1) }; }
    case 'this_year': return { kind, from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    case 'last_year': { const y = Number(today.slice(0, 4)) - 1; return { kind, from: `${y}-01-01`, to: `${y}-12-31` }; }
    case 'custom': {
      if (!isDateStr(custom?.from) || !isDateStr(custom?.to) || custom!.from! > custom!.to!) throw new Error('invalid_period');
      return { kind, from: custom!.from!, to: custom!.to! };
    }
  }
}

/** The immediately preceding period of equal calendar meaning (month→previous month, etc.). */
export function previousPeriod(p: Period): Period {
  const len = diffDays(p.from, p.to) + 1;
  switch (p.kind) {
    case 'this_month': case 'last_month': {
      const f = addMonths(startOfMonth(p.from), -1); return { kind: 'custom', from: f, to: endOfMonth(f) };
    }
    case 'this_quarter': case 'last_quarter': {
      const f = addMonths(p.from, -3); return { kind: 'custom', from: f, to: addDays(p.from, -1) };
    }
    case 'this_year': case 'last_year': {
      const y = Number(p.from.slice(0, 4)) - 1; return { kind: 'custom', from: `${y}-01-01`, to: `${y}-12-31` };
    }
    default: return { kind: 'custom', from: addDays(p.from, -len), to: addDays(p.from, -1) };
  }
}

/** Last N calendar months (YYYY-MM) ending at the month containing `to`. */
export function lastMonths(to: DateStr, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(addMonths(startOfMonth(to), -i).slice(0, 7));
  return out;
}
