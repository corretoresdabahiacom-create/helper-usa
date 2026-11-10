import { useState, type FormEvent } from 'react';
import { Link, Route, Routes, useParams } from 'react-router-dom';
import { get, patch, post } from '../api';
import { fmtDate, fmtMoney } from '../format';
import { useI18n } from '../i18n';
import { useSession } from '../session';
import { Alert, Badge, ErrorBox, Field, Kpi, Loading, tone, useAsync } from '../ui';

export default function Projects() { return <Routes><Route index element={<List />} /><Route path=":id" element={<Detail />} /></Routes>; }

function List() {
  const { t, lang } = useI18n(); const { data, reload, error } = useAsync(() => get('/work/projects'), []);
  const [f, setF] = useState({ name: '', customer: '', location: '', start_date: '' }); const [err, setErr] = useState<unknown>(null);
  async function add(e: FormEvent) { e.preventDefault(); setErr(null); try { await post('/work/projects', { name: f.name, customer: f.customer || null, location: f.location || null, start_date: f.start_date || null }); setF({ name: '', customer: '', location: '', start_date: '' }); reload(); } catch (x) { setErr(x); } }
  return (
    <div className="stack"><h1>{t('nav.projects')}</h1><ErrorBox error={error} />
      <form className="card stack" onSubmit={add}><h2>{t('proj.new')}</h2><div className="grid g2">
        <Field label={t('proj.name')} id="n"><input id="n" required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={t('fin.customer')} id="c"><input id="c" value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} /></Field>
        <Field label={t('sched.location')} id="l"><input id="l" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        <Field label={t('proj.start')} id="s"><input id="s" type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field></div><ErrorBox error={err} /><div><button>{t('common.add')}</button></div></form>
      <div className="card">{!data ? <Loading /> : data.projects.length === 0 ? <p className="muted">{t('common.none')}</p> : data.projects.map((p: any) => <div className="list-item" key={p.id}><div className="grow"><Link to={`/projects/${p.id}`}><b>{p.name}</b></Link><div className="small muted">{p.customer} {p.location} · {fmtDate(p.start_date, lang)}</div></div><Badge>{t(`proj.status.${p.status}`)}</Badge></div>)}</div></div>
  );
}

function Detail() {
  const { id } = useParams(); const { t, lang } = useI18n(); const { me } = useSession(); const cur = me!.profile.currency;
  const p = useAsync(() => get(`/work/projects/${id}`), [id]); const s = useAsync(() => get(`/work/projects/${id}/summary`), [id]); const m = (n: number) => fmtMoney(n, cur, lang);
  if (p.error || s.error) return <ErrorBox error={p.error ?? s.error} />; if (!p.data || !s.data) return <Loading />;
  const d = s.data;
  return (
    <div className="stack"><div className="row between"><h1>{p.data.name}</h1><Link to="/projects">← {t('nav.projects')}</Link></div>
      <div className="row">{['planned', 'active', 'completed', 'canceled'].map((st) => <button key={st} className={p.data.status === st ? '' : 'secondary'} onClick={async () => { await patch(`/work/projects/${id}`, { status: st }); p.reload(); }}>{t(`proj.status.${st}`)}</button>)}</div>
      <div className="grid g3"><Kpi label={t('fin.revenue')} value={m(d.revenue_cents)} sub={`${t('fin.received')}: ${m(d.received_cents)}`} /><Kpi label={t('proj.labor')} value={m(d.direct_labor_cents)} sub={`${t('pay.outstanding')}: ${m(d.labor_payable_cents)}`} /><Kpi label={t('proj.otherCosts')} value={m(d.other_direct_costs_cents + d.allocated_operating_cents)} /><Kpi label={t('proj.result')} value={m(d.result_cents)} tone={tone(d.result_cents)} /></div>
      <Alert>{t('proj.note')}</Alert>
    </div>
  );
}
