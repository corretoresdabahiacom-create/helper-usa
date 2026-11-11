import { HttpError, type Env } from '../core';

/** Cloudflare Turnstile. Disabled (no-op) when TURNSTILE_SECRET is not configured; when configured, a valid token is mandatory. */
export async function verifyTurnstile(env: Env, token: string | undefined, ip: string): Promise<void> {
  if (!env.TURNSTILE_SECRET) return;
  if (!token) throw new HttpError(400, 'captcha_failed');
  let ok = false;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
    });
    ok = res.ok && ((await res.json()) as { success?: boolean }).success === true;
  } catch { ok = false; } // fail closed
  if (!ok) throw new HttpError(400, 'captcha_failed');
}
