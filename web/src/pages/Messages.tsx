import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Route, Routes, useParams } from 'react-router-dom';
import { download, get, post } from '../api';
import { fmtDateTime } from '../format';
import { useI18n } from '../i18n';
import { useSession } from '../session';
import { Alert, Badge, ErrorBox, Field, Loading, Tabs, useAsync } from '../ui';

export default function Messages() { return <Routes><Route index element={<Inbox />} /><Route path=":helperId" element={<Thread />} /></Routes>; }

function Inbox() {
  const { t, lang } = useI18n(); const [tab, setTab] = useState<'inbox' | 'bulk'>('inbox'); const { data, error } = useAsync(() => get('/messages/conversations'), []);
  return <div className="stack"><h1>{t('nav.messages')}</h1><Alert kind="warn">{t('msg.retention')}</Alert><Tabs value={tab} onChange={setTab} items={[['inbox', t('msg.inbox')], ['bulk', t('msg.bulk')]]} /><ErrorBox error={error} />
    {tab === 'inbox' && (!data ? <Loading /> : <div className="card">{data.conversations.length === 0 && <p className="muted">{t('msg.none')} <Link to="/helpers">{t('nav.helpers')}</Link></p>}{data.conversations.map((c: any) => <div className="list-item" key={c.id}><div className="grow"><Link to={`/messages/${c.helper_id}`}><b>{c.helper_name}</b></Link><div className="small muted">{c.last_message_at ? fmtDateTime(c.last_message_at, lang) : ''}</div></div>{c.unread > 0 && <Badge kind="bad">{c.unread}</Badge>}<span className="small muted">{c.active_messages}</span></div>)}</div>)}
    {tab === 'bulk' && <Bulk />}</div>;
}

function Bulk() {
  const { t, lang } = useI18n(); const { data } = useAsync(() => get('/helpers'), []); const [sel, setSel] = useState<string[]>([]); const [body, setBody] = useState(''); const [res, setRes] = useState<any>(null); const [err, setErr] = useState<unknown>(null);
  const eligible = (data?.helpers ?? []).filter((h: any) => h.messaging_consent === 'granted' && !h.opted_out);
  async function send(e: FormEvent) { e.preventDefault(); setErr(null); setRes(null); try { setRes(await post('/messages/bulk', { helper_ids: sel, body, language: lang })); setBody(''); setSel([]); } catch (x) { setErr(x); } }
  return <form className="card stack" onSubmit={send}><Alert>{t('msg.bulkNote')}</Alert>
    <div className="row"><button type="button" className="secondary small" onClick={() => setSel(eligible.map((h: any) => h.id))}>{t('msg.selectAll')}</button><button type="button" className="secondary small" onClick={() => setSel([])}>{t('msg.clear')}</button></div>
    <div>{eligible.length === 0 && <p className="muted">{t('msg.noEligible')}</p>}{eligible.map((h: any) => <label key={h.id} style={{ display: 'flex', gap: '.5rem', fontWeight: 400, padding: '.3rem 0' }}><input type="checkbox" checked={sel.includes(h.id)} onChange={(e) => setSel(e.target.checked ? [...sel, h.id] : sel.filter((x) => x !== h.id))} />{h.full_name} <span className="muted small">{h.city}, {h.state}</span></label>)}</div>
    <Field label={t('msg.message')} id="b"><textarea id="b" required maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} /></Field><ErrorBox error={err} />
    {res && <Alert kind="ok">{t('msg.sentTo', { n: res.sent_count })}{res.skipped.length > 0 && ` · ${t('msg.skipped')}: ${res.skipped.length}`}</Alert>}<div><button disabled={!sel.length || !body.trim()}>{t('msg.sendIndividually', { n: sel.length })}</button></div></form>;
}

function Thread() {
  const { helperId } = useParams(); const { t, lang } = useI18n(); const { meta } = useSession(); const { data, error, reload } = useAsync(() => get(`/messages/with/${helperId}`), [helperId]);
  const [body, setBody] = useState(''); const [err, setErr] = useState<unknown>(null); const [tr, setTr] = useState<Record<string, string>>({}); const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }); }, [data]);
  useEffect(() => { const i = setInterval(reload, 20000); return () => clearInterval(i); }, [reload]);
  async function send(e: FormEvent) { e.preventDefault(); setErr(null); try { await post(`/messages/with/${helperId}`, { body, language: lang }); setBody(''); reload(); } catch (x) { setErr(x); } }
  async function translate(id: string) { try { const r = await post(`/messages/${id}/translate`, { lang }); setTr({ ...tr, [id]: r.text }); } catch (x) { setErr(x); } }
  if (error) return <ErrorBox error={error} />; if (!data) return <Loading />;
  const blocked = data.helper.opted_out || data.helper.messaging_consent === 'revoked';
  return (
    <div className="stack"><div className="row between"><h1>{data.helper.full_name}</h1><Link to="/messages">← {t('nav.messages')}</Link></div>
      <Alert kind="warn">{t('msg.retention')}</Alert>{data.helper.messaging_consent === 'unknown' && <Alert>{t('msg.consentUnknown')}</Alert>}{blocked && <Alert kind="bad">{t('msg.blocked')}</Alert>}
      <div className="card" style={{ minHeight: 220 }} aria-live="polite">{data.messages.length === 0 && <p className="muted">{t('msg.empty')}</p>}
        {data.messages.map((m: any) => <div key={m.id} className={`bubble ${m.sender_type === 'contractor' ? 'me' : ''}`}><div>{m.body}</div>{tr[m.id] && <div className="small" style={{ borderTop: '1px solid rgba(128,128,128,.4)', marginTop: 4 }}>{tr[m.id]}</div>}
          <div className="t">{fmtDateTime(m.created_at, lang)} · {t('msg.expires')} {fmtDateTime(m.expires_at, lang)}{m.is_bulk ? ` · ${t('msg.bulkTag')}` : ''}{m.sender_type === 'contractor' ? ` · ${t(`msg.${m.delivery_status}`)}` : ''}{meta?.capabilities?.translation && <> · <button className="small secondary" style={{ minHeight: 24, padding: '0 .4rem', color: 'inherit' }} onClick={() => translate(m.id)}>{t('msg.translate')}</button></>}</div></div>)}<div ref={end} /></div>
      <form className="row" onSubmit={send}><textarea aria-label={t('msg.message')} className="grow" style={{ minHeight: 60 }} maxLength={2000} required disabled={blocked} value={body} onChange={(e) => setBody(e.target.value)} /><button disabled={blocked || !body.trim()}>{t('msg.send')}</button></form><ErrorBox error={err} />
      <div className="row"><button className="secondary small" onClick={() => download(`/messages/with/${helperId}/export?format=pdf`, 'conversation.pdf')}>PDF</button><button className="secondary small" onClick={() => download(`/messages/with/${helperId}/export?format=txt`, 'conversation.txt')}>TXT</button></div></div>
  );
}
