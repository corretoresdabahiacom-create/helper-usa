import { useState, type FormEvent } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { get, post } from '../api';
import { fmtDate, fmtMoney, normalizeMoneyInput, today } from '../format';
import { useI18n } from '../i18n';
import { useSession } from '../session';
import { Alert, Badge, ErrorBox, Field, Kpi, Loading, MoneyInput, useAsync } from '../ui';

const SK: Record<string, '' | 'ok' | 'warn' | 'bad'> = { open: '', partial: 'warn', received: 'ok', paid: 'ok', overdue: 'bad', canceled: 'bad', written_off: 'bad', draft: '' };

export default function Money() {
  const { t } = useI18n();
  return (
    <div className="stack"><nav className="tabs" aria-label={t('nav.money')}><NavLink end to="/money">{t('fin.receivables')}</NavLink><NavLink to="/money/expenses">{t('fin.expenses')}</NavLink><NavLink to="/money/cash">{t('fin.cashMoves')}</NavLink><NavLink to="/money/categories">{t('fin.categories')}</NavLink></nav>
      <Routes><Route index element={<Receivables />} /><Route path="expenses" element={<Expenses />} /><Route path="cash" element={<CashMoves />} /><Route path="categories" element={<Categories />} /></Routes></div>
  );
}

function useCats(kind: 'revenue' | 'expense') { const c = useAsync(() => get('/finance/categories'), []); return (c.data?.categories ?? []).filter((x: any) => x.kind === kind && x.active); }

function Receivables() {
  const { t, lang } = useI18n(); const { me, meta } = useSession(); const cur = me!.profile.currency; const tz = me!.profile.timezone;
  const [status, setStatus] = useState(''); const list = useAsync(() => get(`/finance/receivables${status ? `?status=${status}` : ''}`), [status]); const sum = useAsync(() => get('/finance/receivables/summary'), []);
  const cats = useCats('revenue'); const projects = useAsync(() => get('/work/projects'), []);
  const [f, setF] = useState<any>({ customer: '', description: '', category_id: '', amount: '', issue_date: today(tz), due_date: '', project_id: '', n: 1, every: 'month' });
  const [err, setErr] = useState<unknown>(null); const [pay, setPay] = useState<any>(null); const [open, setOpen] = useState(false); const m = (n: number) => fmtMoney(n, cur, lang);
  const reload = () => { list.reload(); sum.reload(); };
  async function add(e: FormEvent) {
    e.preventDefault(); setErr(null); const amt = normalizeMoneyInput(f.amount); if (!amt) { setErr({ code: 'invalid_money' }); return; }
    try { await post('/finance/receivables', { customer: f.customer, description: f.description, category_id: f.category_id || cats[0]?.id, project_id: f.project_id || null, amount: amt, issue_date: f.issue_date, due_date: f.due_date || null,
      ...(f.n > 1 ? { installments: { count: Number(f.n), every: f.every, first_due: f.due_date || f.issue_date } } : {}) }); setOpen(false); setF({ ...f, customer: '', description: '', amount: '' }); reload(); } catch (x) { setErr(x); }
  }
  async function receive(e: FormEvent) {
    e.preventDefault(); setErr(null); const amt = normalizeMoneyInput(pay.amount); if (!amt) { setErr({ code: 'invalid_money' }); return; }
    try { await post(`/finance/receivables/${pay.id}/receipts`, { amount: amt, date: pay.date, method: pay.method, idempotency_key: pay.key }); setPay(null); reload(); } catch (x) { setErr(x); }
  }
  const act = async (fn: () => Promise<any>) => { setErr(null); try { await fn(); reload(); } catch (x) { setErr(x); } };
  return (
    <div className="stack">
      {sum.data && <div className="grid g3"><Kpi label={t('fin.outstanding')} value={m(sum.data.total_outstanding_cents)} /><Kpi label={t('fin.overdue')} value={m(sum.data.overdue_cents)} tone={sum.data.overdue_cents > 0 ? 'neg' : undefined} sub={`${sum.data.overdue_count}`} /><Kpi label={t('fin.due30')} value={m(sum.data.due_next_30_days_cents)} /></div>}
      <div className="row between"><select aria-label={t('common.status')} value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }}><option value="">{t('common.all')}</option>{['open', 'partial', 'overdue', 'received', 'canceled', 'written_off'].map((s) => <option key={s} value={s}>{t(`st.${s}`)}</option>)}</select><button onClick={() => setOpen(!open)}>+ {t('fin.newRecv')}</button></div>
      {open && <form className="card stack" onSubmit={add}><div className="grid g2">
        <Field label={t('fin.customer')} id="cu"><input id="cu" required value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} /></Field>
        <Field label={t('common.description')} id="de"><input id="de" required value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label={t('fin.category')} id="ca"><select id="ca" value={f.category_id || cats[0]?.id || ''} onChange={(e) => setF({ ...f, category_id: e.target.value })}>{cats.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label={t('nav.projects')} id="pr"><select id="pr" value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}><option value="">—</option>{projects.data?.projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label={`${t('common.amount')} (${cur})`} hint={f.n > 1 ? t('fin.totalSplit') : undefined} id="am"><MoneyInput id="am" required value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
        <Field label={t('fin.issueDate')} id="id"><input id="id" type="date" required value={f.issue_date} onChange={(e) => setF({ ...f, issue_date: e.target.value })} /></Field>
        <Field label={t('fin.dueDate')} id="dd"><input id="dd" type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
        <Field label={t('fin.installments')} id="in"><div className="row"><input id="in" type="number" min={1} max={60} value={f.n} onChange={(e) => setF({ ...f, n: e.target.value })} style={{ width: 90 }} /><select aria-label={t('fin.every')} value={f.every} onChange={(e) => setF({ ...f, every: e.target.value })} style={{ width: 'auto' }}><option value="month">{t('fin.monthly')}</option><option value="week">{t('fin.weekly')}</option></select></div></Field></div>
        <ErrorBox error={err} /><div><button>{t('common.save')}</button></div></form>}
      <ErrorBox error={list.error ?? err} />
      {pay && <form className="card stack" onSubmit={receive}><h2>{t('fin.recordReceipt')}: {pay.customer} <span className="muted small">({t('fin.outstanding')} {m(pay.outstanding)})</span></h2><div className="grid g3">
        <Field label={`${t('common.amount')} (${cur})`} id="pa"><MoneyInput id="pa" required value={pay.amount} onChange={(v) => setPay({ ...pay, amount: v })} /></Field>
        <Field label={t('pay.method')} id="pm"><select id="pm" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{(meta?.payment_methods ?? []).map((x: string) => <option key={x} value={x}>{t(`method.${x}`)}</option>)}</select></Field>
        <Field label={t('common.date')} id="pd"><input id="pd" type="date" required max={today(tz)} value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></Field></div><div className="row"><button>{t('common.save')}</button><button type="button" className="secondary" onClick={() => setPay(null)}>{t('common.cancel')}</button></div></form>}
      {!list.data ? <Loading /> : <div className="card tablewrap"><table><thead><tr><th>{t('fin.customer')}</th><th>{t('fin.dueDate')}</th><th className="num">{t('common.amount')}</th><th className="num">{t('fin.received')}</th><th>{t('common.status')}</th><th /></tr></thead><tbody>
        {list.data.receivables.length === 0 && <tr><td colSpan={6} className="muted">{t('common.none')}</td></tr>}
        {list.data.receivables.map((r: any) => <tr key={r.id}><td>{r.customer}<div className="small muted">{r.description}{r.project_name ? ` · ${r.project_name}` : ''}</div></td><td className="nowrap">{fmtDate(r.due_date, lang)}</td><td className="num">{fmtMoney(r.original_cents, r.currency, lang)}</td><td className="num">{fmtMoney(r.received_cents, r.currency, lang)}</td><td><Badge kind={SK[r.display_status]}>{t(`st.${r.display_status}`)}</Badge></td>
          <td className="nowrap">{r.outstanding_cents > 0 && ['open', 'partial', 'overdue'].includes(r.status) && <><button className="small" onClick={() => setPay({ id: r.id, customer: r.customer, outstanding: r.outstanding_cents, amount: (r.outstanding_cents / 100).toFixed(2), method: 'zelle', date: today(tz), key: crypto.randomUUID() })}>{t('fin.receive')}</button>{' '}
            <button className="small secondary" onClick={() => { const reason = prompt(t('fin.writeOffPrompt')); if (reason) act(() => post(`/finance/receivables/${r.id}/write-off`, { reason })); }}>{t('fin.writeOff')}</button></>}</td></tr>)}</tbody></table></div>}
    </div>
  );
}

function Expenses() {
  const { t, lang } = useI18n(); const { me, meta } = useSession(); const cur = me!.profile.currency; const tz = me!.profile.timezone; const m = (n: number) => fmtMoney(n, cur, lang);
  const list = useAsync(() => get('/finance/expenses'), []); const sum = useAsync(() => get('/finance/payables/summary'), []); const cats = useCats('expense'); const projects = useAsync(() => get('/work/projects'), []);
  const [f, setF] = useState<any>({ description: '', payee: '', category_id: '', amount: '', expense_date: today(tz), due_date: '', project_id: '', recurrence: 'none', occurrences: 3 });
  const [open, setOpen] = useState(false); const [err, setErr] = useState<unknown>(null); const [pay, setPay] = useState<any>(null); const reload = () => { list.reload(); sum.reload(); };
  async function add(e: FormEvent) {
    e.preventDefault(); setErr(null); const amt = normalizeMoneyInput(f.amount); if (!amt) { setErr({ code: 'invalid_money' }); return; }
    try { await post('/finance/expenses', { description: f.description, payee: f.payee || null, category_id: f.category_id || cats[0]?.id, project_id: f.project_id || null, amount: amt, expense_date: f.expense_date, due_date: f.due_date || null, recurrence: f.recurrence, ...(f.recurrence !== 'none' ? { occurrences: Number(f.occurrences) } : {}) }); setOpen(false); setF({ ...f, description: '', amount: '' }); reload(); } catch (x) { setErr(x); }
  }
  async function payIt(e: FormEvent) { e.preventDefault(); setErr(null); const amt = normalizeMoneyInput(pay.amount); if (!amt) { setErr({ code: 'invalid_money' }); return; } try { await post(`/finance/expenses/${pay.id}/payments`, { amount: amt, date: pay.date, method: pay.method, idempotency_key: pay.key }); setPay(null); reload(); } catch (x) { setErr(x); } }
  return (
    <div className="stack">
      {sum.data && <><div className="grid g3"><Kpi label={t('fin.payables')} value={m(sum.data.total_payable_cents)} /><Kpi label={t('fin.overdue')} value={m(sum.data.overdue_cents)} tone={sum.data.overdue_cents > 0 ? 'neg' : undefined} /><Kpi label={t('fin.dueWeek')} value={m(sum.data.due_this_week_cents)} /><Kpi label={t('fin.dueMonth')} value={m(sum.data.due_this_month_cents)} /><Kpi label={t('fin.helperOwed')} value={m(sum.data.helper_payable_total_cents)} sub={t('fin.helperSeparate')} /></div></>}
      <div className="row between"><span /><button onClick={() => setOpen(!open)}>+ {t('fin.newExp')}</button></div>
      {open && <form className="card stack" onSubmit={add}><div className="grid g2">
        <Field label={t('common.description')} id="d"><input id="d" required value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label={t('fin.payee')} id="p"><input id="p" value={f.payee} onChange={(e) => setF({ ...f, payee: e.target.value })} /></Field>
        <Field label={t('fin.category')} id="c"><select id="c" value={f.category_id || cats[0]?.id || ''} onChange={(e) => setF({ ...f, category_id: e.target.value })}>{cats.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label={t('nav.projects')} id="pr"><select id="pr" value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}><option value="">—</option>{projects.data?.projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label={`${t('common.amount')} (${cur})`} id="a"><MoneyInput id="a" required value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
        <Field label={t('common.date')} id="ed"><input id="ed" type="date" required value={f.expense_date} onChange={(e) => setF({ ...f, expense_date: e.target.value })} /></Field>
        <Field label={t('fin.dueDate')} id="dd"><input id="dd" type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
        <Field label={t('fin.recurrence')} id="rc"><div className="row"><select id="rc" value={f.recurrence} onChange={(e) => setF({ ...f, recurrence: e.target.value })} style={{ width: 'auto' }}>{['none', 'weekly', 'monthly', 'yearly'].map((r) => <option key={r} value={r}>{t(`rec.${r}`)}</option>)}</select>{f.recurrence !== 'none' && <input aria-label={t('fin.occurrences')} type="number" min={2} max={60} value={f.occurrences} onChange={(e) => setF({ ...f, occurrences: e.target.value })} style={{ width: 90 }} />}</div></Field></div>
        <ErrorBox error={err} /><div><button>{t('common.save')}</button></div></form>}
      <ErrorBox error={list.error ?? err} />
      {pay && <form className="card stack" onSubmit={payIt}><h2>{t('fin.recordPayment')}: {pay.description}</h2><div className="grid g3">
        <Field label={`${t('common.amount')} (${cur})`} id="pa"><MoneyInput id="pa" required value={pay.amount} onChange={(v) => setPay({ ...pay, amount: v })} /></Field>
        <Field label={t('pay.method')} id="pm"><select id="pm" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{(meta?.payment_methods ?? []).map((x: string) => <option key={x} value={x}>{t(`method.${x}`)}</option>)}</select></Field>
        <Field label={t('common.date')} id="pd"><input id="pd" type="date" required max={today(tz)} value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></Field></div><div className="row"><button>{t('common.save')}</button><button type="button" className="secondary" onClick={() => setPay(null)}>{t('common.cancel')}</button></div></form>}
      {!list.data ? <Loading /> : <div className="card tablewrap"><table><thead><tr><th>{t('common.description')}</th><th>{t('fin.dueDate')}</th><th className="num">{t('common.amount')}</th><th className="num">{t('pay.paid')}</th><th>{t('common.status')}</th><th /></tr></thead><tbody>
        {list.data.expenses.length === 0 && <tr><td colSpan={6} className="muted">{t('common.none')}</td></tr>}
        {list.data.expenses.map((x: any) => <tr key={x.id}><td>{x.description}<div className="small muted">{x.payee} · {x.category_name} · {fmtDate(x.expense_date, lang)}</div></td><td className="nowrap">{fmtDate(x.due_date, lang)}</td><td className="num">{fmtMoney(x.amount_cents, x.currency, lang)}</td><td className="num">{fmtMoney(x.paid_cents, x.currency, lang)}</td><td><Badge kind={SK[x.display_status]}>{t(`st.${x.display_status}`)}</Badge></td>
          <td>{x.outstanding_cents > 0 && ['open', 'partial', 'overdue'].includes(x.status) && <button className="small" onClick={() => setPay({ id: x.id, description: x.description, amount: (x.outstanding_cents / 100).toFixed(2), method: 'zelle', date: today(tz), key: crypto.randomUUID() })}>{t('fin.pay')}</button>}</td></tr>)}</tbody></table></div>}
    </div>
  );
}

function CashMoves() {
  const { t, lang } = useI18n(); const { me } = useSession(); const cur = me!.profile.currency; const tz = me!.profile.timezone; const list = useAsync(() => get('/finance/cash-movements'), []);
  const [f, setF] = useState({ kind: 'financing', direction: 'in', amount: '', move_date: today(tz), description: '' }); const [err, setErr] = useState<unknown>(null);
  async function add(e: FormEvent) { e.preventDefault(); setErr(null); const amt = normalizeMoneyInput(f.amount); if (!amt) { setErr({ code: 'invalid_money' }); return; } try { await post('/finance/cash-movements', { ...f, amount: amt }); setF({ ...f, amount: '', description: '' }); list.reload(); } catch (x) { setErr(x); } }
  return (
    <div className="stack"><Alert>{t('fin.cashMovesNote')}</Alert>
      <form className="card stack" onSubmit={add}><div className="grid g3">
        <Field label={t('fin.kind')} id="k"><select id="k" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="investing">{t('fin.investing')}</option><option value="financing">{t('fin.financing')}</option></select></Field>
        <Field label={t('fin.direction')} id="di"><select id="di" value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}><option value="in">{t('fin.in')}</option><option value="out">{t('fin.out')}</option></select></Field>
        <Field label={`${t('common.amount')} (${cur})`} id="a"><MoneyInput id="a" required value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
        <Field label={t('common.date')} id="dt"><input id="dt" type="date" required value={f.move_date} onChange={(e) => setF({ ...f, move_date: e.target.value })} /></Field>
        <Field label={t('common.description')} id="ds"><input id="ds" required value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field></div><ErrorBox error={err} /><div><button>{t('common.add')}</button></div></form>
      <div className="card">{(list.data?.movements ?? []).length === 0 && <p className="muted">{t('common.none')}</p>}{list.data?.movements.map((x: any) => <div className="list-item" key={x.id}><div className="grow">{x.description}<div className="small muted">{t(`fin.${x.kind}`)} · {fmtDate(x.move_date, lang)}</div></div><b className={x.direction === 'in' ? 'pos' : 'neg'}>{x.direction === 'in' ? '+' : '−'}{fmtMoney(x.amount_cents, x.currency, lang)}</b><button className="small secondary" onClick={async () => { await post(`/finance/cash-movements/${x.id}/void`); list.reload(); }}>{t('common.void')}</button></div>)}</div></div>
  );
}

const CLASSES: Record<string, string[]> = { revenue: ['revenue_services', 'revenue_other', 'financial_income'], expense: ['deduction', 'direct_cost', 'operating', 'financial_expense', 'other_expense'] };
function Categories() {
  const { t } = useI18n(); const list = useAsync(() => get('/finance/categories'), []); const [f, setF] = useState({ kind: 'expense', name: '', dre_class: 'operating' }); const [err, setErr] = useState<unknown>(null);
  async function add(e: FormEvent) { e.preventDefault(); setErr(null); try { await post('/finance/categories', f); setF({ ...f, name: '' }); list.reload(); } catch (x) { setErr(x); } }
  return (
    <div className="stack"><Alert>{t('fin.classNote')}</Alert>
      <form className="card stack" onSubmit={add}><div className="grid g3">
        <Field label={t('fin.kind')} id="k"><select id="k" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, dre_class: CLASSES[e.target.value]![0]! })}><option value="revenue">{t('fin.revenue')}</option><option value="expense">{t('fin.expenses')}</option></select></Field>
        <Field label={t('common.name')} id="n"><input id="n" required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={t('fin.dreClass')} id="c"><select id="c" value={f.dre_class} onChange={(e) => setF({ ...f, dre_class: e.target.value })}>{CLASSES[f.kind]!.map((c) => <option key={c} value={c}>{t(`dre.${c}`)}</option>)}</select></Field></div><ErrorBox error={err} /><div><button>{t('common.add')}</button></div></form>
      <div className="card tablewrap"><table><thead><tr><th>{t('common.name')}</th><th>{t('fin.dreClass')}</th><th /></tr></thead><tbody>{list.data?.categories.map((c: any) => <tr key={c.id} style={{ opacity: c.active ? 1 : .5 }}><td>{c.name}</td><td>{t(`dre.${c.dre_class}`)}</td><td><button className="small secondary" onClick={async () => { const { patch } = await import('../api'); await patch(`/finance/categories/${c.id}`, { active: !c.active }); list.reload(); }}>{c.active ? t('common.disable') : t('common.enable')}</button></td></tr>)}</tbody></table></div></div>
  );
}
