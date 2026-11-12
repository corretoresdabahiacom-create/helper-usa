import { Fragment, useState } from 'react';
import { download, get } from '../api';
import { PeriodSelector, defaultPeriod, periodQuery, periodReady, type PeriodState } from '../components/Period';
import { fmtDate, fmtMoney } from '../format';
import { useI18n } from '../i18n';
import { useSession } from '../session';
import { Alert, ErrorBox, Loading, Tabs, useAsync } from '../ui';

type Tab = 'dre' | 'cash' | 'lists';
const DRE_ROWS = (d: any) => [
  ['gross', d.gross_revenue.total_cents, d.gross_revenue.lines, 'b'], ['deductions', -d.deductions.total_cents, d.deductions.lines, ''],
  ['netRevenue', d.net_revenue_cents, null, 'b'],
  ['directCosts', -d.direct_costs.total_cents, [{ name: 'labor', amount_cents: d.direct_costs.labor_cents }, ...d.direct_costs.lines], ''],
  ['grossProfit', d.gross_profit_cents, null, 'b'],
  ['opex', -d.operating_expenses.total_cents, d.operating_expenses.bad_debt_cents ? [...d.operating_expenses.lines, { name: 'badDebt', amount_cents: d.operating_expenses.bad_debt_cents }] : d.operating_expenses.lines, ''],
  ['operatingResult', d.operating_result_cents, null, 'b'], ['financial', d.financial.result_cents, null, ''], ['other', -d.other_items.total_cents, d.other_items.lines, ''], ['netResult', d.net_result_cents, null, 'b'],
] as [string, number, { name: string; amount_cents: number }[] | null, string][];

export default function Reports() {
  const { t } = useI18n(); const [tab, setTab] = useState<Tab>('dre');
  return <div className="stack"><h1>{t('nav.reports')}</h1><Tabs value={tab} onChange={setTab} items={[['dre', t('rep.dre')], ['cash', t('rep.cash')], ['lists', t('rep.exports')]]} />{tab === 'dre' && <Dre />}{tab === 'cash' && <Cash />}{tab === 'lists' && <Lists />}</div>;
}

function Dre() {
  const { t, lang } = useI18n(); const { me } = useSession(); const cur = me!.profile.currency;
  const [p, setP] = useState<PeriodState>(defaultPeriod); const [basis, setBasis] = useState<'accrual' | 'cash'>(me!.profile.accounting_basis); const [cmp, setCmp] = useState(false);
  const qs = `${periodQuery(p)}&basis=${basis}${cmp ? '&compare=previous' : ''}`;
  const { data: d, error, loading } = useAsync(() => (periodReady(p) ? get(`/finance/dre?${qs}`) : Promise.resolve(null)), [qs]);
  const dl = (fmt: 'csv' | 'pdf') => download(`/reports/dre?${periodQuery(p)}&basis=${basis}&format=${fmt}`, `dre-${basis}.${fmt}`);
  const lineName = (n: string) => (['labor', 'badDebt'].includes(n) ? t(`dre.${n}`) : n);
  return (
    <div className="stack"><div className="row between"><div className="row"><PeriodSelector value={p} onChange={setP} /><select aria-label={t('fin.basis')} value={basis} onChange={(e) => setBasis(e.target.value as any)} style={{ width: 'auto' }}><option value="accrual">{t('fin.accrual')}</option><option value="cash">{t('fin.cash')}</option></select><label><input type="checkbox" checked={cmp} onChange={(e) => setCmp(e.target.checked)} /> {t('rep.comparePrev')}</label></div><div className="row"><button className="secondary small" onClick={() => dl('csv')}>CSV</button><button className="secondary small" onClick={() => dl('pdf')}>PDF</button></div></div>
      <Alert>{basis === 'accrual' ? t('rep.accrualNote') : t('rep.cashNote')}</Alert><ErrorBox error={error} />
      {loading && !d ? <Loading /> : d && <div className="card tablewrap" tabIndex={0} role="region" aria-label="Table"><table><thead><tr><th>{fmtDate(d.period.from, lang)} – {fmtDate(d.period.to, lang)} ({cur})</th><th className="num">{t('rep.current')}</th>{d.compare && <th className="num">{fmtDate(d.compare.period.from, lang)} – {fmtDate(d.compare.period.to, lang)}</th>}</tr></thead><tbody>
        {DRE_ROWS(d).map(([k, v, lines, b], i) => { const cv = d.compare ? DRE_ROWS(d.compare)[i]![1] : null; return (<Fragment key={k}>
          <tr style={b ? { fontWeight: 700, background: 'rgba(20,45,82,.05)' } : undefined}><td>{t(`dre.${k}`)}</td><td className="num">{fmtMoney(v, cur, lang)}</td>{d.compare && <td className="num">{fmtMoney(cv, cur, lang)}</td>}</tr>
          {lines?.filter((l) => l.amount_cents !== 0).map((l) => <tr key={k + l.name}><td style={{ paddingLeft: '1.5rem' }} className="muted small">{lineName(l.name)}</td><td className="num small muted">{fmtMoney(l.amount_cents, cur, lang)}</td>{d.compare && <td />}</tr>)}</Fragment>); })}
        <tr><td>{t('dre.margin')}</td><td className="num">{d.profit_margin_bps === null ? '—' : `${(d.profit_margin_bps / 100).toFixed(1)}%`}</td>{d.compare && <td className="num">{d.compare.profit_margin_bps === null ? '—' : `${(d.compare.profit_margin_bps / 100).toFixed(1)}%`}</td>}</tr></tbody></table>
        {Object.keys(d.excluded_currencies).length > 0 && <Alert kind="warn">{t('fin.otherCurrencies')}: {Object.entries(d.excluded_currencies).map(([k, n]) => `${k} (${n})`).join(', ')}</Alert>}<p className="small muted">{d.disclaimer}</p></div>}
    </div>
  );
}

function Cash() {
  const { t, lang } = useI18n(); const { me } = useSession(); const cur = me!.profile.currency; const [p, setP] = useState<PeriodState>(defaultPeriod);
  const { data: d, error, loading } = useAsync(() => (periodReady(p) ? get(`/finance/cashflow?${periodQuery(p)}`) : Promise.resolve(null)), [p]); const m = (n: number) => fmtMoney(n, cur, lang);
  const dl = (fmt: 'csv' | 'pdf') => download(`/reports/cashflow?${periodQuery(p)}&format=${fmt}`, `cashflow.${fmt}`);
  const R = ({ l, v, b }: { l: string; v: number; b?: boolean }) => <tr style={b ? { fontWeight: 700, background: 'rgba(20,45,82,.05)' } : undefined}><td>{l}</td><td className="num">{m(v)}</td></tr>;
  return (
    <div className="stack"><div className="row between"><PeriodSelector value={p} onChange={setP} /><div className="row"><button className="secondary small" onClick={() => dl('csv')}>CSV</button><button className="secondary small" onClick={() => dl('pdf')}>PDF</button></div></div><Alert>{t('rep.cashFlowNote')}</Alert><ErrorBox error={error} />
      {loading && !d ? <Loading /> : d && <div className="card tablewrap" tabIndex={0} role="region" aria-label="Table">{d.warnings.map((w: string) => <Alert key={w} kind="warn">{t(`rep.warn.${w}`)}</Alert>)}<table><tbody>
        <R l={t('cf.opening')} v={d.opening_cents} b /><tr><th colSpan={2}>{t('cf.operating')}</th></tr><R l={t('cf.receipts')} v={d.operating.receipts_cents} /><R l={t('cf.expensePayments')} v={-d.operating.expense_payments_cents} /><R l={t('cf.helperPayments')} v={-d.operating.helper_payments_cents} /><R l={t('cf.operatingNet')} v={d.operating.net_cents} b />
        <tr><th colSpan={2}>{t('cf.investing')}</th></tr><R l={t('fin.in')} v={d.investing.in_cents} /><R l={t('fin.out')} v={-d.investing.out_cents} /><R l={t('cf.investingNet')} v={d.investing.net_cents} b />
        <tr><th colSpan={2}>{t('cf.financing')}</th></tr><R l={t('fin.in')} v={d.financing.in_cents} /><R l={t('fin.out')} v={-d.financing.out_cents} /><R l={t('cf.financingNet')} v={d.financing.net_cents} b />
        <R l={t('cf.netMovement')} v={d.net_movement_cents} b /><R l={t('cf.closing')} v={d.closing_cents} b /></tbody></table><p className="small muted">{d.disclaimer}</p></div>}
    </div>
  );
}

function Lists() {
  const { t } = useI18n(); const [err, setErr] = useState<unknown>(null);
  const items: [string, string, string[]][] = [['receivables', t('fin.receivables'), ['csv']], ['expenses', t('fin.expenses'), ['csv']], ['helper-payments', t('pay.title'), ['csv']]];
  return <div className="card stack"><ErrorBox error={err} /><p className="muted small">{t('rep.xlsxNote')}</p>{items.map(([k, label, fm]) => <div className="list-item" key={k}><div className="grow">{label}</div>{fm.map((f) => <button key={f} className="secondary small" onClick={() => download(`/reports/${k}?format=${f}`, `${k}.${f}`).catch(setErr)}>{f.toUpperCase()}</button>)}<button className="secondary small" onClick={() => download(`/reports/${k}?format=pdf`, `${k}.pdf`).catch(setErr)}>PDF</button></div>)}</div>;
}
