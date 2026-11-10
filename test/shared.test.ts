import { describe, expect, it } from 'vitest';
import { allocate, centsToDecimalString, mulCents, parseMoney, roundDiv } from '../src/shared/money';
import { addMonths, eachDay, isDateStr, previousPeriod, resolvePeriod, todayIn } from '../src/shared/dates';
import { normalizePhone, whatsappLink } from '../src/shared/phone';
import { US_STATES } from '../src/shared/states';

describe('money (exact integer cents)', () => {
  it('parses strict decimal strings', () => {
    expect(parseMoney('180')).toBe(18000);
    expect(parseMoney('180.5')).toBe(18050);
    expect(parseMoney('0.07')).toBe(7);
    expect(parseMoney('1234567.89')).toBe(123456789);
  });
  it('rejects ambiguous / unsafe input', () => {
    for (const bad of ['', '-5', '1,000', '1e3', '12.345', 'abc', '1.', '.5', '0x10', '9999999999999']) {
      expect(() => parseMoney(bad), bad).toThrow();
    }
  });
  it('avoids floating-point drift: 0.1 + 0.2 == 0.30', () => {
    expect(parseMoney('0.10') + parseMoney('0.20')).toBe(parseMoney('0.30'));
  });
  it('daily rate x workdays (John: $180 x 4 = $720)', () => {
    expect(centsToDecimalString(mulCents(parseMoney('180'), 4))).toBe('720.00');
  });
  it('collective example totals US$1,970.00', () => {
    const total = mulCents(parseMoney('180'), 4) + mulCents(parseMoney('160'), 5) + mulCents(parseMoney('150'), 3);
    expect(centsToDecimalString(total)).toBe('1970.00');
  });
  it('allocates installments exactly (remainder to first)', () => {
    const parts = allocate(10000, 3);
    expect(parts).toEqual([3334, 3333, 3333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10000);
  });
  it('rounds half away from zero', () => {
    expect(roundDiv(5, 2)).toBe(3);
    expect(roundDiv(-5, 2)).toBe(-3);
    expect(roundDiv(4, 3)).toBe(1);
    expect(roundDiv(1, 3)).toBe(0);
  });
});

describe('dates and periods', () => {
  it('validates real calendar dates', () => {
    expect(isDateStr('2026-02-28')).toBe(true);
    expect(isDateStr('2026-02-30')).toBe(false);
    expect(isDateStr('2028-02-29')).toBe(true);
    expect(isDateStr('26-1-1')).toBe(false);
  });
  it('month arithmetic clamps to month end', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
  });
  it('resolves period boundaries (today = Tue 2026-11-10)', () => {
    const t = '2026-11-10';
    expect(resolvePeriod('this_week', t)).toMatchObject({ from: '2026-11-08', to: '2026-11-14' }); // Sun-Sat
    expect(resolvePeriod('last_week', t)).toMatchObject({ from: '2026-11-01', to: '2026-11-07' });
    expect(resolvePeriod('this_month', t)).toMatchObject({ from: '2026-11-01', to: '2026-11-30' });
    expect(resolvePeriod('last_month', t)).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
    expect(resolvePeriod('this_quarter', t)).toMatchObject({ from: '2026-10-01', to: '2026-12-31' });
    expect(resolvePeriod('last_quarter', t)).toMatchObject({ from: '2026-07-01', to: '2026-09-30' });
    expect(resolvePeriod('last_year', t)).toMatchObject({ from: '2025-01-01', to: '2025-12-31' });
    expect(resolvePeriod('yesterday', '2026-03-01')).toMatchObject({ from: '2026-02-28', to: '2026-02-28' });
  });
  it('leap-year and year boundaries', () => {
    expect(resolvePeriod('last_month', '2028-03-15')).toMatchObject({ from: '2028-02-01', to: '2028-02-29' });
    expect(resolvePeriod('last_month', '2026-01-05')).toMatchObject({ from: '2025-12-01', to: '2025-12-31' });
  });
  it('previous period: October vs September, quarter vs quarter', () => {
    expect(previousPeriod(resolvePeriod('last_month', '2026-11-10'))).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
    expect(previousPeriod(resolvePeriod('this_quarter', '2026-11-10'))).toMatchObject({ from: '2026-07-01', to: '2026-09-30' });
    expect(previousPeriod({ kind: 'custom', from: '2026-11-04', to: '2026-11-10' })).toMatchObject({ from: '2026-10-28', to: '2026-11-03' });
  });
  it('rejects invalid custom ranges', () => {
    expect(() => resolvePeriod('custom', '2026-11-10', { from: '2026-12-01', to: '2026-11-01' })).toThrow();
  });
  it('today is computed in the contractor time zone, not UTC', () => {
    const instant = new Date('2026-11-11T02:30:00Z'); // still Nov 10 evening in the US
    expect(todayIn('America/New_York', instant)).toBe('2026-11-10');
    expect(todayIn('America/Los_Angeles', instant)).toBe('2026-11-10');
    expect(todayIn('Europe/London', instant)).toBe('2026-11-11');
    // DST end (Nov 1, 2026): date arithmetic stays calendar-exact
    expect(eachDay('2026-10-31', '2026-11-02')).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
  });
});

describe('phone and WhatsApp links', () => {
  it('normalizes to E.164', () => {
    expect(normalizePhone('(404) 555-1234')).toBe('+14045551234');
    expect(normalizePhone('+55 71 98888-7777')).toBe('+5571988887777');
    expect(normalizePhone('1 404 555 1234')).toBe('+14045551234');
    expect(normalizePhone('0055 71 98888 7777')).toBe('+5571988887777');
  });
  it('rejects invalid numbers', () => {
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('abc')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });
  it('builds wa.me links with optional prefilled text', () => {
    expect(whatsappLink('+14045551234')).toBe('https://wa.me/14045551234');
    expect(whatsappLink('+14045551234', 'Hi John, work Monday?')).toBe('https://wa.me/14045551234?text=Hi%20John%2C%20work%20Monday%3F');
  });
});

describe('states', () => {
  it('has 50 states + DC', () => {
    expect(US_STATES).toHaveLength(51);
    expect(US_STATES.find((s) => s.code === 'DC')).toBeTruthy();
    expect(new Set(US_STATES.map((s) => s.code)).size).toBe(51);
  });
});
