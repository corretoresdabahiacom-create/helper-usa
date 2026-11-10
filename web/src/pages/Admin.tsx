import { useState } from 'react';
import { get, post } from '../api';
import { fmtDateTime } from '../format';
import { useI18n } from '../i18n';
import { Alert, Badge, ErrorBox, Kpi, Loading, Tabs, useAsync } from '../ui';

export default function Admin() {
  const { t, lang } = useI18n(); const [tab, setTab] = useState<'users' | 'abuse' | 'support' | 'logs'>('users'); const [q, setQ] = useState('');
  const metrics = useAsync(() => get('/admin/metrics'), []); const users = useAsync(() => get(`/admin/users?q=${encodeURIComponent(q)}`), [q]);
  const abuse = useAsync(() => get('/admin/abuse-reports'), []); const support = useAsync(() => get('/admin/support'), []); const logs = useAsync(() => get('/admin/audit-logs?scope=admin'), []);
  const [err, setErr] = useState<unknown>(null); const [info, setInfo] = useState<string | null>(null);
  async function suspend(id: string, status: 'active' | 'suspended') { const reason = prompt(t('admin.reason')); if (!reason) return; setErr(null); try { await post(`/admin/users/${id}/status`, { status, reason }); users.reload(); } catch (x) { setErr(x); } }
  async function overview(id: string) { const reason = prompt(t('admin.grantReason')); if (!reason) return; setErr(null); try { await post(`/admin/users/${id}/access-grant`, { reason }); setInfo(JSON.stringify(await get(`/admin/users/${id}/overview`))); } catch (x) { setErr(x); } }
  const m = metrics.data;
  return (
    <div className="stack"><h1>{t('nav.admin')}</h1><Alert>{t('admin.note')}</Alert><ErrorBox error={err} />{info && <Alert kind="ok">{info}</Alert>}
      {m && <div className="grid g3"><Kpi label={t('admin.users')} value={m.users} sub={`${m.active_users} ${t('admin.active')}`} /><Kpi label={t('nav.helpers')} value={m.helpers} /><Kpi label={t('admin.activeMsgs')} value={m.active_messages} /><Kpi label={t('admin.abuse')} value={m.open_abuse_reports} /><Kpi label={t('set.support')} value={m.open_support} /><Kpi label={t('admin.lastJob')} value={m.last_job ? (m.last_job.ok ? '✓' : '✗') : '—'} sub={m.last_job ? fmtDateTime(m.last_job.started_at, lang) : ''} /></div>}
      <Tabs value={tab} onChange={setTab} items={[['users', t('admin.users')], ['abuse', t('admin.abuse')], ['support', t('set.support')], ['logs', t('admin.logs')]]} />
      {tab === 'users' && <div className="card stack"><input aria-label={t('common.search')} placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />{!users.data ? <Loading /> : users.data.users.map((u: any) => <div className="list-item" key={u.id}><div className="grow">{u.full_name}<div className="small muted">{u.email} · {u.state} · {fmtDateTime(u.created_at, lang)}</div></div><Badge kind={u.status === 'active' ? 'ok' : 'bad'}>{u.status}</Badge><button className="small secondary" onClick={() => overview(u.id)}>{t('admin.overview')}</button><button className="small secondary" onClick={() => suspend(u.id, u.status === 'active' ? 'suspended' : 'active')}>{u.status === 'active' ? t('admin.suspend') : t('admin.reactivate')}</button></div>)}</div>}
      {tab === 'abuse' && <div className="card">{abuse.data?.reports.length === 0 && <p className="muted">{t('common.none')}</p>}{abuse.data?.reports.map((r: any) => <div className="list-item" key={r.id}><div className="grow">{r.reason}<div className="small muted">{fmtDateTime(r.created_at, lang)}</div></div><Badge>{r.status}</Badge>{r.status !== 'closed' && <button className="small secondary" onClick={async () => { await post(`/admin/abuse-reports/${r.id}`, { status: 'closed' }); abuse.reload(); }}>{t('admin.close')}</button>}</div>)}</div>}
      {tab === 'support' && <div className="card">{support.data?.requests.length === 0 && <p className="muted">{t('common.none')}</p>}{support.data?.requests.map((r: any) => <div className="list-item" key={r.id}><div className="grow"><b>{r.subject}</b><div className="small">{r.body}</div></div><Badge>{r.status}</Badge>{r.status === 'open' && <button className="small secondary" onClick={async () => { await post(`/admin/support/${r.id}`, { status: 'closed' }); support.reload(); }}>{t('admin.close')}</button>}</div>)}</div>}
      {tab === 'logs' && <div className="card tablewrap"><table><thead><tr><th>{t('common.date')}</th><th>{t('admin.action')}</th></tr></thead><tbody>{logs.data?.logs.map((l: any) => <tr key={l.id}><td className="nowrap">{fmtDateTime(l.created_at, lang)}</td><td>{l.action} <span className="muted small">{l.entity}</span></td></tr>)}</tbody></table></div>}
    </div>
  );
}
