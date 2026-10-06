import { Bell, Car, ChevronsLeft, ChevronsRight, LayoutDashboard, Lightbulb, MoreHorizontal, Search, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { formatClock } from '../../core/format';
import { useFleetStore, type Page } from '../../store/fleetStore';
import { useServices } from '../../store/servicesContext';
import { useBreakpoint } from '../../store/useBreakpoint';
import { actionItems } from '../attention';

/** Only real, data-backed destinations — no placeholder modules. */
export const NAV: { page: Page; label: string; icon: typeof Car }[] = [
  { page: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { page: 'fleet', label: 'Fleet & vehicles', icon: Car },
  { page: 'drivers', label: 'Drivers', icon: Users },
  { page: 'insights', label: 'Insights', icon: Lightbulb },
];

const SPEEDS = [1, 3, 10, 20];

export function Sidebar() {
  const bp = useBreakpoint();
  const page = useFleetStore((s) => s.page);
  const setPage = useFleetStore((s) => s.setPage);
  const [pinned, setPinned] = useState<boolean | null>(null);
  const expanded = pinned ?? bp === 'desktop';
  return (
    <nav className={`sidebar ${expanded ? 'expanded' : 'rail'}`} aria-label="Main">
      <div className="sb-brand">{expanded ? <img src="/brand/zencabs-logo.png" alt="ZenCabs" /> : <img className="mark" src="/brand/zencabs-mark.png" alt="ZenCabs" />}</div>
      {expanded && <div className="sb-group">Operations</div>}
      <ul>
        {NAV.map(({ page: p, label, icon: Icon }) => (
          <li key={p}>
            <button className={`sb-item ${page === p ? 'active' : ''}`} onClick={() => setPage(p)} title={expanded ? undefined : label} aria-current={page === p ? 'page' : undefined}>
              <Icon size={20} strokeWidth={1.9} />
              {expanded && <span>{label}</span>}
            </button>
          </li>
        ))}
      </ul>
      <button className="sb-collapse" onClick={() => setPinned(!expanded)} title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}>
        {expanded ? <ChevronsLeft size={18} /> : <ChevronsRight size={18} />}
      </button>
    </nav>
  );
}

/** Simulation badge + speed. MOCK only; in LIVE mode shows a live badge. */
export function DataModeControl({ compact = false }: { compact?: boolean }) {
  const { simulation, mode } = useServices();
  const simSpeed = useFleetStore((s) => s.simSpeed);
  const connection = useFleetStore((s) => s.connection);
  const set = useFleetStore((s) => s.set);
  return (
    <div className="datamode">
      <span className={`mode-badge ${mode.toLowerCase()}`} title={mode === 'MOCK' ? 'Simulated data (DATA_MODE = "MOCK")' : 'Live ZenCabs backend (DATA_MODE = "LIVE")'}>
        <i className={`dot ${connection}`} />
        {mode === 'MOCK' ? 'Simulation' : 'Live'}
      </span>
      {simulation && !compact && (
        <div className="segmented speeds" role="group" aria-label="Simulation speed">
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
  );
}

function useAttentionCount() {
  const alerts = useFleetStore((s) => s.alerts);
  const vehicleMap = useFleetStore((s) => s.vehicleMap);
  const now = useFleetStore((s) => s.now);
  const { mapService } = useServices();
  return actionItems(alerts, vehicleMap, mapService.zones, now).length;
}

export function Header() {
  const now = useFleetStore((s) => s.now);
  const set = useFleetStore((s) => s.set);
  const setPage = useFleetStore((s) => s.setPage);
  const attention = useAttentionCount();
  return (
    <header className="app-header">
      <button className="search-trigger" onClick={() => set({ paletteOpen: true })}>
        <Search size={18} />
        <span>Search vehicles, drivers, bays or places…</span>
        <kbd>⌘K</kbd>
      </button>
      <div className="header-right">
        <DataModeControl />
        <span className="clock num" title="Simulation clock">
          {formatClock(now)}
        </span>
        <button
          className="icon-btn"
          title={`${attention} item${attention === 1 ? '' : 's'} need attention`}
          onClick={() => {
            setPage('dashboard');
            requestAnimationFrame(() => document.getElementById('action-center')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
          }}
        >
          <Bell size={20} />
          {attention > 0 && <span className="badge-count">{attention}</span>}
        </button>
        <div className="profile">
          <span className="avatar initials">OM</span>
          <span className="profile-text">
            <b>Operations</b>
            <span>Manager</span>
          </span>
        </div>
      </div>
    </header>
  );
}

export function MobileHeader() {
  const set = useFleetStore((s) => s.set);
  const page = useFleetStore((s) => s.page);
  const attention = useAttentionCount();
  const title = NAV.find((n) => n.page === page)?.label ?? 'Dashboard';
  return (
    <header className="app-header mobile">
      <img className="mark" src="/brand/zencabs-mark.png" alt="ZenCabs" />
      <h1>{page === 'dashboard' ? 'Command center' : title}</h1>
      <button className="icon-btn" aria-label="Search" onClick={() => set({ paletteOpen: true })}>
        <Search size={20} />
      </button>
      <button className="icon-btn" aria-label="Needs attention" onClick={() => set({ page: 'dashboard', sheet: 'half', selectedVehicleId: null })}>
        <Bell size={20} />
        {attention > 0 && <span className="badge-count">{attention}</span>}
      </button>
      <button className="icon-btn" aria-label="Settings" onClick={() => set({ settingsOpen: true })}>
        <MoreHorizontal size={20} />
      </button>
    </header>
  );
}

export function BottomNav() {
  const page = useFleetStore((s) => s.page);
  const setPage = useFleetStore((s) => s.setPage);
  return (
    <nav className="bottom-nav" aria-label="Main">
      {NAV.map(({ page: p, label, icon: Icon }) => (
        <button key={p} className={page === p ? 'active' : ''} onClick={() => setPage(p)} aria-current={page === p ? 'page' : undefined}>
          <Icon size={22} strokeWidth={1.9} />
          <span>{p === 'fleet' ? 'Fleet' : label}</span>
        </button>
      ))}
    </nav>
  );
}

/** Page template (DESIGN.md §52): title, short context, one primary action. */
export function PageHeader({ title, context, action }: { title: ReactNode; context: ReactNode; action?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{context}</p>
      </div>
      {action}
    </div>
  );
}
