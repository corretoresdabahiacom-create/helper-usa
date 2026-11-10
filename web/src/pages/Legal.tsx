import { Link, useParams } from 'react-router-dom';
import { useT } from '../i18n';

const DOCS = ['terms', 'privacy', 'messaging', 'financial', 'aup'] as const;

export function Legal() {
  const t = useT();
  const { doc = 'terms' } = useParams();
  const key = (DOCS as readonly string[]).includes(doc) ? doc : 'terms';
  const blocks = t(`legal.${key}.body`).split(/\n\n+/);
  return (
    <main className="card" style={{ maxWidth: 760, margin: '16px auto' }}>
      <p><Link to="/">← {t('legal.back')}</Link></p>
      <div className="alert warn" role="note">{t('legal.draft')}</div>
      <nav className="tabs" aria-label="Legal">
        {DOCS.map((d) => <Link key={d} to={`/legal/${d}`} className={d === key ? 'active' : ''}>{t(`legal.${d}`)}</Link>)}
      </nav>
      <h1>{t(`legal.${key}`)}</h1>
      {blocks.map((b, i) => b.startsWith('# ') ? <h2 key={i}>{b.slice(2)}</h2> : <p key={i}>{b}</p>)}
    </main>
  );
}
