import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { post } from '../api';
import { useI18n } from '../i18n';
import { useSession } from '../session';
import { Alert, ErrorBox, Field } from '../ui';

function Frame({ title, children }: { title: string; children: ReactNode }) {
  const { t, lang, setLang } = useI18n();
  return (
    <div className="auth">
      <div className="hero"><h1 style={{ fontSize: '1.8rem', marginBottom: 0 }}>HELPER CONNECT</h1><div className="stripe" /><p className="muted">{t('auth.tagline')}</p></div>
      <div className="card stack"><h2>{title}</h2>{children}</div>
      <p className="footer-note">
        <select value={lang} onChange={(e) => setLang(e.target.value as any)} aria-label={t('common.language')} style={{ width: 'auto', minHeight: 32 }}><option value="en">English</option><option value="pt">Português</option><option value="es">Español</option></select>
        {' '}· <Link to="/legal/terms">{t('legal.terms')}</Link> · <Link to="/legal/privacy">{t('legal.privacy')}</Link></p>
    </div>
  );
}

export function Login() {
  const { t } = useI18n(); const { refresh } = useSession(); const nav = useNavigate();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); setErr(null); try { await post('/auth/login', { email, password }); await refresh(); nav('/'); } catch (x) { setErr(x); } setBusy(false); }
  return (
    <Frame title={t('auth.login')}>
      <form onSubmit={submit}>
        <Field label={t('auth.email')} id="em"><input id="em" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label={t('auth.password')} id="pw"><input id="pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <ErrorBox error={err} />
        <div className="row between" style={{ marginTop: '.75rem' }}><button disabled={busy}>{t('auth.login')}</button><Link to="/forgot">{t('auth.forgot')}</Link></div>
      </form>
      <p className="small">{t('auth.noAccount')} <Link to="/register">{t('auth.register')}</Link></p>
    </Frame>
  );
}

export function Register() {
  const { t, lang } = useI18n(); const { meta } = useSession();
  const [f, setF] = useState({ email: '', password: '', full_name: '', business_name: '', state: 'TX', city: '', accept: false });
  const [err, setErr] = useState<unknown>(null); const [done, setDone] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const r = await post('/auth/register', { email: f.email, password: f.password, full_name: f.full_name, business_name: f.business_name || null, state: f.state, city: f.city, language: lang, accept_terms: f.accept }); setDone(r.dev_token ?? ''); } catch (x) { setErr(x); }
    setBusy(false);
  }
  if (done !== null) return <Frame title={t('auth.checkEmail')}><Alert kind="ok">{t('auth.verifySent')}</Alert>{done && <Alert kind="warn">DEV: <Link to={`/verify?token=${done}`}>{t('auth.verify')}</Link></Alert>}<Link to="/login">{t('auth.login')}</Link></Frame>;
  return (
    <Frame title={t('auth.register')}>
      <form onSubmit={submit}>
        <Field label={t('auth.fullName')} id="fn"><input id="fn" required minLength={2} autoComplete="name" value={f.full_name} onChange={(e) => set('full_name', e.target.value)} /></Field>
        <Field label={t('auth.business')} id="bn"><input id="bn" autoComplete="organization" value={f.business_name} onChange={(e) => set('business_name', e.target.value)} /></Field>
        <div className="grid g2">
          <Field label={t('common.state')} id="st"><select id="st" value={f.state} onChange={(e) => set('state', e.target.value)}>{(meta?.states ?? []).map((s: any) => <option key={s.code} value={s.code}>{s.name}</option>)}</select></Field>
          <Field label={t('common.city')} id="ct"><input id="ct" required value={f.city} onChange={(e) => set('city', e.target.value)} /></Field>
        </div>
        <Field label={t('auth.email')} id="em"><input id="em" type="email" required autoComplete="username" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label={t('auth.password')} hint={t('auth.pwHint')} id="pw"><input id="pw" type="password" required minLength={10} autoComplete="new-password" value={f.password} onChange={(e) => set('password', e.target.value)} /></Field>
        <label style={{ display: 'flex', gap: '.5rem', fontWeight: 400 }}><input type="checkbox" required checked={f.accept} onChange={(e) => set('accept', e.target.checked)} /><span>{t('auth.accept')} <Link to="/legal/terms" target="_blank">{t('legal.terms')}</Link> / <Link to="/legal/privacy" target="_blank">{t('legal.privacy')}</Link></span></label>
        <ErrorBox error={err} />
        <button disabled={busy} style={{ marginTop: '.75rem' }}>{t('auth.register')}</button>
      </form>
      <p className="small"><Link to="/login">{t('auth.haveAccount')}</Link></p>
    </Frame>
  );
}

export function Forgot() {
  const { t } = useI18n(); const [email, setEmail] = useState(''); const [sent, setSent] = useState<string | null>(null); const [err, setErr] = useState<unknown>(null);
  async function submit(e: FormEvent) { e.preventDefault(); setErr(null); try { const r = await post('/auth/forgot-password', { email }); setSent(r.dev_token ?? ''); } catch (x) { setErr(x); } }
  return (
    <Frame title={t('auth.forgot')}>
      {sent === null ? <form onSubmit={submit}><Field label={t('auth.email')} id="em"><input id="em" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field><ErrorBox error={err} /><button>{t('auth.sendReset')}</button></form>
        : <><Alert kind="ok">{t('auth.resetSent')}</Alert>{sent && <Alert kind="warn">DEV: <Link to={`/reset?token=${sent}`}>reset</Link></Alert>}</>}
      <Link to="/login">{t('auth.login')}</Link>
    </Frame>
  );
}

export function Reset() {
  const { t } = useI18n(); const [q] = useSearchParams(); const nav = useNavigate(); const [pw, setPw] = useState(''); const [err, setErr] = useState<unknown>(null);
  async function submit(e: FormEvent) { e.preventDefault(); setErr(null); try { await post('/auth/reset-password', { token: q.get('token'), password: pw }); nav('/login'); } catch (x) { setErr(x); } }
  return <Frame title={t('auth.reset')}><form onSubmit={submit}><Field label={t('auth.newPassword')} hint={t('auth.pwHint')} id="pw"><input id="pw" type="password" required minLength={10} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field><ErrorBox error={err} /><button>{t('common.save')}</button></form></Frame>;
}

export function Verify() {
  const { t } = useI18n(); const [q] = useSearchParams(); const [state, setState] = useState<'idle' | 'ok' | 'bad'>('idle');
  async function go() { try { await post('/auth/verify-email', { token: q.get('token') }); setState('ok'); } catch { setState('bad'); } }
  return <Frame title={t('auth.verify')}>{state === 'idle' && <button onClick={go}>{t('auth.verify')}</button>}{state === 'ok' && <><Alert kind="ok">{t('auth.verified')}</Alert><Link to="/login">{t('auth.login')}</Link></>}{state === 'bad' && <Alert kind="bad">{t('err.invalid_token')}</Alert>}</Frame>;
}
