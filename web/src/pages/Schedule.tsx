import { useMemo, useState, type FormEvent } from 'react';
import { Link, NavLink, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import { get, patch, post } from '../api';
import { addDaysStr, fmtDate, fmtMoney, normalizeMoneyInput, today } from '../format';
import { useI18n } from '../i18n';
import { useSession } from '../session';
import { Alert, Badge, ErrorBox, Field, Kpi, Loading, MoneyInput, useAsync } from '../ui';
import { defaultPeriod, PeriodSelector, periodQuery, periodReady, type PeriodState } from '../components/Period';

const STATUS_KIND: Record<string, '' | 'ok' | 'warn' | 'bad'> = { scheduled: '', confirmed: 'warn', completed: 'ok', absent: 'bad', canceled: 'bad' };

export default function Schedule() {
  const { t } = useI18n();
  return (
    <div className="stack">
      <nav className="tabs" aria-label={t('nav.schedule')}><NavLink end to="/schedule">{t('sched.workdays')}</NavLink><NavLink to="/schedule/new">{t('sched.new')}</NavLink><NavLink to="/schedule/pay">{t('pay.title')}</NavLink><NavLink to="/schedule/report">{t('work.report')}</NavLink></nav>
      <Routes><Route index element={<Workdays />} /><Route path="new" element={<NewAssignment />} /><Route path="pay" element={<Pay />} /><Route path="report" element={<WorkReport />} /></Routes>
    </div>
  );
}

function Workdays() {
  const { t, lang } = useI18n(); const { me } = useSession(); const [sp] = useSearchParams();
  const [from, setFrom] = useState(addDaysStr(today(me!.profile.timezone), -7)); const [to, setTo] = useState(addDaysStr(today(me!.profile.timezone), 30));
  const [helper, setHelper] = useState(sp.get('helper') ?? ''); const [status, setStatus] = useState('');
  const hl = useAsync(() => get('/helpers'), []);
  const q = `/work/workdays?from=${from}&to=${to}${helper ? `&helper_id=${helper}` : ''}${status ? `&status=${status}` : ''}`;
  const { data, error, loading, reload } = useAsync(() => get(q), [q]);
  const [err, setErr] = useState<unknown>(null); const [sel, setSel] = useState<string[]>([]);
  const todayStr = today(me!.profile.timezone);
  async function setStatusFor(id: string, st: string) {
    setErr(null); let reason: string | undefined;
    const wd = data.workdays.find((w: any) => w.id === id);
    if (wd && ['completed', 'absent'].includes(wd.status)) { reason = prompt(t('sched.reasonPrompt')) ?? undefined; if (!reason) return; }
    try { await patch(`/work/workdays/${id}`, { status: st, adjustment_reason: reason }); reload(); } catch (x) { setErr(x); }
  }
  async function bulk(st: string) { setErr(null); try { const r = await post('/work/workdays/bulk-status', { ids: sel, status: st }); const failed = r.results.filter((x: any) => !x.ok); if (failed.length) setErr({ code: failed[0].error }); setSel([]); reload(); } catch (x) { setErr(x); } }
  return (
    <div className="stack">
      <div className="card"><div className="grid g3">
        <Field label={t('period.from')} id="f"><input id="f" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label={t('period.to')} id="t"><input id="t" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label={t('nav.helpers')} id="h"><select id="h" value={helper} onChange={(e) => setHelper(e.target.value)}><option value="">{t('common.all')}</option>{hl.data?.helpers.map((h: any) => <option key={h.id} value={h.id}>{h.full_name}</option>)}</select></Field>
        <Field label={t('common.status')} id="s"><select id="s" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{t('common.all')}</option>{Object.keys(STATUS_KIND).map((s) => <option key={s} value={s}>{t(`wd.${s}`)}</option>)}</select></Field></div></div>
      <ErrorBox error={error ?? err} />
      {sel.length > 0 && <div className="row card"><b>{sel.length}</b><button className="small" onClick={() => bulk('confirmed')}>{t('wd.confirmed')}</button><button className="small" onClick={() => bulk('completed')}>{t('wd.completed')}</button><button className="small danger" onClick={() => bulk('absent')}>{t('wd.absent')}</button></div>}
      {loading && !data ? <Loading /> : <div className="card tablewrap"><table>
        <thead><tr><th /><th>{t('common.date')}</th><th>{t('nav.helpers')}</th><th>{t('sched.job')}</th><th className="num">{t('sched.rate')}</th><th>{t('common.status')}</th><th>{t('pay.status')}</th><th /></tr></thead>
        <tbody>{data?.workdays.length === 0 && <tr><td colSpan={8} className="muted">{t('common.none')}</td></tr>}
          {data?.workdays.map((w: any) => (
            <tr key={w.id}>
              <td><input type="checkbox" aria-label="select" checked={sel.includes(w.id)} onChange={(e) => setSel(e.target.checked ? [...sel, w.id] : sel.filter((x) => x !== w.id))} /></td>
              <td className="nowrap">{fmtDate(w.work_date, lang)}</td><td>{w.helper_name}</td><td>{w.job_name}</td>
              <td className="num">{fmtMoney(w.effective_cents, w.currency, lang)}{w.amount_override_cents != null && <div className="small muted" title={w.adjustment_reason}>{t('sched.adjusted')}</div>}</td>
              <td><Badge kind={STATUS_KIND[w.status]}>{t(`wd.${w.status}`)}</Badge></td>
              <td>{w.payment_status === 'none' ? '—' : <Badge kind={w.payment_status === 'paid' ? 'ok' : w.payment_status === 'partial' ? 'warn' : 'bad'}>{t(`pay.${w.payment_status}`)}</Badge>}</td>
              <td className="nowrap">{w.status === 'scheduled' && <button className="small secondary" onClick={() => setStatusFor(w.id, 'confirmed')}>{t('wd.confirm')}</button>}{' '}
                {['scheduled', 'confirmed'].includes(w.status) && w.work_date <= todayStr && <button className="small" onClick={() => setStatusFor(w.id, 'completed')}>{t('wd.complete')}</button>}{' '}
                {['scheduled', 'confirmed'].includes(w.status) && w.work_date <= todayStr && <button className="small secondary" onClick={() => setStatusFor(w.id, 'absent')}>{t('wd.markAbsent')}</button>}{' '}
                {['scheduled', 'confirmed'].includes(w.status) && <button className="small secondary" onClick={() => setStatusFor(w.id, 'canceled')}>{t('common.cancel')}</button>}</td>
            </tr>))}</tbody></table></div>}
      <p className="small muted">{t('sched.payableNote')}</p>
    </div>
  );
}

function NewAssignment() {
  const { t, lang } = useI18n(); const { me } = useSession(); const nav = useNavigate(); const [sp] = useSearchParams(); const cur = me!.profile.currency;
  const hl = useAsync(() => get('/helpers'), []); const pl = useAsync(() => get('/work/projects'), []);
  const [f, setF] = useState({ helper_id: sp.get('helper') ?? '', project_id: '', job_name: '', location: '', city: '', daily_rate: '', details: '' });
  const [dates, setDates] = useState<string[]>([]); const [pick, setPick] = useState(''); const [rf, setRf] = useState(''); const [rt, setRt] = useState(''); const [weekdays, setWeekdays] = useState(true);
  const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const rate = normalizeMoneyInput(f.daily_rate);
  const total = useMemo(() => (rate ? Math.round(Number(rate.replace('.', ''))) * dates.length : 0), [rate, dates]);
  const addRange = () => { if (!rf || !rt || rf > rt) return; const out = new Set(dates); for (let d = rf; d <= rt; d = addDaysStr(d, 1)) { const dow = new Date(`${d}T00:00:00Z`).getUTCDay(); if (!weekdays || (dow !== 0 && dow !== 6)) out.add(d); } setDates([...out].sort()); };
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null); if (!rate) { setErr({ code: 'invalid_money' }); return; } setBusy(true);
    try { await post('/work/assignments', { helper_id: f.helper_id, project_id: f.project_id || null, job_name: f.job_name, location: f.location || null, city: f.city || undefined, daily_rate: rate, dates, details: f.details || null }); nav('/schedule'); } catch (x) { setErr(x); }
    setBusy(false);
  }
  return (
    <form className="stack" onSubmit={submit}>
      <h1>{t('sched.new')}</h1>
      <div className="card"><div className="grid g2">
        <Field label={t('nav.helpers')} id="h"><select id="h" required value={f.helper_id} onChange={(e) => setF({ ...f, helper_id: e.target.value })}><option value="">—</option>{hl.data?.helpers.map((h: any) => <option key={h.id} value={h.id}>{h.full_name}</option>)}</select></Field>
        <Field label={t('nav.projects')} id="p"><select id="p" value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}><option value="">—</option>{pl.data?.projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label={t('sched.job')} id="j"><input id="j" required value={f.job_name} onChange={(e) => setF({ ...f, job_name: e.target.value })} /></Field>
        <Field label={`${t('sched.rate')} (${cur})`} id="r"><MoneyInput id="r" required value={f.daily_rate} onChange={(v) => setF({ ...f, daily_rate: v })} /></Field>
        <Field label={t('sched.location')} id="l"><input id="l" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        <Field label={t('common.city')} id="c"><input id="c" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field></div>
        <Field label={t('sched.details')} id="d"><textarea id="d" value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} /></Field></div>
      <div className="card stack"><h2>{t('sched.days')}</h2><p className="small muted">{t('sched.daysHint')}</p>
        <div className="row"><input type="date" aria-label={t('common.date')} value={pick} onChange={(e) => setPick(e.target.value)} style={{ width: 'auto' }} /><button type="button" className="secondary" onClick={() => { if (pick && !dates.includes(pick)) setDates([...dates, pick].sort()); }}>{t('common.add')}</button></div>
        <div className="row"><input type="date" aria-label={t('period.from')} value={rf} onChange={(e) => setRf(e.target.value)} style={{ width: 'auto' }} /><input type="date" aria-label={t('period.to')} value={rt} onChange={(e) => setRt(e.target.value)} style={{ width: 'auto' }} /><label><input type="checkbox" checked={weekdays} onChange={(e) => setWeekdays(e.target.checked)} /> {t('sched.weekdaysOnly')}</label><button type="button" className="secondary" onClick={addRange}>{t('sched.addRange')}</button></div>
        <div className="row">{dates.map((d) => <button type="button" key={d} className="secondary small" onClick={() => setDates(dates.filter((x) => x !== d))} aria-label={`${t('common.delete')} ${d}`}>{fmtDate(d, lang)} ✕</button>)}</div>
        <p><b>{dates.length}</b> {t('sched.daysSelected')} · {t('sched.total')}: <b>{fmtMoney(total, cur, lang)}</b></p></div>
      <ErrorBox error={err} /><div><button disabled={busy || dates.length === 0}>{t('common.save')}</button></div>
    </form>
  );
}

function Pay() {
  const { t, lang } = useI18n(); const { me, meta } = useSession(); const cur = me!.profile.currency;
  const [p, setP] = useState<PeriodState>({ ...defaultPeriod, period: 'this_year' });
  const { data, error, reload } = useAsync(() => (periodReady(p) ? get(`/work/helper-payments/summary?${p.period === 'custom' ? `from=${p.from}&to=${p.to}` : ''}`) : Promise.resolve(null)), [p]);
  const hist = useAsync(() => get('/work/helper-payments'), []);
  const [form, setForm] = useState<{ helper_id: string; amount: string; method: string; date: string } | null>(null); const [err, setErr] = useState<unknown>(null); const [key, setKey] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null); const amt = normalizeMoneyInput(form!.amount); if (!amt) { setErr({ code: 'invalid_money' }); return; }
    try { await post('/work/helper-payments', { helper_id: form!.helper_id, amount: amt, paid_date: form!.date, method: form!.method, idempotency_key: key, ...(p.period === 'custom' ? { from: p.from, to: p.to } : {}) }); setForm(null); reload(); hist.reload(); } catch (x) { setErr(x); }
  }
  async function voidPay(id: string) { const reason = prompt(t('pay.voidReason')); if (!reason) return; try { await post(`/work/helper-payments/${id}/void`, { reason }); reload(); hist.reload(); } catch (x) { setErr(x); } }
  return (
    <div className="stack">
      <Alert kind="info">{t('pay.note')}</Alert>
      <PeriodSelector value={p} onChange={setP} /><ErrorBox error={error} />
      {data && <><div className="grid g3"><Kpi label={t('pay.due')} value={fmtMoney(data.totals.due_cents, cur, lang)} /><Kpi label={t('pay.paid')} value={fmtMoney(data.totals.paid_cents, cur, lang)} /><Kpi label={t('pay.outstanding')} value={fmtMoney(data.totals.outstanding_cents, cur, lang)} tone={data.totals.outstanding_cents > 0 ? 'neg' : undefined} /></div>
        <div className="card tablewrap"><table><thead><tr><th>{t('nav.helpers')}</th><th className="num">{t('work.days')}</th><th className="num">{t('pay.due')}</th><th className="num">{t('pay.paid')}</th><th className="num">{t('pay.outstanding')}</th><th /></tr></thead><tbody>
          {data.helpers.length === 0 && <tr><td colSpan={6} className="muted">{t('common.none')}</td></tr>}
          {data.helpers.map((h: any) => <tr key={h.helper_id}><td>{h.helper_name}<div className="small muted">{h.oldest_unpaid ? `${t('pay.oldest')}: ${fmtDate(h.oldest_unpaid, lang)}` : ''}</div></td><td className="num">{h.days}</td><td className="num">{fmtMoney(h.due_cents, cur, lang)}</td><td className="num">{fmtMoney(h.paid_cents, cur, lang)}</td><td className="num"><b>{fmtMoney(h.outstanding_cents, cur, lang)}</b></td>
            <td>{h.outstanding_cents > 0 && <button className="small" onClick={() => { setKey(crypto.randomUUID()); setForm({ helper_id: h.helper_id, amount: (h.outstanding_cents / 100).toFixed(2), method: 'zelle', date: today(me!.profile.timezone) }); }}>{t('pay.record')}</button>}</td></tr>)}</tbody></table></div></>}
      {form && <form className="card stack" onSubmit={submit}><h2>{t('pay.record')}</h2><div className="grid g3">
        <Field label={`${t('common.amount')} (${cur})`} hint={t('pay.partialHint')} id="a"><MoneyInput id="a" required value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} /></Field>
        <Field label={t('pay.method')} id="m"><select id="m" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>{(meta?.payment_methods ?? []).map((m: string) => <option key={m} value={m}>{t(`method.${m}`)}</option>)}</select></Field>
        <Field label={t('common.date')} id="d"><input id="d" type="date" required max={today(me!.profile.timezone)} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field></div>
        <ErrorBox error={err} /><div className="row"><button>{t('common.save')}</button><button type="button" className="secondary" onClick={() => setForm(null)}>{t('common.cancel')}</button></div></form>}
      <ErrorBox error={err} />
      <div className="card"><h2>{t('pay.history')}</h2>{hist.data?.payments.length === 0 && <p className="muted">{t('common.none')}</p>}
        {hist.data?.payments.map((x: any) => <div className="list-item" key={x.id} style={{ opacity: x.voided_at ? .5 : 1 }}><div className="grow"><b>{x.helper_name}</b><div className="small muted">{fmtDate(x.paid_date, lang)} · {t(`method.${x.method}`)} {x.voided_at && <Badge kind="bad">{t('common.voided')}</Badge>}</div></div><b>{fmtMoney(x.amount_cents, x.currency, lang)}</b>{!x.voided_at && <button className="small secondary" onClick={() => voidPay(x.id)}>{t('common.void')}</button>}</div>)}</div>
    </div>
  );
}

function WorkReport() {
  const { t, lang } = useI18n(); const { me } = useSession(); const cur = me!.profile.currency;
  const [p, setP] = useState<PeriodState>(defaultPeriod); const [helper, setHelper] = useState(''); const hl = useAsync(() => get('/helpers'), []);
  const qs = `${periodQuery(p)}${helper ? `&helper_ids=${helper}` : ''}`;
  const { data, error, loading } = useAsync(() => (periodReady(p) ? get(`/reports/work?${qs}`) : Promise.resolve(null)), [qs]);
  const dl = async (fmt: 'csv' | 'pdf') => { const { download } = await import('../api'); await download(`/reports/work?${qs}&format=${fmt}`, `work-report.${fmt}`); };
  return (
    <div className="stack"><div className="row between"><PeriodSelector value={p} onChange={setP} />
      <select aria-label={t('nav.helpers')} value={helper} onChange={(e) => setHelper(e.target.value)} style={{ width: 'auto' }}><option value="">{t('work.allHelpers')}</option>{hl.data?.helpers.map((h: any) => <option key={h.id} value={h.id}>{h.full_name}</option>)}</select>
      <div className="row"><button className="secondary small" onClick={() => dl('csv')}>CSV</button><button className="secondary small" onClick={() => dl('pdf')}>PDF</button></div></div>
      <ErrorBox error={error} />{loading && !data ? <Loading /> : data && <>
        <div className="card tablewrap"><table><thead><tr><th>{t('nav.helpers')}</th><th className="num">{t('work.days')}</th><th>{t('work.rates')}</th><th className="num">{t('pay.due')}</th><th className="num">{t('pay.paid')}</th><th className="num">{t('pay.outstanding')}</th><th>{t('common.status')}</th></tr></thead><tbody>
          {data.by_helper.map((g: any) => <tr key={g.helper_id + g.currency}><td>{g.helper_name}</td><td className="num">{g.days}</td><td>{g.rates_cents.map((r: number) => fmtMoney(r, g.currency, lang)).join(', ')}</td><td className="num">{fmtMoney(g.total_cents, g.currency, lang)}</td><td className="num">{fmtMoney(g.paid_cents, g.currency, lang)}</td><td className="num">{fmtMoney(g.remaining_cents, g.currency, lang)}</td><td><Badge kind={g.payment_status === 'paid' ? 'ok' : g.payment_status === 'partial' ? 'warn' : 'bad'}>{t(`pay.${g.payment_status}`)}</Badge></td></tr>)}
          {data.by_helper.length === 0 && <tr><td colSpan={7} className="muted">{t('common.none')}</td></tr>}</tbody>
          <tfoot>{Object.entries(data.totals).map(([c, tt]: any) => <tr key={c}><th>{t('common.total')} {c}</th><th className="num">{tt.days}</th><th /><th className="num">{fmtMoney(tt.total_cents, c, lang)}</th><th className="num">{fmtMoney(tt.paid_cents, c, lang)}</th><th className="num">{fmtMoney(tt.remaining_cents, c, lang)}</th><th /></tr>)}</tfoot></table></div>
        <p className="small muted">{Object.entries(data.status_counts).map(([s, n]) => `${t(`wd.${s}`)}: ${n}`).join(' · ')} — {t('sched.payableNote')}</p></>}
      <p className="small muted">{cur}</p></div>
  );
}
