import { formatDuration, shortId, STATUS_COLORS } from '../core/format';
import { VEHICLE_STATUSES } from '../contracts/types';
import { matchesFilter, useFleetStore, type FleetFilter } from '../store/fleetStore';
import { StatusPill } from './common';

const FILTERS: { key: FleetFilter; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'ON_TRIP', label: 'On trip' },
  { key: 'AVAILABLE', label: 'Available' },
  { key: 'BUSY', label: 'En route' },
  { key: 'PARKED_1H', label: 'Parked >1h' },
  { key: 'AT_BASE', label: 'At base' },
  { key: 'MAINTENANCE', label: 'Maint.' },
  { key: 'OFFLINE', label: 'Offline' },
];

export function FleetPanel() {
  const vehicles = useFleetStore((s) => s.vehicles);
  const now = useFleetStore((s) => s.now);
  const filter = useFleetStore((s) => s.filter);
  const search = useFleetStore((s) => s.search);
  const selected = useFleetStore((s) => s.selectedVehicleId);
  const { setFilter, setSearch, select, hover } = useFleetStore.getState();
  const q = search.trim().toLowerCase();
  const list = vehicles
    .filter((v) => matchesFilter(v, filter, now))
    .filter((v) => !q || [v.vehicleId, v.registrationNumber, v.driverName ?? '', v.vehicleModel, v.parkingBay ?? ''].some((s) => s.toLowerCase().includes(q)));

  const counts = Object.fromEntries(VEHICLE_STATUSES.map((s) => [s, vehicles.filter((v) => v.status === s).length]));

  return (
    <aside className="panel left fleet-panel">
      <div className="panel-head">
        <h2>Fleet</h2>
        <span className="muted">
          {list.length} of {vehicles.length}
        </span>
      </div>
      <input className="search" placeholder="Search ID, plate, driver, bay…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="chips">
        {FILTERS.map((f) => (
          <button key={f.key} className={filter === f.key ? 'active' : ''} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="status-bar">
        {VEHICLE_STATUSES.map((s) => (
          <div key={s} title={`${s}: ${counts[s]}`} style={{ flex: counts[s] || 0.0001, background: STATUS_COLORS[s] }} />
        ))}
      </div>
      <ul className="fleet-list">
        {list.map((v) => {
          const parked = v.parkingEntryTime ? now - v.parkingEntryTime : null;
          const gpsAge = now - v.lastGpsUpdate;
          return (
            <li key={v.vehicleId} className={selected === v.vehicleId ? 'sel' : ''} onClick={() => select(v.vehicleId)} onMouseEnter={() => hover(v.vehicleId)} onMouseLeave={() => hover(null)}>
              <div className="fl-top">
                <b>{shortId(v.vehicleId)}</b>
                <span className="mono muted">{v.registrationNumber}</span>
                <StatusPill status={v.status} small />
              </div>
              <div className="fl-bottom">
                <span>{v.driverName}</span>
                <span className="muted">
                  {v.parkingBay
                    ? `Bay ${v.parkingBay} · ${v.status === 'AVAILABLE' ? formatDuration(parked) : v.status.toLowerCase()}`
                    : v.status === 'OFFLINE'
                      ? `GPS ${formatDuration(gpsAge)} ago`
                      : v.destination
                        ? `→ ${v.status === 'ON_TRIP' ? v.destination.name : v.pickupLocation?.name}`
                        : `${Math.round(v.speed)} km/h`}
                </span>
              </div>
              {parked != null && parked > 3_600_000 && v.status === 'AVAILABLE' && <i className={`idle-flag ${parked > 7_200_000 ? 'crit' : 'warn'}`} />}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
