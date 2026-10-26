import React, { useEffect, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { WorldProvider, useWorld } from './state';
import { Header, Footer, AuthModal, Toast, Empty, LandNotices } from './components';
import { MapPage } from './Map';
const AccountPage = lazy(() => import('./pages').then((m) => ({ default: m.AccountPage })));
const MarketPage = lazy(() => import('./pages').then((m) => ({ default: m.MarketPage })));
const LeaderboardPage = lazy(() => import('./pages').then((m) => ({ default: m.LeaderboardPage })));
const StorePage = lazy(() => import('./pages').then((m) => ({ default: m.StorePage })));
const RulesPage = lazy(() => import('./pages').then((m) => ({ default: m.RulesPage })));
const PlayerPage = lazy(() => import('./pages').then((m) => ({ default: m.PlayerPage })));
const AdminPage = lazy(() => import('./pages').then((m) => ({ default: m.AdminPage })));
import { post } from './api';
import './style.css';

function App() {
  const { t, loading, error, load, authOpen, user, config, setToast } = useWorld();
  const location = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    if (user && (location.pathname === '/' || location.pathname.startsWith('/region')))
      void post('/events', { event: 'map' }).catch(() => {});
    if (location.search.includes('auth_error')) setToast(t('error_OAUTH_FAILED'));
  }, [location.pathname, user?.id]);
  return (
    <>
      <Header />
      {loading ? (
        <div className="initial-loading">
          <div className="loading-globe">◎</div>
          <p>{t('loading')}</p>
        </div>
      ) : error ? (
        <main className="page">
          <Empty title={error}>
            <button className="button primary" onClick={() => void load()}>
              {t('retry')}
            </button>
          </Empty>
        </main>
      ) : (
        <>
          {config && config.season.ends_at < Date.now() / 1000 && (
            <div className="season-ended">{t('seasonEnded')}</div>
          )}
          <LandNotices />
          <Suspense fallback={<main className="page">{t('loading')}</main>}>
            <Routes>
              <Route path="/" element={<MapPage />} />
              <Route path="/region/:regionId" element={<MapPage />} />
              <Route path="/territory/:territoryId" element={<MapPage />} />
              <Route path="/me" element={<AccountPage />} />
              <Route path="/player/:playerId" element={<PlayerPage />} />
              <Route path="/market" element={<MarketPage />} />
              <Route path="/leaderboard" element={<LeaderboardPage />} />
              <Route path="/store" element={<StorePage />} />
              <Route path="/rules" element={<RulesPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route
                path="*"
                element={
                  <main className="page">
                    <Empty title={t('error_NOT_FOUND')} />
                  </main>
                }
              />
            </Routes>
          </Suspense>
        </>
      )}
      <Footer />
      {authOpen && <AuthModal />}
      <Toast />
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <WorldProvider>
        <App />
      </WorldProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
