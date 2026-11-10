import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../api';
import { defaultPeriod, PeriodSelector, periodQuery, periodReady, type PeriodState } from '../components/Period';
import { fmtDate, fmtMoney } from '../format';
import { useI18n } from '../i18n';
import { useSession } from '../session';
import { Alert, BarChart, ErrorBox, Kpi, Loading, tone, useAsync } from '../ui';

export default function Dashboard() {
  const { t, lang } = useI18n(); const { me } = useSession(); const cur = me!.profile.currency;
  const [p, setP] = useState<PeriodState>(defaultPeriod); const [basis, setBasis] = useState<'accrual' | 'cash'>(me!.profile.accounting_basis);
  const { data: d, error, loading } = useAsync(() => (periodReady(p) ? get(`/finance/dashboard?${periodQuery(p)}&basis=${basis}`) : Promise.resolve(null)), [p, basis]);
  const m = (n: number | null) => fmtMoney(n, cur, lang);
  return (
    <div className="stack">
      <div className="row between"><h1>{t('nav.dashboard')}</h1>
        <div className="row"><PeriodSelector value={p} onChange={setP} />
          <select aria-label={t('fin.basis')} value={basis} onChange={(e) => setBasis(e.target.value as any)} style={{ width: 'auto' }}><option value="accrual">{t('fin.accrual')}</option><option value="cash">{t('fin.cash')}</option></select></div></div>
      <ErrorBox error={error} />
      {loading && !d ? <Loading /> : d && <>
        <p className="muted small">{fmtDate(d.period.from, lang)} – {fmtDate(d.period.to, lang)} · {t(`fin.${basis}`)} · {cur}</p>
        {d.cash_flow.warnings.includes('no_opening_balance') && <Alert kind="warn">{t('fin.noOpening')} <Link to="/settings">{t('nav.settings')}</Link></Alert>}
        {Object.keys(d.dre_summary.excluded_currencies).length > 0 && <Alert kind="warn">{t('fin.otherCurrencies')}: {Object.entries(d.dre_summary.excluded_currencies).map(([k, n]) => `${k} (${n})`).join(', ')}</Alert>}
        <div className="grid g3">
          <Kpi label={t('fin.revenue')} value={m(d.cards.total_revenue_cents)} />
          <Kpi label={t('fin.expenses')} value={m(d.cards.total_expenses_cents)} />
          <Kpi label={t('fin.grossProfit')} value={m(d.cards.gross_result_cents)} tone={tone(d.cards.gross_result_cents)} />
          <Kpi label={t('fin.netResult')} value={m(d.cards.net_result_cents)} tone={tone(d.cards.net_result_cents)} sub={d.dre_summary.profit_margin_bps === null ? undefined : `${(d.dre_summary.profit_margin_bps / 100).toFixed(1)}%`} />
          <Kpi label={t('fin.received')} value={m(d.cards.receipts_collected_cents)} sub={t('fin.cashBasisNote')} />
          <Kpi label={t('fin.paidOut')} value={m(d.cards.payments_made_cents)} sub={t('fin.cashBasisNote')} />
          <Kpi label={t('fin.cashBalance')} value={d.cards.cash_balance_cents === null ? '—' : m(d.cards.cash_balance_cents)} tone={d.cards.cash_balance_cents === null ? undefined : tone(d.cards.cash_balance_cents)} />
        </div>
        <div className="grid g2">
          <div className="card"><h2>{t('fin.receivables')}</h2><table><tbody>
            <tr><td>{t('fin.outstanding')}</td><td className="num">{m(d.receivables.total_outstanding_cents)}</td></tr>
            <tr><td>{t('fin.overdue')}</td><td className="num neg">{m(d.receivables.overdue_cents)}</td></tr>
            <tr><td>{t('fin.dueInPeriod')}</td><td className="num">{m(d.receivables.due_in_period_cents)}</td></tr></tbody></table></div>
          <div className="card"><h2>{t('fin.payables')}</h2><table><tbody>
            <tr><td>{t('fin.outstanding')}</td><td className="num">{m(d.payables.total_outstanding_cents)}</td></tr>
            <tr><td>{t('fin.overdue')}</td><td className="num neg">{m(d.payables.overdue_cents)}</td></tr>
            <tr><td>{t('fin.helperOwed')}</td><td className="num">{m(d.payables.helper_outstanding_cents)}</td></tr>
            <tr><td>{t('fin.helperPaidPeriod')}</td><td className="num">{m(d.helper_payments.paid_in_period_cents)}</td></tr></tbody></table></div>
        </div>
        <div className="card"><h2>{t('fin.last6')}</h2>
          <BarChart labels={d.monthly.map((x: any) => x.month)} a={d.monthly.map((x: any) => x.revenue_cents)} b={d.monthly.map((x: any) => x.expenses_cents)} aLabel={t('fin.revenue')} bLabel={t('fin.expenses')} /></div>
        <div className="card"><h2>{t('fin.cashLast6')}</h2>
          <BarChart labels={d.monthly.map((x: any) => x.month)} a={d.monthly.map((x: any) => x.cash_in_cents)} b={d.monthly.map((x: any) => x.cash_out_cents)} aLabel={t('fin.received')} bLabel={t('fin.paidOut')} /></div>
        <div className="grid g2">
          <div className="card"><h2>{t('fin.upcomingPay')}</h2>{d.upcoming_payments.length === 0 ? <p className="muted">{t('common.none')}</p> : d.upcoming_payments.map((x: any) => <div className="list-item" key={x.id}><div className="grow">{x.description}<div className="small muted">{fmtDate(x.due_date, lang)}</div></div><b>{m(x.outstanding_cents)}</b></div>)}</div>
          <div className="card"><h2>{t('fin.upcomingRec')}</h2>{d.upcoming_receipts.length === 0 ? <p className="muted">{t('common.none')}</p> : d.upcoming_receipts.map((x: any) => <div className="list-item" key={x.id}><div className="grow">{x.customer}<div className="small muted">{fmtDate(x.due_date, lang)}</div></div><b>{m(x.outstanding_cents)}</b></div>)}</div>
        </div>
        <div className="card"><h2>{t('fin.recent')}</h2>{d.recent_transactions.length === 0 ? <p className="muted">{t('common.none')}</p> : d.recent_transactions.map((x: any, i: number) => <div className="list-item" key={i}><div className="grow">{x.label}<div className="small muted">{t(`fin.tx.${x.type}`)} · {fmtDate(x.date, lang)}</div></div><b className={x.type === 'receipt' ? 'pos' : ''}>{x.type === 'receipt' ? '+' : '−'}{m(x.amount_cents)}</b></div>)}</div>
        <p className="small muted">{d.dre_summary.disclaimer}</p>
      </>}
    </div>
  );
}
