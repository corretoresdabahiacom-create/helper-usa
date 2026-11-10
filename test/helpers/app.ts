import { app } from '../../src/worker/index';
import { TestD1 } from './d1';
import type { Env } from '../../src/worker/core';

export interface Client { call(method: string, path: string, body?: unknown, extra?: { raw?: boolean; headers?: Record<string, string> }): Promise<{ status: number; json: any; res: Response }>; cookie: string | null; }

export function makeEnv(over: Partial<Env> = {}): Env & { DB: any } {
  return { DB: new TestD1() as any, ENVIRONMENT: 'test', DEV_EXPOSE_TOKENS: 'true', ...over } as any;
}
export function client(env: Env, cookie: string | null = null): Client {
  const c: Client = {
    cookie,
    async call(method, path, body, extra) {
      const headers: Record<string, string> = { 'x-hc-csrf': '1', 'content-type': 'application/json', ...(extra?.headers ?? {}) };
      if (c.cookie) headers.cookie = c.cookie;
      const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env);
      const sc = res.headers.get('set-cookie');
      if (sc) { const m = /hc_session=([^;]*)/.exec(sc); c.cookie = m && m[1] ? `hc_session=${m[1]}` : null; }
      let json: any = null;
      if (!extra?.raw && (res.headers.get('content-type') ?? '').includes('json')) json = await res.clone().json();
      return { status: res.status, json, res };
    },
  };
  return c;
}
let n = 0;
/** Register + verify + login a contractor; returns an authenticated client. */
export async function signup(env: Env, over: Record<string, unknown> = {}) {
  const email = (over.email as string) ?? `user${++n}@example.com`;
  const c = client(env);
  const reg = await c.call('POST', '/api/auth/register', { email, password: 'Str0ngPassw0rd', full_name: 'Test User', state: 'TX', city: 'Austin', accept_terms: true, ...over });
  if (reg.status >= 300) throw new Error(`register failed ${reg.status} ${JSON.stringify(reg.json)}`);
  const token = reg.json.dev_token;
  if (token) await c.call('POST', '/api/auth/verify-email', { token });
  const login = await c.call('POST', '/api/auth/login', { email, password: 'Str0ngPassw0rd' });
  if (login.status !== 200) throw new Error(`login failed ${login.status} ${JSON.stringify(login.json)}`);
  return { c, email };
}
