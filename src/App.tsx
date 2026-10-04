import { useEffect, useState } from 'react';
import { DATA_CONFIG } from './config/dataConfig';
import { FleetScene } from './scene/FleetScene';
import { createServices, type Services } from './services';
import { bindServicesToStore, useFleetStore } from './store/fleetStore';
import { ServicesContext } from './store/servicesContext';
import { DispatchConsole } from './ui/DispatchConsole';
import { FleetPanel } from './ui/FleetPanel';
import { MapControls } from './ui/MapControls';
import { OperationsPanel } from './ui/OperationsPanel';
import { ActivityFeed, AlertsPanel, CallDriverModal } from './ui/SideFeeds';
import { Toasts } from './ui/Toasts';
import { TopBar } from './ui/TopBar';
import { VehiclePanel } from './ui/VehiclePanel';

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
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const st = useFleetStore.getState();
      if (e.key === 'Escape') st.dispatchOpen ? st.set({ dispatchOpen: false }) : st.select(null);
      if (e.key === 'o') st.setView(st.view === 'OPERATIONS' ? 'COMMAND' : 'OPERATIONS');
      if (e.key === 'b') st.camera({ kind: 'preset', preset: 'BASE' });
      if (e.key === 'c') st.camera({ kind: 'preset', preset: 'CITY' });
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
          {DATA_CONFIG.DATA_MODE === 'LIVE' && ` · backend ${DATA_CONFIG.API_BASE_URL} — run "npm run server" or switch to MOCK.`}
        </p>
      </div>
    );
  }
  if (!services) {
    return (
      <div className="boot">
        <img src="/brand/zencabs-mark.png" alt="ZenCabs" />
        <div className="tagline">RIDE THE FUTURE</div>
        <p>Connecting to {DATA_CONFIG.DATA_MODE === 'MOCK' ? 'fleet simulation' : 'ZenCabs backend'}…</p>
      </div>
    );
  }
  return (
    <ServicesContext.Provider value={services}>
      <Shell />
    </ServicesContext.Provider>
  );
}

function Shell() {
  const view = useFleetStore((s) => s.view);
  const selected = useFleetStore((s) => s.selectedVehicleId);
  return (
    <div className={`app view-${view.toLowerCase()}`}>
      <div className="scene">
        <FleetScene />
      </div>
      <TopBar />
      {view === 'OPERATIONS' ? <OperationsPanel /> : <FleetPanel />}
      {selected ? (
        <VehiclePanel />
      ) : (
        <div className="right-stack">
          <AlertsPanel />
          <ActivityFeed />
        </div>
      )}
      <MapControls />
      <DispatchConsole />
      <CallDriverModal />
      <Toasts />
    </div>
  );
}
