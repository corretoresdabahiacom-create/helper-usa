// RFC 6238 TOTP (SHA-1, 6 digits, 30s) + AES-GCM secret encryption, WebCrypto only.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string) {
  const clean = s.replace(/=+$/, '').toUpperCase(); let bits = 0, value = 0; const out: number[] = [];
  for (const ch of clean) { const i = B32.indexOf(ch); if (i < 0) throw new Error('bad base32'); value = (value << 5) | i; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return new Uint8Array(out);
}
export const newTotpSecret = () => base32Encode(crypto.getRandomValues(new Uint8Array(20)));

async function hotp(secret: string, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', base32Decode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const buf = new ArrayBuffer(8); const dv = new DataView(buf); dv.setUint32(0, Math.floor(counter / 2 ** 32)); dv.setUint32(4, counter >>> 0);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf)); const o = h[19]! & 15;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, '0');
}
export const totpAt = (secret: string, ms: number) => hotp(secret, Math.floor(ms / 30000));

/** Returns the matched time step (for replay protection) or null. Accepts ±1 step of clock drift; a step <= lastStep is rejected. */
export async function verifyTotp(secret: string, code: string, nowMs: number, lastStep = 0): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const cur = Math.floor(nowMs / 30000);
  for (const step of [cur, cur - 1, cur + 1]) {
    if (step <= lastStep) continue;
    const exp = await hotp(secret, step);
    let diff = 0; for (let i = 0; i < 6; i++) diff |= exp.charCodeAt(i) ^ code.charCodeAt(i); // constant-time compare
    if (diff === 0) return step;
  }
  return null;
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function aesKey(keyB64: string) {
  const raw = unb64(keyB64); if (raw.length !== 32) throw new Error('TOTP_ENC_KEY must be 32 bytes base64');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encryptSecret(plain: string, keyB64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(keyB64), new TextEncoder().encode(plain)));
  return `${b64(iv)}.${b64(ct)}`;
}
export async function decryptSecret(stored: string, keyB64: string): Promise<string> {
  const [iv, ct] = stored.split('.') as [string, string];
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(keyB64), unb64(ct)));
}
export function newRecoveryCode(): string {
  const a = base32Encode(crypto.getRandomValues(new Uint8Array(7))).slice(0, 10).toLowerCase();
  return `${a.slice(0, 5)}-${a.slice(5)}`;
}
export const otpauthUri = (email: string, secret: string) => `otpauth://totp/Helper%20Connect:${encodeURIComponent(email)}?secret=${secret}&issuer=Helper%20Connect&algorithm=SHA1&digits=6&period=30`;
