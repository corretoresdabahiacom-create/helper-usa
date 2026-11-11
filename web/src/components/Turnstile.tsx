import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '../session';

declare global { interface Window { turnstile?: any } }
const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<void> | null = null;
function load(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  loading ??= new Promise((res, rej) => { const s = document.createElement('script'); s.src = SRC; s.async = true; s.onload = () => res(); s.onerror = () => { loading = null; rej(new Error('turnstile')); }; document.head.appendChild(s); });
  return loading;
}

/** Cloudflare Turnstile widget. Renders nothing unless the server reports a site key (meta.turnstile_site_key). */
export function useTurnstile() {
  const { meta } = useSession(); const key = meta?.turnstile_site_key as string | null | undefined;
  const [token, setToken] = useState(''); const ref = useRef<HTMLDivElement>(null); const id = useRef<any>(null);
  useEffect(() => {
    if (!key || !ref.current) return; let dead = false;
    load().then(() => { if (dead || !ref.current) return; id.current = window.turnstile.render(ref.current, { sitekey: key, callback: (t: string) => setToken(t), 'expired-callback': () => setToken(''), 'error-callback': () => setToken('') }); }).catch(() => {});
    return () => { dead = true; if (id.current !== null) { try { window.turnstile?.remove(id.current); } catch { /* ignore */ } id.current = null; } };
  }, [key]);
  const reset = useCallback(() => { setToken(''); try { if (id.current !== null) window.turnstile?.reset(id.current); } catch { /* ignore */ } }, []);
  return { enabled: !!key, token, reset, widget: key ? <div ref={ref} style={{ margin: '.5rem 0' }} /> : null };
}
