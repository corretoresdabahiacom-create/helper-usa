import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { del, download, get, patch, post, put } from '../api';
import { fmtDateTime, normalizeMoneyInput } from '../format';
import { useI18n } from '../i18n';
import { useSession } from '../session';
import { Alert, Badge, ErrorBox, Field, Loading, MoneyInput, useAsync } from '../ui';

export default function Settings() {
  const { t, lang, setLang } = useI18n(); const { me, meta, refresh, logout } = useSession(); const nav = useNavigate();
  const prof = useAsync(() => get('/profile'), []); const sess = useAsync(() => get('/auth/sessions'), []);
  const [p, setP] = useState<any>(null); const [fin, setFin] = useState<any>(null); const [pw, setPw] = useState({ current_password: '', new_password: '' }); const [sup, setSup] = useState({ subject: '', body: '' });
  const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState<unknown>(null); const [del1, setDel1] = useState({ password: '', confirm: '' });
  if (!prof.data || !me) return null;
  const v = p ?? { full_name: prof.data.full_name, business_name: prof.data.business_name ?? '', city: prof.data.city ?? '', state: prof.data.state ?? 'TX', language: prof.data.language, timezone: prof.data.timezone, notifications: prof.data.notifications ?? {} };
  const f = fin ?? { accounting_basis: me.profile.accounting_basis, currency: me.profile.currency, opening_cash: (me.profile.opening_cash_cents / 100).toFixed(2), opening_cash_date: me.profile.opening_cash_date ?? '' };
  const run = async (fn: () => Promise<any>, ok = t('common.saved')) => { setErr(null); setMsg(null); try { await fn(); setMsg(ok); await refresh(); sess.reload(); } catch (x) { setErr(x); } };
  const tzs = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'];
  return (
    <div className="stack"><h1>{t('nav.settings')}</h1>{msg && <Alert kind="ok">{msg}</Alert>}<ErrorBox error={err} />
      <form className="card stack" onSubmit={(e: FormEvent) => { e.preventDefault(); run(async () => { await patch('/profile', { full_name: v.full_name, business_name: v.business_name || null, city: v.city, state: v.state, language: v.language, timezone: v.timezone, notifications: v.notifications }); setLang(v.language); }); }}>
        <h2>{t('set.profile')}</h2><div className="grid g2">
          <Field label={t('auth.fullName')} id="fn"><input id="fn" required value={v.full_name} onChange={(e) => setP({ ...v, full_name: e.target.value })} /></Field>
          <Field label={t('auth.business')} id="bn"><input id="bn" value={v.business_name} onChange={(e) => setP({ ...v, business_name: e.target.value })} /></Field>
          <Field label={t('common.state')} id="st"><select id="st" value={v.state} onChange={(e) => setP({ ...v, state: e.target.value })}>{(meta?.states ?? []).map((s: any) => <option key={s.code} value={s.code}>{s.name}</option>)}</select></Field>
          <Field label={t('common.city')} id="ci"><input id="ci" value={v.city} onChange={(e) => setP({ ...v, city: e.target.value })} /></Field>
          <Field label={t('common.language')} id="la"><select id="la" value={v.language} onChange={(e) => setP({ ...v, language: e.target.value })}><option value="en">English</option><option value="pt">Português</option><option value="es">Español</option></select></Field>
          <Field label={t('set.timezone')} hint={t('set.tzHint')} id="tz"><select id="tz" value={v.timezone} onChange={(e) => setP({ ...v, timezone: e.target.value })}>{[...new Set([v.timezone, ...tzs])].map((z) => <option key={z}>{z}</option>)}</select></Field></div>
        {(['email_enabled', 'message_alerts', 'payment_reminders'] as const).map((k) => <label key={k} style={{ fontWeight: 400 }}><input type="checkbox" checked={!!v.notifications[k]} onChange={(e) => setP({ ...v, notifications: { ...v.notifications, [k]: e.target.checked } })} /> {t(`set.${k}`)}</label>)}
        <div><button>{t('common.save')}</button></div></form>
      <form className="card stack" onSubmit={(e: FormEvent) => { e.preventDefault(); const oc = normalizeMoneyInput(String(f.opening_cash)); if (!oc) { setErr({ code: 'invalid_money' }); return; } run(() => put('/finance/settings', { accounting_basis: f.accounting_basis, currency: f.currency, opening_cash: oc, ...(f.opening_cash_date ? { opening_cash_date: f.opening_cash_date } : {}) })); }}>
        <h2>{t('set.finance')}</h2><Alert kind="warn">{t('set.financeNote')}</Alert><div className="grid g2">
          <Field label={t('fin.basis')} hint={t('set.basisHint')} id="b"><select id="b" value={f.accounting_basis} onChange={(e) => setFin({ ...f, accounting_basis: e.target.value })}><option value="accrual">{t('fin.accrual')}</option><option value="cash">{t('fin.cash')}</option></select></Field>
          <Field label={t('set.currency')} hint={t('set.currencyHint')} id="cu"><select id="cu" value={f.currency} onChange={(e) => setFin({ ...f, currency: e.target.value })}>{(meta?.currencies ?? ['USD']).map((c: string) => <option key={c}>{c}</option>)}</select></Field>
          <Field label={t('set.openingCash')} id="oc"><MoneyInput id="oc" value={String(f.opening_cash)} onChange={(x) => setFin({ ...f, opening_cash: x })} /></Field>
          <Field label={t('set.openingDate')} id="od"><input id="od" type="date" value={f.opening_cash_date} onChange={(e) => setFin({ ...f, opening_cash_date: e.target.value })} /></Field></div><div><button>{t('common.save')}</button></div></form>
      <form className="card stack" onSubmit={(e: FormEvent) => { e.preventDefault(); run(async () => { await post('/auth/change-password', pw); setPw({ current_password: '', new_password: '' }); }); }}>
        <h2>{t('set.security')}</h2><div className="grid g2"><Field label={t('set.currentPw')} id="cp"><input id="cp" type="password" autoComplete="current-password" required value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} /></Field><Field label={t('auth.newPassword')} hint={t('auth.pwHint')} id="np"><input id="np" type="password" autoComplete="new-password" required minLength={10} value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} /></Field></div><div><button>{t('set.changePw')}</button></div>
        <h3>{t('set.sessions')}</h3>{sess.data?.sessions.map((s: any) => <div className="list-item" key={s.id}><div className="grow small">{s.user_agent || '—'}<div className="muted">{fmtDateTime(s.created_at, lang)} {s.current && `· ${t('set.current')}`}</div></div>{!s.current && <button type="button" className="small secondary" onClick={() => run(() => del(`/auth/sessions/${s.id}`))}>{t('set.revoke')}</button>}</div>)}
        <div><button type="button" className="secondary" onClick={() => run(() => post('/auth/sessions/revoke-others'))}>{t('set.revokeOthers')}</button></div></form>
      <TwoFactor />
      <form className="card stack" onSubmit={(e: FormEvent) => { e.preventDefault(); run(async () => { await post('/support', sup); setSup({ subject: '', body: '' }); }, t('set.supportSent')); }}><h2>{t('set.support')}</h2>
        <Field label={t('set.subject')} id="su"><input id="su" required minLength={3} value={sup.subject} onChange={(e) => setSup({ ...sup, subject: e.target.value })} /></Field><Field label={t('msg.message')} id="sb"><textarea id="sb" required minLength={5} value={sup.body} onChange={(e) => setSup({ ...sup, body: e.target.value })} /></Field><div><button>{t('msg.send')}</button></div></form>
      <div className="card stack"><h2>{t('set.privacy')}</h2><div className="row"><button className="secondary" onClick={() => download('/account/export', 'helper-connect-export.json').catch(setErr)}>{t('set.export')}</button>
        <Link className="btn secondary" to="/legal/terms">{t('legal.terms')}</Link><Link className="btn secondary" to="/legal/privacy">{t('legal.privacy')}</Link><Link className="btn secondary" to="/legal/messaging">{t('legal.messaging')}</Link><Link className="btn secondary" to="/legal/financial">{t('legal.financial')}</Link></div></div>
      <form className="card stack" style={{ borderColor: 'var(--red)' }} onSubmit={async (e: FormEvent) => { e.preventDefault(); if (!confirm(t('set.deleteConfirm'))) return; setErr(null); try { await del('/account', del1); await logout(); nav('/login'); } catch (x) { setErr(x); } }}>
        <h2>{t('set.delete')}</h2><Alert kind="bad">{t('set.deleteNote')}</Alert><div className="grid g2"><Field label={t('auth.password')} id="dp"><input id="dp" type="password" required value={del1.password} onChange={(e) => setDel1({ ...del1, password: e.target.value })} /></Field><Field label={t('set.typeDelete')} id="dc"><input id="dc" required value={del1.confirm} onChange={(e) => setDel1({ ...del1, confirm: e.target.value })} /></Field></div><div><button className="danger" disabled={del1.confirm !== 'DELETE'}>{t('set.delete')}</button></div></form>
    </div>
  );
}

function TwoFactor() {
  const { t } = useI18n(); const st = useAsync(() => get('/auth/2fa/status'), []);
  const [pw, setPw] = useState(''); const [code, setCode] = useState(''); const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null); const [err, setErr] = useState<unknown>(null);
  const run = async (fn: () => Promise<void>) => { setErr(null); try { await fn(); setPw(''); setCode(''); st.reload(); } catch (x) { setErr(x); } };
  if (!st.data) return <div className="card"><Loading /></div>;
  if (!st.data.available) return <div className="card stack"><h2>{t('set.2fa')}</h2><Alert kind="warn">{t('set.2faUnavailable')}</Alert></div>;
  return (
    <div className="card stack"><h2>{t('set.2fa')}</h2><p className="small">{t('set.2faIntro')}</p>
      {codes && <Alert kind="ok"><strong>{t('set.2faCodes')}</strong><pre style={{ margin: '.5rem 0', userSelect: 'all' }} data-testid="recovery-codes">{codes.join('\n')}</pre><button type="button" className="small secondary" onClick={() => setCodes(null)}>{t('set.2faSaved')}</button></Alert>}
      {!st.data.enabled && !setup && <form className="stack" onSubmit={(e: FormEvent) => { e.preventDefault(); run(async () => setSetup(await post('/auth/2fa/setup', { password: pw }))); }}>
        <Field label={t('set.currentPw')} id="tfp"><input id="tfp" type="password" autoComplete="current-password" required value={pw} onChange={(e) => setPw(e.target.value)} /></Field><ErrorBox error={err} /><div><button>{t('set.2faStart')}</button></div></form>}
      {!st.data.enabled && setup && <form className="stack" onSubmit={(e: FormEvent) => { e.preventDefault(); run(async () => { const r = await post('/auth/2fa/enable', { code }); setCodes(r.recovery_codes); setSetup(null); }); }}>
        <p className="small">{t('set.2faAdd')}</p><code data-testid="totp-secret" style={{ wordBreak: 'break-all', userSelect: 'all' }}>{setup.secret}</code>
        <a className="small" href={setup.otpauth_uri}>{t('set.2faOpenApp')}</a>
        <Field label={t('auth.code')} id="tfc"><input id="tfc" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} /></Field><ErrorBox error={err} /><div><button>{t('set.2faConfirm')}</button></div></form>}
      {st.data.enabled && <form className="stack" onSubmit={(e: FormEvent) => { e.preventDefault(); run(async () => { await post('/auth/2fa/disable', { password: pw, code }); }); }}>
        <Badge kind="ok">{t('set.2faOn')} · {t('set.2faLeft', { n: st.data.recovery_codes_left })}</Badge>
        <div className="grid g2"><Field label={t('set.currentPw')} id="tfp"><input id="tfp" type="password" autoComplete="current-password" required value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <Field label={t('auth.code')} hint={t('auth.codeHint')} id="tfc"><input id="tfc" required value={code} onChange={(e) => setCode(e.target.value)} /></Field></div><ErrorBox error={err} /><div><button className="secondary">{t('set.2faDisable')}</button></div></form>}
    </div>
  );
}
