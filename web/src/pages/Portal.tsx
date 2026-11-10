import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { download, get, post } from '../api';
import { fmtDateTime } from '../format';
import { useI18n } from '../i18n';
import { Alert, ErrorBox, Loading, useAsync } from '../ui';

/** Helper portal: no account. The token in the URL grants access to ONE private thread. */
export function Portal() {
  const { token } = useParams(); const { t, lang, setLang } = useI18n(); const { data, error, reload } = useAsync(() => get(`/portal/${token}`), [token]);
  const [body, setBody] = useState(''); const [err, setErr] = useState<unknown>(null); const [out, setOut] = useState(false);
  useEffect(() => { if (data?.language) setLang(data.language); /* eslint-disable-next-line */ }, [data?.language]);
  useEffect(() => { const i = setInterval(reload, 20000); return () => clearInterval(i); }, [reload]);
  async function send(e: FormEvent) { e.preventDefault(); setErr(null); try { await post(`/portal/${token}/messages`, { body, language: lang }); setBody(''); reload(); } catch (x) { setErr(x); } }
  if (error) return <div className="auth"><div className="card"><Alert kind="bad">{t('portal.invalid')}</Alert></div></div>; if (!data) return <div className="auth"><Loading /></div>;
  return (
    <div className="auth" style={{ maxWidth: 560 }}><div className="hero"><h1 style={{ marginBottom: 0 }}>HELPER CONNECT</h1><div className="stripe" /></div>
      <div className="card stack"><h2>{t('portal.hello', { name: data.helper_name })}</h2><p className="muted">{t('portal.intro', { who: data.contractor })}</p><Alert kind="warn">{t('msg.retention')}</Alert>
        <div aria-live="polite" style={{ minHeight: 160 }}>{data.messages.length === 0 && <p className="muted">{t('msg.empty')}</p>}{data.messages.map((m: any) => <div key={m.id} className={`bubble ${m.sender_type === 'helper' ? 'me' : ''}`}><div>{m.body}</div><div className="t">{fmtDateTime(m.created_at, lang)}</div></div>)}</div>
        {(data.opted_out || out) ? <Alert kind="ok">{t('portal.optedOut')}</Alert> : <form className="row" onSubmit={send}><textarea aria-label={t('msg.message')} className="grow" style={{ minHeight: 60 }} maxLength={2000} required value={body} onChange={(e) => setBody(e.target.value)} /><button disabled={!body.trim()}>{t('msg.send')}</button></form>}
        <ErrorBox error={err} />
        <div className="row"><button className="secondary small" onClick={() => download(`/portal/${token}/export?format=pdf`, 'conversation.pdf')}>PDF</button><button className="secondary small" onClick={() => download(`/portal/${token}/export?format=txt`, 'conversation.txt')}>TXT</button>
          {!data.opted_out && !out && <button className="secondary small" onClick={async () => { if (confirm(t('portal.optOutConfirm'))) { await post(`/portal/${token}/opt-out`); setOut(true); } }}>{t('portal.optOut')}</button>}</div></div>
      <p className="footer-note">{t('portal.privacy')}</p></div>
  );
}
