import { PERIOD_KINDS, type PeriodKind } from '../../../src/shared/dates';
import { useT } from '../i18n';

export interface PeriodState { period: PeriodKind; from: string; to: string }
export const defaultPeriod: PeriodState = { period: 'this_month', from: '', to: '' };
export const periodQuery = (p: PeriodState) => `period=${p.period}${p.period === 'custom' ? `&from=${p.from}&to=${p.to}` : ''}`;
export const periodReady = (p: PeriodState) => p.period !== 'custom' || (!!p.from && !!p.to && p.from <= p.to);

export function PeriodSelector({ value, onChange }: { value: PeriodState; onChange: (p: PeriodState) => void }) {
  const t = useT();
  return (
    <div className="row">
      <select aria-label={t('period.label')} value={value.period} onChange={(e) => onChange({ ...value, period: e.target.value as PeriodKind })} style={{ width: 'auto' }}>
        {PERIOD_KINDS.map((k) => <option key={k} value={k}>{t(`period.${k}`)}</option>)}
      </select>
      {value.period === 'custom' && <>
        <input type="date" aria-label={t('period.from')} value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} style={{ width: 'auto' }} />
        <input type="date" aria-label={t('period.to')} value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} style={{ width: 'auto' }} />
      </>}
    </div>
  );
}
