import { lazy, Suspense, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useI18n } from './i18n';
import { useSession } from './session';
import { Loading } from './ui';
import { Forgot, Login, Register, Reset, Verify } from './pages/Auth';
import { Legal } from './pages/Legal';
import { Portal } from './pages/Portal';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Helpers = lazy(() => import('./pages/Helpers'));
const Schedule = lazy(() => import('./pages/Schedule'));
const Money = lazy(() => import('./pages/Money'));
const Reports = lazy(() => import('./pages/Reports'));
const Messages = lazy(() => import('./pages/Messages'));
const Settings = lazy(() => import('./pages/Settings'));
const Admin = lazy(() => import('./pages/Admin'));
const Projects = lazy(() => import('./pages/Projects'));

const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const NAV: [string, string, string][] = [
  ['/', 'nav.dashboard', 'M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10'],
  ['/helpers', 'nav.helpers', 'M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 21c0-4 4-6 8-6s8 2 8 6'],
  ['/schedule', 'nav.schedule', 'M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z'],
  ['/projects', 'nav.projects', 'M3 7l9-4 9 4v10l-9 4-9-4V7zM3 7l9 4 9-4M12 11v10'],
  ['/money', 'nav.money', 'M12 3v18M16 7.5c0-1.5-1.8-2.5-4-2.5s-4 1-4 2.5 1.8 2.3 4 2.5 4 1 4 2.5-1.8 2.5-4 2.5-4-1-4-2.5'],
  ['/reports', 'nav.reports', 'M5 20V10M12 20V4M19 20v-7'],
  ['/messages', 'nav.messages', 'M4 5h16v11H9l-5 4V5z'],
  ['/settings', 'nav.settings', 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-2-4-2 1-2-1-1-2h-4l-1 2-2 1-2-1-2 4 2 1v2l-2 1 2 4 2-1 2 1 1 2h4l1-2 2-1 2 1 2-4-2-1v-2z'],
];

function Shell({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useI18n(); const { me, logout } = useSession();
  return (
    <div className="shell">
      <a className="skip" href="#main">{t('common.skip')}</a>
      <header className="topbar">
        <Link to="/" className="brand" style={{ color: '#fff', textDecoration: 'none' }}>HELPER CONNECT</Link>
        <span className="grow" />
        <label className="skip" htmlFor="lang">{t('common.language')}</label>
        <select id="lang" value={lang} onChange={(e) => setLang(e.target.value as any)} aria-label={t('common.language')}><option value="en">EN</option><option value="pt">PT</option><option value="es">ES</option></select>
        <button onClick={logout}>{t('nav.logout')}</button>
      </header>
      <nav className="tabbar" aria-label="Main">
        {NAV.map(([to, k, d]) => <NavLink key={to} to={to} end={to === '/'}><Icon d={d} /><span>{t(k)}</span></NavLink>)}
        {me?.is_admin && <NavLink to="/admin"><Icon d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" /><span>{t('nav.admin')}</span></NavLink>}
      </nav>
      <div className="content grow"><main id="main" className="main">{children}<p className="footer-note">{t('common.disclaimer')} · <Link to="/legal/terms">{t('legal.terms')}</Link> · <Link to="/legal/privacy">{t('legal.privacy')}</Link></p></main></div>
    </div>
  );
}

export function App() {
  const { me, loading } = useSession(); const loc = useLocation();
  if (loading) return <div className="auth"><Loading /></div>;
  return (
    <Routes>
      <Route path="/h/:token" element={<Portal />} />
      <Route path="/legal/:doc" element={<Legal />} />
      {!me ? (
        <>
          <Route path="/login" element={<Login />} /><Route path="/register" element={<Register />} />
          <Route path="/forgot" element={<Forgot />} /><Route path="/reset" element={<Reset />} /><Route path="/verify" element={<Verify />} />
          <Route path="*" element={<Navigate to="/login" replace state={{ from: loc.pathname }} />} />
        </>
      ) : (
        <>
          <Route path="/verify" element={<Verify />} />
          <Route path="/login" element={<Navigate to="/" replace />} /><Route path="/register" element={<Navigate to="/" replace />} />
          <Route path="*" element={
            <Shell><Suspense fallback={<Loading />}>
              <Routes>
                <Route path="/" element={<Dashboard />} /><Route path="/helpers/*" element={<Helpers />} /><Route path="/schedule/*" element={<Schedule />} />
                <Route path="/projects/*" element={<Projects />} /><Route path="/money/*" element={<Money />} /><Route path="/reports" element={<Reports />} />
                <Route path="/messages/*" element={<Messages />} /><Route path="/settings" element={<Settings />} />
                {me.is_admin && <Route path="/admin" element={<Admin />} />}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense></Shell>
          } />
        </>
      )}
    </Routes>
  );
}
