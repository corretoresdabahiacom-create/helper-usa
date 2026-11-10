// Money is ALWAYS integer cents. No floating point is ever used for amounts.
export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'BRL', 'CAD', 'MXN'] as const;
export const DEFAULT_CURRENCY = 'USD';
const MAX_CENTS = 99_999_999_999_99; // < 2^53, ~ 1 trillion

const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;

/** Parse "180", "180.5", "180.50" into cents. Throws on anything else (no commas, no exponent, no negatives). */
export function parseMoney(input: string): number {
  if (typeof input !== 'string') throw new Error('invalid_amount');
  const s = input.trim();
  if (!MONEY_RE.test(s)) throw new Error('invalid_amount');
  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) throw new Error('invalid_amount');
  return cents;
}

export function assertCents(n: number): number {
  if (!Number.isSafeInteger(n)) throw new Error('invalid_amount');
  return n;
}

export function addCents(...v: number[]): number {
  return assertCents(v.reduce((a, b) => a + b, 0));
}

/** cents × whole-number quantity (e.g. daily rate × workdays). */
export function mulCents(cents: number, qty: number): number {
  if (!Number.isInteger(qty) || qty < 0) throw new Error('invalid_quantity');
  return assertCents(cents * qty);
}

/** Integer division rounding half away from zero (the platform's single rounding policy). */
export function roundDiv(numerator: number, denominator: number): number {
  if (denominator === 0) throw new Error('division_by_zero');
  const sign = numerator < 0 !== denominator < 0 ? -1 : 1;
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  return sign * Math.floor((2 * n + d) / (2 * d));
}

/** Split a total into `parts` installments; remainder cents go to the first installments so the sum is exact. */
export function allocate(total: number, parts: number): number[] {
  if (!Number.isInteger(parts) || parts < 1) throw new Error('invalid_parts');
  const base = Math.floor(total / parts);
  const rem = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < rem ? 1 : 0));
}

/** Format cents for display without floats: 72000 -> "720.00" */
export function centsToDecimalString(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return neg ? `-${s}` : s;
}

export function formatMoney(cents: number, currency = DEFAULT_CURRENCY, locale = 'en-US'): string {
  const dec = centsToDecimalString(cents);
  // Intl formatting of an already-exact decimal string; Number() only for presentation.
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(dec));
}

/** Basis-point percentage with integer math: 2500 -> "25.00" */
export function bpsToPercent(bps: number): string {
  return centsToDecimalString(bps);
}
