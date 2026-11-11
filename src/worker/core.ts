import type { Context, MiddlewareHandler } from 'hono';
import { z, ZodError, type ZodTypeAny } from 'zod';
import { isDateStr, todayIn } from '../shared/dates';
import { parseMoney } from '../shared/money';

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  AI?: { run(model: string, input: unknown): Promise<unknown> };
  ATTACHMENTS?: R2Bucket;
  ENVIRONMENT?: string;
  APP_ORIGIN?: string;
  DEV_EXPOSE_TOKENS?: string;
  CLOCK_OVERRIDE?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  MAX_BULK_RECIPIENTS?: string;
  TURNSTILE_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  TOTP_ENC_KEY?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  status: string;
  sessionId: string;
  isAdmin: boolean;
  adminRole: string | null;
  profile: {
    full_name: string; business_name: string | null; language: 'en' | 'pt' | 'es';
    timezone: string; currency: string; accounting_basis: 'accrual' | 'cash';
    state: string | null; city: string | null; country: string;
    opening_cash_cents: number; opening_cash_date: string | null;
  };
}
export type Vars = { user: AuthUser; now: Date };
export type Ctx = Context<{ Bindings: Env; Variables: Vars }>;

export class HttpError extends Error {
  constructor(public status: number, public code: string, public extra?: Record<string, unknown>) {
    super(code);
  }
}
export const notFound = () => new HttpError(404, 'not_found');

export const newId = () => crypto.randomUUID();

/** Server clock. CLOCK_OVERRIDE is honored only outside production (used by expiry tests). */
export function getNow(env: Env): Date {
  if (env.CLOCK_OVERRIDE && env.ENVIRONMENT !== 'production') {
    const d = new Date(env.CLOCK_OVERRIDE);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}
export const iso = (d: Date) => d.toISOString();
export const nowIso = (c: Ctx) => iso(c.get('now'));
export const todayOf = (c: Ctx) => todayIn(c.get('user').profile.timezone, c.get('now'));
export const uid = (c: Ctx) => c.get('user').id;

export function clientIp(c: { req: { header(n: string): string | undefined } }): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}

// ───── validation helpers ─────
export const dateStr = z.string().refine(isDateStr, 'invalid_date');
export const moneyStr = z.string().transform((s, ctx) => {
  try { return parseMoney(s); } catch { ctx.addIssue({ code: 'custom', message: 'invalid_amount' }); return z.NEVER; }
});
export const currencyCode = z.enum(['USD', 'EUR', 'BRL', 'CAD', 'MXN']);
export const lang3 = z.enum(['en', 'pt', 'es']);
export const payMethod = z.enum(['cash', 'bank_transfer', 'check', 'zelle', 'card', 'other']);
const text = (max: number) => z.string().trim().max(max);
export const shortText = (min = 1, max = 200) => z.string().trim().min(min).max(max);
/** Optional text: omitted stays undefined (partial updates keep data); empty string/null become null (clear). */
export const optText = (max = 2000) =>
  text(max).nullish().transform((v) => (v === undefined ? undefined : v ? v : null));
export const uuid = z.string().uuid();

export const MAX_JSON_BYTES = 256 * 1024;

export async function parseBody<T extends ZodTypeAny>(c: Ctx, schema: T): Promise<z.infer<T>> {
  let data: unknown;
  // JSON bodies are capped (256 KB) before parsing to bound memory/CPU on hostile input; file uploads use their own 5 MB check.
  const declared = Number(c.req.header('content-length') ?? 0);
  if (declared > MAX_JSON_BYTES) throw new HttpError(413, 'payload_too_large');
  const text = await c.req.text();
  if (text.length > MAX_JSON_BYTES) throw new HttpError(413, 'payload_too_large');
  try { data = JSON.parse(text); } catch { throw new HttpError(400, 'invalid_json'); }
  return parseWith(schema, data);
}
export function parseWith<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  try { return schema.parse(data); } catch (e) {
    if (e instanceof ZodError) {
      throw new HttpError(400, 'validation_error', {
        issues: e.issues.map((i) => ({ path: i.path.join('.'), code: i.message || i.code })),
      });
    }
    throw e;
  }
}

// ───── audit ─────
export function auditStmt(db: D1Database, a: {
  scope: 'security' | 'financial' | 'admin' | 'data'; ownerId?: string | null; actorId?: string | null;
  action: string; entity?: string; entityId?: string; details?: unknown; at: string;
}) {
  return db.prepare(
    'INSERT INTO audit_logs (id, scope, owner_id, actor_id, action, entity, entity_id, details, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
  ).bind(newId(), a.scope, a.ownerId ?? null, a.actorId ?? null, a.action, a.entity ?? null, a.entityId ?? null,
    a.details === undefined ? null : JSON.stringify(a.details), a.at);
}
export const audit = (c: Ctx, scope: 'security' | 'financial' | 'admin' | 'data', action: string, entity?: string, entityId?: string, details?: unknown) =>
  auditStmt(c.env.DB, { scope, ownerId: c.get('user')?.id, actorId: c.get('user')?.id, action, entity, entityId, details, at: nowIso(c) });

// ───── crypto ─────
const enc = new TextEncoder();
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
const PBKDF2_ITER = 100_000; // Workers' maximum supported PBKDF2 iteration count

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITER }, key, 256);
  return `pbkdf2$${PBKDF2_ITER}$${b64(salt)}$${b64(bits)}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, iter, saltB64, hashB64] = stored.split('$');
  if (alg !== 'pbkdf2') return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations: Number(iter) }, key, 256));
  const expected = unb64(hashB64);
  let diff = bits.length ^ expected.length;
  for (let i = 0; i < bits.length; i++) diff |= bits[i] ^ (expected[i] ?? 0);
  return diff === 0;
}
export function randomToken(bytes = 32): string {
  return b64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export function passwordStrongEnough(p: string) {
  return p.length >= 10 && p.length <= 200 && /[A-Za-z]/.test(p) && /\d/.test(p);
}

// ───── rate limiting (fixed window in D1) ─────
export async function rateLimit(c: { env: Env; get: Ctx['get'] }, scope: string, key: string, limit: number, windowSec: number) {
  const now = getNow(c.env).getTime();
  const windowStart = Math.floor(now / (windowSec * 1000));
  const k = `${scope}:${key}`;
  const row = await c.env.DB.prepare(
    'INSERT INTO rate_limits (key, window_start, count) VALUES (?,?,1) ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1 RETURNING count',
  ).bind(k, windowStart).first<{ count: number }>();
  if ((row?.count ?? 1) > limit) throw new HttpError(429, 'rate_limited', { retry_after: windowSec });
}

// ───── middleware ─────
export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Frame-Options', 'DENY');
  c.header('Cache-Control', 'no-store');
  c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
};

/** CSRF: SameSite=Strict cookie + custom header required on state-changing calls + Origin check when present. */
export const csrfGuard: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const m = c.req.method;
  if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
    if (c.req.header('x-hc-csrf') !== '1') throw new HttpError(403, 'csrf_failed');
    const origin = c.req.header('origin');
    if (origin) {
      const allowed = new Set([new URL(c.req.url).origin]);
      if (c.env.APP_ORIGIN) allowed.add(c.env.APP_ORIGIN);
      if (!allowed.has(origin)) throw new HttpError(403, 'csrf_failed');
    }
  }
  await next();
};

export const SESSION_COOKIE = 'hc_session';
export function cookieHeader(token: string, maxAgeSec: number, secure: boolean) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`;
}
export const isSecureReq = (c: Ctx | { req: { url: string } }) => new URL(c.req.url).protocol === 'https:';

export const dbRun = (db: D1Database, sql: string, ...p: unknown[]) => db.prepare(sql).bind(...p);

/** Convert DB guard-trigger aborts into API errors. */
export function mapDbError(e: unknown): never {
  const msg = String((e as Error)?.message ?? e);
  if (msg.includes('workday_overpaid')) throw new HttpError(409, 'exceeds_outstanding');
  if (msg.includes('receivable_overpaid') || msg.includes('expense_overpaid')) throw new HttpError(409, 'exceeds_outstanding');
  if (msg.includes('UNIQUE') && msg.includes('workdays')) throw new HttpError(409, 'workday_conflict');
  if (msg.includes('UNIQUE') && msg.includes('idempotency')) throw new HttpError(409, 'duplicate_payment');
  if (msg.includes('FOREIGN KEY')) throw new HttpError(409, 'reference_conflict');
  throw e;
}
