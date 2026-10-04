import { formatClock, formatINR } from '../core/format';
import { useFleetStore, type FleetFilter } from '../store/fleetStore';
import { useServices } from '../store/servicesContext';

const SPEEDS = [1, 3, 10, 20];

export function TopBar() {
  const services = useServices();
  const { analyticsService, simulation, mode } = services;
  const vehicles = useFleetStore((s) => s.vehicles);
  const now = useFleetStore((s) => s.now);
  useFleetStore((s) => s.analyticsVersion);
  const view = useFleetStore((s) => s.view);
  const setView = useFleetStore((s) => s.setView);
  const filter = useFleetStore((s) => s.filter);
  const setFilter = useFleetStore((s) => s.setFilter);
  const connection = useFleetStore((s) => s.connection);
  const simSpeed = useFleetStore((s) => s.simSpeed);
  const set = useFleetStore((s) => s.set);
  const st = analyticsService.fleetStatus(vehicles);
  const totals = analyticsService.totals();

  const kpis: { label: string; value: number | string; filter: FleetFilter; tone: string }[] = [
    { label: 'Total fleet', value: st.totalFleet, filter: 'ALL', tone: 'neutral' },
    { label: 'On trip', value: st.onTrip, filter: 'ON_TRIP', tone: 'blue' },
    { label: 'Available', value: st.available, filter: 'AVAILABLE', tone: 'green' },
    { label: 'Parked > 1 hr', value: st.parkedOverOneHour, filter: 'PARKED_1H', tone: 'orange' },
    { label: 'Maintenance', value: st.maintenance, filter: 'MAINTENANCE', tone: 'amber' },
    { label: 'Offline', value: st.offline, filter: 'OFFLINE', tone: 'slate' },
  ];
  const secondary: { label: string; value: number | string; filter?: FleetFilter }[] = [
    { label: 'En route / waiting', value: st.byStatus.ASSIGNED + st.byStatus.EN_ROUTE_PICKUP + st.byStatus.WAITING, filter: 'BUSY' },
    { label: 'Returning', value: st.byStatus.RETURNING_TO_BASE, filter: 'RETURNING_TO_BASE' },
    { label: 'At base', value: st.atBase, filter: 'AT_BASE' },
    { label: 'Open requests', value: totals.pendingRequests },
    { label: 'Utilisation', value: `${totals.utilizationPct}%` },
    { label: 'Revenue today', value: formatINR(totals.revenueToday) },
  ];

  return (
    <header className="topbar">
      <div className="brand">
        <div className="logo">Z</div>
        <div>
          <b>ZenCabs</b>
          <span>Fleet Command Center · Jammu</span>
        </div>
      </div>

      <div className="kpis">
        {kpis.map((k) => (
          <button key={k.label} className={`kpi tone-${k.tone} ${filter === k.filter && k.filter !== 'ALL' ? 'active' : ''}`} onClick={() => setFilter(filter === k.filter ? 'ALL' : k.filter)}>
            <b>{k.value}</b>
            <span>{k.label}</span>
          </button>
        ))}
        <div className="kpi-secondary">
          {secondary.map((k) => (
            <button key={k.label} className={filter === k.filter ? 'active' : ''} disabled={!k.filter} onClick={() => k.filter && setFilter(filter === k.filter ? 'ALL' : k.filter)}>
              <span>{k.label}</span>
              <b>{k.value}</b>
            </button>
          ))}
        </div>
      </div>

      <div className="top-right">
        <div className={`mode-badge ${mode.toLowerCase()}`} title={mode === 'MOCK' ? 'Simulated data — services return mock data (DATA_MODE = "MOCK")' : 'Live ZenCabs backend (DATA_MODE = "LIVE")'}>
          <i className={`dot ${connection}`} />
          {mode === 'MOCK' ? 'SIMULATION' : 'LIVE'}
        </div>
        <div className="clock">
          <b>{formatClock(now)}</b>
          {simulation && (
            <div className="speeds">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  className={simSpeed === s ? 'active' : ''}
                  onClick={() => {
                    simulation.setSpeed(s);
                    set({ simSpeed: s });
                  }}
                >
                  {s}×
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="view-toggle">
          <button className={view === 'COMMAND' ? 'active' : ''} onClick={() => setView('COMMAND')}>
            Command
          </button>
          <button className={view === 'OPERATIONS' ? 'active' : ''} onClick={() => setView('OPERATIONS')}>
            Operations
          </button>
        </div>
        <button className="btn primary" onClick={() => set({ dispatchOpen: true })}>
          + Ride request
        </button>
      </div>
    </header>
  );
}
