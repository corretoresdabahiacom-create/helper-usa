import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { dict, type Lang } from './dict';

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (k: string, v?: Record<string, string | number>) => string }>(null as any);

function initialLang(): Lang {
  try { const s = localStorage.getItem('hc_lang'); if (s === 'en' || s === 'pt' || s === 'es') return s; } catch { /* storage may be unavailable */ }
  const n = (navigator.language || 'en').slice(0, 2);
  return n === 'pt' || n === 'es' ? n : 'en';
}
export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setL] = useState<Lang>(initialLang);
  const setLang = useCallback((l: Lang) => { setL(l); document.documentElement.lang = l; try { localStorage.setItem('hc_lang', l); } catch { /* ignore */ } }, []);
  const t = useCallback((k: string, v?: Record<string, string | number>) => {
    let s = dict[lang][k] ?? dict.en[k] ?? k;
    if (v) for (const [a, b] of Object.entries(v)) s = s.replace(`{${a}}`, String(b));
    return s;
  }, [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useI18n = () => useContext(Ctx);
export const useT = () => useContext(Ctx).t;
