import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { get, post } from './api';

export interface Me { id: string; email: string; is_admin: boolean; profile: { full_name: string; business_name: string | null; language: 'en' | 'pt' | 'es'; timezone: string; currency: string; accounting_basis: 'accrual' | 'cash'; state: string | null; city: string | null; opening_cash_cents: number; opening_cash_date: string | null } }
interface S { me: Me | null; loading: boolean; refresh: () => Promise<void>; logout: () => Promise<void>; meta: any }
const C = createContext<S>(null as any);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null); const [loading, setLoading] = useState(true); const [meta, setMeta] = useState<any>(null);
  const refresh = useCallback(async () => {
    try { const r = await get('/auth/me'); setMe(r.user ?? r); } catch { setMe(null); }
    setLoading(false);
  }, []);
  useEffect(() => { refresh(); get('/meta').then(setMeta).catch(() => {}); const h = () => setMe(null); window.addEventListener('hc:unauth', h); return () => window.removeEventListener('hc:unauth', h); }, [refresh]);
  const logout = useCallback(async () => { try { await post('/auth/logout'); } finally { setMe(null); } }, []);
  return <C.Provider value={{ me, loading, refresh, logout, meta }}>{children}</C.Provider>;
}
export const useSession = () => useContext(C);
