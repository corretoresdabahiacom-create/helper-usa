import { describe, expect, it } from 'vitest';
import { app } from '../src/worker/index';
import { client, makeEnv } from './helpers/app';

// Routes that are intentionally reachable without a session. Anything else must answer 401/403, never data.
const PUBLIC = new Set([
  'GET /api/health', 'GET /api/meta',
  'POST /api/auth/register', 'POST /api/auth/verify-email', 'POST /api/auth/login', 'POST /api/auth/forgot-password', 'POST /api/auth/reset-password', 'POST /api/auth/logout',
  'GET /api/portal/:token', 'POST /api/portal/:token/messages', 'POST /api/portal/:token/opt-out', 'GET /api/portal/:token/export',
]);

describe('every API route requires authentication unless explicitly public', () => {
  const routes = [...new Map(app.routes.filter((r) => r.path.startsWith('/api') && r.method !== 'ALL').map((r) => [`${r.method} ${r.path}`, r])).values()];
  it('discovers a meaningful number of routes', () => expect(routes.length).toBeGreaterThan(80));
  it('unauthenticated calls to non-public routes are rejected with 401', async () => {
    const env = makeEnv(); const bad: string[] = [];
    for (const r of routes) {
      const key = `${r.method} ${r.path}`; if (PUBLIC.has(key)) continue;
      const path = r.path.replace(/:[A-Za-z]+/g, '00000000-0000-4000-8000-000000000000');
      const res = await client(env).call(r.method, path, r.method === 'GET' || r.method === 'DELETE' ? undefined : {}, { raw: true });
      if (res.status !== 401) bad.push(`${key} -> ${res.status}`);
    }
    expect(bad).toEqual([]);
  });
  it('mutating calls without the CSRF header are rejected even with a session', async () => {
    const env = makeEnv(); const res = await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, env);
    expect(res.status).toBe(403);
    const cross = await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hc-csrf': '1', origin: 'https://evil.example' }, body: '{}' }, { ...env, APP_ORIGIN: 'https://app.example' });
    expect(cross.status).toBe(403);
  });
  it('API responses carry security headers and never cache', async () => {
    const res = await app.request('/api/health', {}, makeEnv());
    expect(res.headers.get('x-content-type-options')).toBe('nosniff'); expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('cache-control')).toContain('no-store'); expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
  });
});
