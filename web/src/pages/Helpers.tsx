import { useState, type FormEvent } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { get, patch, post, put, del } from '../api';
import { fmtDate, fmtDateTime, fmtMoney, normalizeMoneyInput } from '../format';
import { useI18n } from '../i18n';
import { useSession } from '../session';
import { Alert, Badge, ErrorBox, Field, Loading, MoneyInput, Tabs, useAsync } from '../ui';

export function catName(c: any, lang: string) { return c?.[`name_${lang}`] ?? c?.name_en ?? ''; }

export default function Helpers() {
  return <Routes><Route index element={<List />} /><Route path="new" element={<Form />} /><Route path=":id" element={<Detail />} /><Route path=":id/edit" element={<Form />} /></Routes>;
}

function List() {
  const { t, lang } = useI18n(); const { meta } = useSession();
  const [f, setF] = useState({ q: '', state: '', category_id: '', favorite: false, archived: false });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v).map(([k, v]) => [k, v === true ? '1' : String(v)])).toString();
  const { data, error, loading, reload } = useAsync(() => get(`/helpers?${qs}`), [qs]);
  const catById = new Map<string, any>((meta?.categories ?? []).map((c: any) => [c.id, c]));
  return (
    <div className="stack">
      <div className="row between"><h1>{t('nav.helpers')}</h1><Link className="btn" to="/helpers/new">+ {t('helpers.new')}</Link></div>
      <Alert>{t('helpers.privateNote')}</Alert>
      <div className="card"><div className="grid g3">
        <Field label={t('common.search')} id="q"><input id="q" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></Field>
        <Field label={t('common.state')} id="s"><select id="s" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}><option value="">{t('common.all')}</option>{(meta?.states ?? []).map((s: any) => <option key={s.code} value={s.code}>{s.name}</option>)}</select></Field>
        <Field label={t('helpers.category')} id="c"><select id="c" value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}><option value="">{t('common.all')}</option>{(meta?.categories ?? []).map((c: any) => <option key={c.id} value={c.id}>{catName(c, lang)}</option>)}</select></Field>
      </div>
        <div className="row"><label><input type="checkbox" checked={f.favorite} onChange={(e) => setF({ ...f, favorite: e.target.checked })} /> {t('helpers.favorites')}</label><label><input type="checkbox" checked={f.archived} onChange={(e) => setF({ ...f, archived: e.target.checked })} /> {t('helpers.archived')}</label></div></div>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : (
        <div className="card">{data?.helpers.length === 0 && <p className="muted">{t('helpers.empty')}</p>}
          {data?.helpers.map((h: any) => (
            <div className="list-item" key={h.id}>
              <button className="secondary small" aria-label={t('helpers.favorite')} aria-pressed={!!h.favorite} onClick={async () => { await post(`/helpers/${h.id}/favorite`, { favorite: !h.favorite }); reload(); }}>{h.favorite ? '★' : '☆'}</button>
              <div className="grow"><Link to={`/helpers/${h.id}`}><b>{h.full_name}</b></Link><div className="small muted">{h.function_title} · {h.city}, {h.state} · {catName(catById.get(h.main_category_id), lang)}</div>
                <div className="small">{h.opted_out ? <Badge kind="bad">{t('helpers.optedOut')}</Badge> : h.messaging_consent === 'granted' ? <Badge kind="ok">{t('helpers.consent')}</Badge> : <Badge>{t('helpers.noConsent')}</Badge>} {h.eval_overall ? <Badge>★ {h.eval_overall}/5</Badge> : null}</div></div>
              <Link className="btn secondary small" to={`/messages/${h.id}`}>{t('nav.messages')}</Link>
            </div>))}
        </div>)}
    </div>
  );
}

function Form() {
  const { id } = useParams(); const { t, lang } = useI18n(); const { meta } = useSession(); const nav = useNavigate();
  const { data: existing, loading } = useAsync(() => (id ? get(`/helpers/${id}`) : Promise.resolve(null)), [id]);
  const [f, setF] = useState<any>(null); const [err, setErr] = useState<unknown>(null); const [dups, setDups] = useState<any[]>([]);
  if (id && loading) return <Loading />;
  const v = f ?? (existing ? { ...existing, whatsapp: existing.whatsapp_e164, category_ids: existing.categories.map((c: any) => c.id), messaging_consent: existing.messaging_consent === 'granted' } : { full_name: '', state: 'TX', city: '', category_ids: [], function_title: '', whatsapp: '', phone: '', email: '', language: 'en', description: '', experience: '', skills: '', certifications: '', licenses: '', availability: '', work_preferences: '', messaging_consent: false });
  const set = (k: string, val: any) => setF({ ...v, [k]: val });
  const licensed = (meta?.categories ?? []).some((c: any) => c.licensed_trade && v.category_ids.includes(c.id));
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const body: any = { full_name: v.full_name, state: v.state, city: v.city, category_ids: v.category_ids, function_title: v.function_title, whatsapp: v.whatsapp, phone: v.phone || null, email: v.email || null, language: v.language, description: v.description,
      experience: v.experience ?? null, skills: v.skills ?? null, certifications: v.certifications ?? null, licenses: v.licenses ?? null, availability: v.availability ?? null, work_preferences: v.work_preferences ?? null, messaging_consent: !!v.messaging_consent };
    try {
      if (id) { await patch(`/helpers/${id}`, body); nav(`/helpers/${id}`); }
      else { const r = await post('/helpers', body); if (r.possible_duplicates?.length) { setDups(r.possible_duplicates); setTimeout(() => nav(`/helpers/${r.id}`), 2500); } else nav(`/helpers/${r.id}`); }
    } catch (x) { setErr(x); }
  }
  const toggleCat = (cid: string) => set('category_ids', v.category_ids.includes(cid) ? v.category_ids.filter((x: string) => x !== cid) : [...v.category_ids, cid]);
  return (
    <form className="stack" onSubmit={submit}>
      <h1>{id ? t('helpers.edit') : t('helpers.new')}</h1>
      {dups.length > 0 && <Alert kind="warn">{t('helpers.dupWarn')}: {dups.map((d) => d.full_name).join(', ')}</Alert>}
      <div className="card"><div className="grid g2">
        <Field label={t('helpers.fullName')} id="n"><input id="n" required value={v.full_name} onChange={(e) => set('full_name', e.target.value)} /></Field>
        <Field label={t('helpers.function')} id="ft"><input id="ft" required value={v.function_title} onChange={(e) => set('function_title', e.target.value)} /></Field>
        <Field label={t('common.state')} id="st"><select id="st" value={v.state} onChange={(e) => set('state', e.target.value)}>{(meta?.states ?? []).map((s: any) => <option key={s.code} value={s.code}>{s.name}</option>)}</select></Field>
        <Field label={t('common.city')} id="ci"><input id="ci" required value={v.city} onChange={(e) => set('city', e.target.value)} /></Field>
        <Field label="WhatsApp" id="w" hint={t('helpers.waHint')}><input id="w" required inputMode="tel" value={v.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} /></Field>
        <Field label={t('helpers.language')} id="l"><select id="l" value={v.language} onChange={(e) => set('language', e.target.value)}><option value="en">English</option><option value="pt">Português</option><option value="es">Español</option></select></Field>
        <Field label={t('helpers.phone')} id="p"><input id="p" inputMode="tel" value={v.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label={t('auth.email')} id="e"><input id="e" type="email" value={v.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
      </div></div>
      <div className="card"><h2>{t('helpers.categories')}</h2><div className="row" role="group" aria-label={t('helpers.categories')}>
        {(meta?.categories ?? []).map((c: any) => <label key={c.id} className="badge" style={{ cursor: 'pointer', padding: '.35rem .7rem', background: v.category_ids.includes(c.id) ? 'var(--navy)' : undefined, color: v.category_ids.includes(c.id) ? '#fff' : undefined }}><input type="checkbox" className="skip" checked={v.category_ids.includes(c.id)} onChange={() => toggleCat(c.id)} />{catName(c, lang)}</label>)}
      </div>{licensed && <Alert kind="warn">{t('helpers.licensedNotice')}</Alert>}</div>
      <div className="card"><Field label={t('helpers.description')} id="d"><textarea id="d" required value={v.description} onChange={(e) => set('description', e.target.value)} /></Field>
        <div className="grid g2">{(['experience', 'skills', 'certifications', 'licenses', 'availability', 'work_preferences'] as const).map((k) => <Field key={k} label={t(`helpers.${k}`)} id={k}><input id={k} value={v[k] ?? ''} onChange={(e) => set(k, e.target.value)} /></Field>)}</div>
        <label style={{ display: 'flex', gap: '.5rem', fontWeight: 400 }}><input type="checkbox" checked={!!v.messaging_consent} onChange={(e) => set('messaging_consent', e.target.checked)} /><span>{t('helpers.consentAttest')}</span></label></div>
      <ErrorBox error={err} />
      <div className="row"><button disabled={v.category_ids.length === 0}>{t('common.save')}</button><Link className="btn secondary" to={id ? `/helpers/${id}` : '/helpers'}>{t('common.cancel')}</Link></div>
    </form>
  );
}

function Detail() {
  const { id } = useParams(); const { t, lang } = useI18n(); const { me } = useSession(); const nav = useNavigate(); const cur = me!.profile.currency;
  const [tab, setTab] = useState<'profile' | 'eval' | 'history'>('profile');
  const { data: h, error, reload } = useAsync(() => get(`/helpers/${id}`), [id]);
  const [invite, setInvite] = useState<any>(null); const [err, setErr] = useState<unknown>(null);
  if (error) return <ErrorBox error={error} />; if (!h) return <Loading />;
  const act = async (fn: () => Promise<any>) => { setErr(null); try { await fn(); reload(); } catch (x) { setErr(x); } };
  return (
    <div className="stack">
      <div className="row between"><h1>{h.full_name}</h1><Link to="/helpers">← {t('nav.helpers')}</Link></div>
      <div className="card stack">
        <div>{h.function_title} · {h.city}, {h.state} {h.archived_at && <Badge kind="warn">{t('helpers.archived')}</Badge>} {h.opted_out && <Badge kind="bad">{t('helpers.optedOut')}</Badge>}</div>
        <div className="row">
          <button className="secondary small" onClick={async () => { const r = await get(`/helpers/${h.id}/whatsapp`); await post(`/helpers/${h.id}/contacted`); window.open(r.link, '_blank', 'noopener,noreferrer'); reload(); }}>WhatsApp</button>
          <Link className="btn secondary small" to={`/messages/${h.id}`}>{t('nav.messages')}</Link>
          <Link className="btn secondary small" to={`/schedule/new?helper=${h.id}`}>{t('sched.new')}</Link>
          <Link className="btn secondary small" to={`/helpers/${h.id}/edit`}>{t('helpers.edit')}</Link>
          <button className="secondary small" onClick={() => act(() => post(`/helpers/${h.id}/favorite`, { favorite: !h.favorite }))}>{h.favorite ? '★' : '☆'} {t('helpers.favorite')}</button>
          <button className="secondary small" onClick={() => act(() => post(`/helpers/${h.id}/archive`, { archived: !h.archived_at }))}>{h.archived_at ? t('helpers.restore') : t('helpers.archive')}</button>
          <button className="secondary small" onClick={() => act(async () => setInvite(await post(`/helpers/${h.id}/invite`)))}>{t('helpers.invite')}</button>
          <button className="danger small" onClick={async () => { if (confirm(t('helpers.confirmDelete'))) { try { await del(`/helpers/${h.id}`); nav('/helpers'); } catch (x) { setErr(x); } } }}>{t('common.delete')}</button>
        </div>
        {invite && <Alert kind="ok"><div>{t('helpers.inviteShown')}</div><input readOnly value={invite.link} onFocus={(e) => e.target.select()} aria-label="link" /></Alert>}
        {h.licensed_trade_notice && <Alert kind="warn">{t('helpers.licensedNotice')}</Alert>}
        <ErrorBox error={err} />
      </div>
      <Tabs value={tab} onChange={setTab} items={[['profile', t('helpers.profile')], ['eval', t('helpers.private')], ['history', t('helpers.history')]]} />
      {tab === 'profile' && <div className="card"><p>{h.description}</p><table><tbody>{(['experience', 'skills', 'certifications', 'licenses', 'availability', 'work_preferences'] as const).map((k) => h[k] ? <tr key={k}><th>{t(`helpers.${k}`)}</th><td>{h[k]}</td></tr> : null)}
        <tr><th>WhatsApp</th><td>{h.whatsapp_e164}</td></tr><tr><th>{t('helpers.lastContact')}</th><td>{h.last_contacted_at ? fmtDateTime(h.last_contacted_at, lang) : '—'}</td></tr></tbody></table></div>}
      {tab === 'eval' && <Private id={h.id} cur={cur} />}
      {tab === 'history' && <History id={h.id} cur={cur} />}
    </div>
  );
}

function Private({ id, cur }: { id: string; cur: string }) {
  const { t, lang } = useI18n(); const { data, reload } = useAsync(() => get(`/helpers/${id}/private`), [id]);
  const [f, setF] = useState<any>(null); const [err, setErr] = useState<unknown>(null); const [saved, setSaved] = useState(false);
  if (!data) return <Loading />;
  const v = f ?? { notes: data.notes ?? '', agreed_amount: data.agreed_amount_cents != null ? (data.agreed_amount_cents / 100).toFixed(2) : '', payment_unit: data.payment_unit ?? '', last_job: data.last_job ?? '', last_job_date: data.last_job_date ?? '',
    eval_quality: data.eval_quality ?? '', eval_punctuality: data.eval_punctuality ?? '', eval_reliability: data.eval_reliability ?? '', eval_communication: data.eval_communication ?? '', eval_overall: data.eval_overall ?? '', would_hire_again: data.would_hire_again == null ? '' : data.would_hire_again ? 'yes' : 'no' };
  const set = (k: string, val: any) => { setSaved(false); setF({ ...v, [k]: val }); };
  async function save(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const amt = v.agreed_amount === '' ? null : normalizeMoneyInput(String(v.agreed_amount)); if (v.agreed_amount !== '' && !amt) { setErr({ code: 'invalid_money' }); return; }
    const n = (x: any) => (x === '' ? null : Number(x));
    try { await put(`/helpers/${id}/private`, { notes: v.notes || null, agreed_amount: amt, payment_unit: v.payment_unit || null, last_job: v.last_job || null, last_job_date: v.last_job_date || null,
      eval_quality: n(v.eval_quality), eval_punctuality: n(v.eval_punctuality), eval_reliability: n(v.eval_reliability), eval_communication: n(v.eval_communication), eval_overall: n(v.eval_overall), would_hire_again: v.would_hire_again === '' ? null : v.would_hire_again === 'yes' }); setSaved(true); reload(); } catch (x) { setErr(x); }
  }
  const stars = (k: string, label: string) => <Field label={label} id={k}><select id={k} value={v[k]} onChange={(e) => set(k, e.target.value)}><option value="">—</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{'★'.repeat(n)}</option>)}</select></Field>;
  return (
    <form className="card stack" onSubmit={save}>
      <Alert>{t('helpers.privateOnly')}</Alert>
      <div className="grid g3">{stars('eval_quality', t('eval.quality'))}{stars('eval_punctuality', t('eval.punctuality'))}{stars('eval_reliability', t('eval.reliability'))}{stars('eval_communication', t('eval.communication'))}{stars('eval_overall', t('eval.overall'))}
        <Field label={t('eval.again')} id="again"><select id="again" value={v.would_hire_again} onChange={(e) => set('would_hire_again', e.target.value)}><option value="">—</option><option value="yes">{t('common.yes')}</option><option value="no">{t('common.no')}</option></select></Field></div>
      <div className="grid g3"><Field label={`${t('eval.agreed')} (${cur})`} id="am"><MoneyInput id="am" value={String(v.agreed_amount)} onChange={(x) => set('agreed_amount', x)} /></Field>
        <Field label={t('eval.unit')} id="un"><select id="un" value={v.payment_unit} onChange={(e) => set('payment_unit', e.target.value)}><option value="">—</option>{['hour', 'day', 'job', 'other'].map((u) => <option key={u} value={u}>{t(`eval.unit.${u}`)}</option>)}</select></Field>
        <Field label={t('eval.lastJobDate')} id="lj"><input id="lj" type="date" value={v.last_job_date} onChange={(e) => set('last_job_date', e.target.value)} /></Field></div>
      <Field label={t('eval.lastJob')} id="ljn"><input id="ljn" value={v.last_job} onChange={(e) => set('last_job', e.target.value)} /></Field>
      <Field label={t('eval.notes')} id="nt"><textarea id="nt" value={v.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      <ErrorBox error={err} />{saved && <Alert kind="ok">{t('common.saved')}</Alert>}<div><button>{t('common.save')}</button></div>
      <p className="small muted">{fmtDate(data.updated_at, lang)}</p>
    </form>
  );
}

function History({ id, cur }: { id: string; cur: string }) {
  const { t, lang } = useI18n(); const { data, reload } = useAsync(() => get(`/helpers/${id}/history`), [id]);
  const [f, setF] = useState({ job_name: '', location: '', job_date: '', amount: '' }); const [err, setErr] = useState<unknown>(null);
  async function add(e: FormEvent) { e.preventDefault(); setErr(null); const amt = f.amount ? normalizeMoneyInput(f.amount) : null; if (f.amount && !amt) { setErr({ code: 'invalid_money' }); return; }
    try { await post(`/helpers/${id}/history`, { job_name: f.job_name, location: f.location || null, job_date: f.job_date || null, amount: amt, currency: cur }); setF({ job_name: '', location: '', job_date: '', amount: '' }); reload(); } catch (x) { setErr(x); } }
  if (!data) return <Loading />;
  return (
    <div className="stack">
      <div className="card"><h2>{t('helpers.jobsDone')}</h2>{data.assignments.length === 0 && <p className="muted">{t('common.none')}</p>}
        {data.assignments.map((a: any) => <div className="list-item" key={a.id}><div className="grow"><b>{a.job_name}</b><div className="small muted">{fmtDate(a.start_date, lang)} – {fmtDate(a.end_date, lang)} · {fmtMoney(a.default_daily_rate_cents, a.currency, lang)}/{t('sched.day')}</div></div>
          <div className="small right">{a.completed_days} ✓ · {a.absent_days} ✗ · {a.upcoming_days} ⏳</div></div>)}</div>
      <form className="card stack" onSubmit={add}><h2>{t('helpers.addPast')}</h2><div className="grid g2">
        <Field label={t('sched.job')} id="jn"><input id="jn" required value={f.job_name} onChange={(e) => setF({ ...f, job_name: e.target.value })} /></Field>
        <Field label={t('sched.location')} id="jl"><input id="jl" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        <Field label={t('common.date')} id="jd"><input id="jd" type="date" value={f.job_date} onChange={(e) => setF({ ...f, job_date: e.target.value })} /></Field>
        <Field label={`${t('common.amount')} (${cur})`} id="ja"><MoneyInput id="ja" value={f.amount} onChange={(x) => setF({ ...f, amount: x })} /></Field></div>
        <ErrorBox error={err} /><div><button>{t('common.add')}</button></div></form>
      {data.manual.length > 0 && <div className="card">{data.manual.map((m: any) => <div className="list-item" key={m.id}><div className="grow">{m.job_name}<div className="small muted">{fmtDate(m.job_date, lang)} {m.location}</div></div><b>{m.amount_cents != null ? fmtMoney(m.amount_cents, m.currency, lang) : ''}</b></div>)}</div>}
    </div>
  );
}
