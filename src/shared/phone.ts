/** Normalize a phone number to E.164 ("+14045551234"). Returns null when it cannot be made valid. */
export function normalizePhone(input: string, defaultCountry: '1' | '' = '1'): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;
  const hasPlus = raw.startsWith('+') || raw.startsWith('00');
  let digits = raw.replace(/\D/g, '');
  if (raw.startsWith('00')) digits = digits.slice(2);
  if (!hasPlus) {
    if (defaultCountry === '1') {
      if (digits.length === 10) digits = '1' + digits;
      else if (!(digits.length === 11 && digits.startsWith('1'))) return null;
    } else return null;
  }
  if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return null;
  return '+' + digits;
}

/** wa.me deep link — opens WhatsApp on the user's device. This app never sends WhatsApp messages itself. */
export function whatsappLink(e164: string, text?: string): string {
  const digits = e164.replace(/\D/g, '');
  const base = `https://wa.me/${digits}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
