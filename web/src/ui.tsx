import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError } from './api';
import { useT } from './i18n';

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null); const [error, setError] = useState<ApiError | null>(null); const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(async () => { setLoading(true); try { setData(await fn()); setError(null); } catch (e) { setError(e as ApiError); } setLoading(false); }, deps);
  useEffect(() => { run(); }, [run]);
  return { data, error, loading, reload: run };
}

export function errText(t: (k: string) => string, e: unknown): string {
  if (e instanceof ApiError) {
    const key = `err.${e.code}`; const s = t(key);
    if (s !== key) return s;
    if (e.code === 'validation_error' && e.data?.issues?.length) return e.data.issues.map((i: any) => `${i.path}: ${t(`err.${i.code}`) !== `err.${i.code}` ? t(`err.${i.code}`) : i.code}`).join('; ');
    return t('err.generic');
  }
  return t('err.generic');
}
export function ErrorBox({ error }: { error: unknown }) { const t = useT(); return error ? <div className="alert bad" role="alert">{errText(t, error)}</div> : null; }
export function Alert({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'bad' | 'ok'; children: ReactNode }) { return <div className={`alert ${kind}`} role={kind === 'bad' ? 'alert' : 'status'}>{children}</div>; }
export const Badge = ({ kind = '', children }: { kind?: '' | 'ok' | 'warn' | 'bad'; children: ReactNode }) => <span className={`badge ${kind}`}>{children}</span>;

export function Field({ label, hint, children, id }: { label: string; hint?: string; children: ReactNode; id?: string }) {
  return <div className="field"><label htmlFor={id}>{label}</label>{children}{hint && <div className="hint">{hint}</div>}</div>;
}
export function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'pos' | 'neg' }) {
  return <div className="card kpi"><div className="label">{label}</div><div className={`value ${tone ?? ''}`}>{value}</div>{sub && <div className="sub">{sub}</div>}</div>;
}
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string][] }) {
  return <div className="tabs" role="tablist">{items.map(([k, l]) => <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>)}</div>;
}
export function Loading() { const t = useT(); return <p className="muted" role="status">{t('common.loading')}</p>; }
export const tone = (n: number) => (n < 0 ? 'neg' as const : n > 0 ? 'pos' as const : undefined);

/** Simple grouped bar chart (no chart library). Values are cents. */
export function BarChart({ labels, a, b, aLabel, bLabel }: { labels: string[]; a: number[]; b: number[]; aLabel: string; bLabel: string }) {
  const max = Math.max(1, ...a, ...b); const W = 320; const H = 160; const bw = W / labels.length;
  return (
    <figure style={{ margin: 0 }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label={`${aLabel} / ${bLabel}`}>
        <line className="axis" x1="0" x2={W} y1={H} y2={H} />
        {labels.map((l, i) => {
          const ha = Math.round((a[i]! / max) * (H - 8)); const hb = Math.round((b[i]! / max) * (H - 8)); const x = i * bw;
          return <g key={l}><rect className="bar-in" x={x + bw * .12} y={H - ha} width={bw * .36} height={ha} rx="2"><title>{`${aLabel} ${l}: ${(a[i]! / 100).toFixed(2)}`}</title></rect>
            <rect className="bar-out" x={x + bw * .5} y={H - hb} width={bw * .36} height={hb} rx="2"><title>{`${bLabel} ${l}: ${(b[i]! / 100).toFixed(2)}`}</title></rect>
            <text className="lbl" x={x + bw / 2} y={H + 13} textAnchor="middle">{l.slice(5)}</text></g>;
        })}
      </svg>
      <figcaption className="small row"><span><svg width="10" height="10"><rect className="bar-in" width="10" height="10" /></svg> {aLabel}</span><span><svg width="10" height="10"><rect className="bar-out" width="10" height="10" /></svg> {bLabel}</span></figcaption>
    </figure>
  );
}

/** Currency input: only digits and one decimal separator; the API receives the strict "123.45" string. */
export function MoneyInput({ value, onChange, id, required }: { value: string; onChange: (v: string) => void; id?: string; required?: boolean }) {
  return <input id={id} inputMode="decimal" autoComplete="off" required={required} placeholder="0.00" value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))} />;
}
