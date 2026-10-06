import { useEffect, useState } from 'react';
import { DATA_CONFIG } from './config/dataConfig';
import { cameraApi } from './scene/registry';
import { createServices, type Services } from './services';
import { bindServicesToStore, useFleetStore } from './store/fleetStore';
import { ServicesContext } from './store/servicesContext';
import { useBreakpoint } from './store/useBreakpoint';
import { CommandPalette } from './ui/CommandPalette';
import { DashboardPage } from './ui/dashboard/Dashboard';
import { DispatchConsole } from './ui/DispatchConsole';
import { BottomNav, Header, MobileHeader, Sidebar } from './ui/layout/Shell';
import { CallDriverModal, SettingsSheet, Toasts } from './ui/Overlays';
import { DriversPage, FleetPage } from './ui/pages/FleetPage';
import { InsightsPage } from './ui/pages/InsightsPage';
import { VehicleDrawer } from './ui/VehicleDrawer';

// One service container per page (React StrictMode mounts effects twice in dev).
let servicesPromise: Promise<Services> | null = null;
const getServices = () => (servicesPromise ??= createServices(DATA_CONFIG));

export function App() {
  const [services, setServices] = useState<Services | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unbind: (() => void) | undefined;
    let alive = true;
    getServices()
      .then((s) => {
        if (!alive) return;
        unbind = bindServicesToStore(s);
        setServices(s);
      })
      .catch((e) => alive && setError(String(e?.message ?? e)));
    return () => {
      alive = false;
      unbind?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useFleetStore.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        st.set({ paletteOpen: !st.paletteOpen });
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') {
        if (st.paletteOpen) st.set({ paletteOpen: false });
        else if (st.dispatchOpen) st.set({ dispatchOpen: false });
        else if (st.callDriverId) st.set({ callDriverId: null });
        else if (st.settingsOpen) st.set({ settingsOpen: false });
        else st.select(null);
        return;
      }
      if (st.paletteOpen || st.dispatchOpen) return;
      if (e.key === '/') (e.preventDefault(), st.set({ paletteOpen: true }));
      if (st.page !== 'dashboard') return;
      if (e.key === '+' || e.key === '=') cameraApi.current?.zoomBy(0.6);
      if (e.key === '-' || e.key === '_') cameraApi.current?.zoomBy(1 / 0.6);
      if (e.key === 'n') cameraApi.current?.resetNorth();
      if (e.key === 'b') st.camera({ kind: 'preset', preset: 'BASE' });
      if (e.key === 'c') st.camera({ kind: 'preset', preset: 'CITY' });
      if (e.key === 'r') st.camera({ kind: 'preset', preset: 'REGION' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (error) {
    return (
      <div className="boot error">
        <h1>Unable to start</h1>
        <p>{error}</p>
        <p className="muted">
          DATA_MODE = {DATA_CONFIG.DATA_MODE}
          {DATA_CONFIG.DATA_MODE === 'LIVE' && ` · backend ${DATA_CONFIG.API_BASE_URL}. Run "npm run server" or switch to MOCK.`}
        </p>
      </div>
    );
  }
  if (!services) {
    return (
      <div className="boot">
        <img src="/brand/zencabs-mark.png" alt="ZenCabs" />
        <div className="tagline">RIDE THE FUTURE</div>
        <p>Connecting to {DATA_CONFIG.DATA_MODE === 'MOCK' ? 'the fleet simulation' : 'the ZenCabs backend'}…</p>
      </div>
    );
  }
  return (
    <ServicesContext.Provider value={services}>
      <AppShell />
    </ServicesContext.Provider>
  );
}

function AppShell() {
  const bp = useBreakpoint();
  const page = useFleetStore((s) => s.page);
  const mobile = bp === 'mobile';
  const content = (
    <main className="content" id="content">
      {/* The dashboard (and its 3D scene) stays mounted so the map keeps its camera and GPU state. */}
      <div className="page-slot" hidden={page !== 'dashboard'}>
        <DashboardPage active={page === 'dashboard'} />
      </div>
      {page === 'fleet' && <FleetPage />}
      {page === 'drivers' && <DriversPage />}
      {page === 'insights' && <InsightsPage />}
    </main>
  );
  return (
    <div className={`app ${mobile ? 'is-mobile' : 'is-wide'} bp-${bp} page-${page}`}>
      {mobile ? (
        <>
          <MobileHeader />
          {content}
          <BottomNav />
        </>
      ) : (
        <>
          <Sidebar />
          <div className="main">
            <Header />
            {content}
          </div>
        </>
      )}
      <VehicleDrawer />
      <CommandPalette />
      <DispatchConsole />
      <CallDriverModal />
      <SettingsSheet />
      <Toasts />
    </div>
  );
}
