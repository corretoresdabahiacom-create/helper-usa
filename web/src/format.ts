/** All money arrives as integer cents; formatting never uses floating-point arithmetic on amounts. */
export function fmtMoney(cents: number | null | undefined, currency = 'USD', lang = 'en'): string {
  if (cents === null || cents === undefined) return '—';
  const neg = cents < 0; const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100); const frac = String(abs % 100).padStart(2, '0');
  const sep = lang === 'en' ? { g: ',', d: '.' } : { g: '.', d: ',' };
  const w = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, sep.g);
  const sym: Record<string, string> = { USD: '$', EUR: '€', BRL: 'R$', CAD: 'CA$', MXN: 'MX$' };
  return `${neg ? '-' : ''}${sym[currency] ?? currency + ' '}${w}${sep.d}${frac}`;
}
/** Parse user text like "1,234.50" into the strict "1234.50" string the API accepts, or null. */
export function normalizeMoneyInput(s: string): string | null {
  const t = s.trim().replace(/\s/g, '').replace(/^\$/, '');
  if (/^\d+(\.\d{1,2})?$/.test(t)) return t.includes('.') ? (t.split('.')[1]!.length === 1 ? t + '0' : t) : t + '.00';
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(t)) return normalizeMoneyInput(t.replace(/,/g, ''));
  return null;
}
export const today = (tz?: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export function addDaysStr(d: string, n: number) { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
export function fmtDate(d: string | null | undefined, lang = 'en') {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return lang === 'en' ? `${m}/${day}/${y}` : `${day}/${m}/${y}`;
}
export function fmtDateTime(iso: string, lang = 'en') {
  return new Intl.DateTimeFormat(lang, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}
