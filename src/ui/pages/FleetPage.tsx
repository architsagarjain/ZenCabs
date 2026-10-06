import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { DATA_CONFIG } from '../../config/dataConfig';
import { formatAgo, formatDuration, formatINR, shortId } from '../../core/format';
import type { Vehicle } from '../../contracts/types';
import { matchesFilter, useFleetStore, type FleetFilter } from '../../store/fleetStore';
import { useServices } from '../../store/servicesContext';
import { useBreakpoint } from '../../store/useBreakpoint';
import { Avatar, StatusPill } from '../common';
import { PageHeader } from '../layout/Shell';

const FILTERS: { key: FleetFilter; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'ON_TRIP', label: 'On trip' },
  { key: 'BUSY', label: 'Heading to pickup' },
  { key: 'AVAILABLE', label: 'Available' },
  { key: 'PARKED_1H', label: 'Parked over 1 hr' },
  { key: 'AT_BASE', label: 'At base' },
  { key: 'MAINTENANCE', label: 'Maintenance' },
  { key: 'OFFLINE', label: 'Offline' },
];

function locationText(v: Vehicle, now: number, zoneName: string | undefined) {
  if (v.parkingBay) return v.status === 'AVAILABLE' ? `Bay ${v.parkingBay} · ${formatDuration(v.parkingEntryTime ? now - v.parkingEntryTime : null)}` : `Bay ${v.parkingBay}`;
  if (v.status === 'ON_TRIP') return `To ${v.destination?.name ?? '—'}`;
  if (v.status === 'EN_ROUTE_PICKUP' || v.status === 'ASSIGNED' || v.status === 'WAITING') return `Pickup at ${v.pickupLocation?.name ?? '—'}`;
  return zoneName ? `Near ${zoneName}` : 'Jammu city';
}

export function FleetPage() {
  const { mapService } = useServices();
  const bp = useBreakpoint();
  const vehicles = useFleetStore((s) => s.vehicles);
  const now = useFleetStore((s) => s.now);
  const filter = useFleetStore((s) => s.filter);
  const search = useFleetStore((s) => s.search);
  const selected = useFleetStore((s) => s.selectedVehicleId);
  const { setFilter, setSearch, select, set } = useFleetStore.getState();
  const q = search.trim().toLowerCase();
  const list = vehicles
    .filter((v) => matchesFilter(v, filter, now))
    .filter((v) => !q || [v.vehicleId, shortId(v.vehicleId), v.registrationNumber, v.driverName ?? '', v.vehicleModel, v.parkingBay ?? ''].some((s) => s.toLowerCase().includes(q)));
  const inService = vehicles.filter((v) => v.status !== 'MAINTENANCE' && v.status !== 'OFFLINE').length;

  return (
    <div className="page">
      <PageHeader
        title="Fleet & vehicles"
        context={`${vehicles.length} vehicles · ${inService} in service`}
        action={
          bp !== 'mobile' && (
            <button className="btn primary" onClick={() => set({ dispatchOpen: true })}>
              <Plus size={18} /> New ride request
            </button>
          )
        }
      />
      <div className="toolbar">
        <div className="search-field">
          <Search size={18} />
          <input placeholder="Search ID, plate, driver or bay" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search vehicles" />
        </div>
        <div className="chips scroll-x">
          {FILTERS.map((f) => (
            <button key={f.key} className={`chip ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>
              {f.label} <span className="n">{vehicles.filter((v) => matchesFilter(v, f.key, now)).length}</span>
            </button>
          ))}
        </div>
      </div>

      {list.length === 0 && (
        <div className="card empty">
          <b>No vehicles match</b>
          Try a different filter or clear the search.
        </div>
      )}

      {bp === 'mobile' ? (
        <ul className="vehicle-cards">
          {list.map((v) => (
            <li key={v.vehicleId}>
              <button className={`vcard card ${selected === v.vehicleId ? 'sel' : ''}`} onClick={() => select(v.vehicleId, { fly: false })}>
                <div className="vc-top">
                  <b>{shortId(v.vehicleId)}</b>
                  <StatusPill status={v.status} />
                </div>
                <div className="muted">{v.driverName}</div>
                <div className="faint small">{locationText(v, now, mapService.zoneOf(v.latitude, v.longitude)?.name)}</div>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        list.length > 0 && (
          <div className="card table-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Vehicle</th>
                  <th>Driver</th>
                  <th>Status</th>
                  <th>Location</th>
                  <th className="r">Today</th>
                  <th className="r hide-tablet">Charge / fuel</th>
                  <th className="r">Last GPS</th>
                </tr>
              </thead>
              <tbody>
                {list.map((v) => {
                  const energy = v.batteryPercentage ?? v.fuelPercentage;
                  const gps = now - v.lastGpsUpdate;
                  return (
                    <tr key={v.vehicleId} className={selected === v.vehicleId ? 'sel' : ''} onClick={() => select(v.vehicleId, { fly: false })} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && select(v.vehicleId, { fly: false })}>
                      <td>
                        <b>{shortId(v.vehicleId)}</b>
                        <div className="faint small">{v.registrationNumber}</div>
                      </td>
                      <td>
                        <div className="cell-person">
                          <Avatar src={v.driverPhoto} name={v.driverName ?? '?'} size={28} />
                          <span>{v.driverName}</span>
                        </div>
                      </td>
                      <td>
                        <StatusPill status={v.status} />
                      </td>
                      <td className="muted">{locationText(v, now, mapService.zoneOf(v.latitude, v.longitude)?.name)}</td>
                      <td className="r num">
                        {v.tripsToday} trips
                        <div className="faint small">{formatINR(v.revenueToday)}</div>
                      </td>
                      <td className="r num hide-tablet">{energy != null ? `${Math.round(energy)}%` : '—'}</td>
                      <td className={`r num ${gps > DATA_CONFIG.GPS_STALE_AFTER_MS ? 'bad' : 'muted'}`}>{formatAgo(gps)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

export function DriversPage() {
  const bp = useBreakpoint();
  const drivers = useFleetStore((s) => s.drivers);
  const vehicleMap = useFleetStore((s) => s.vehicleMap);
  const search = useFleetStore((s) => s.search);
  const { setSearch, select } = useFleetStore.getState();
  const [tab, setTab] = useState<'ALL' | 'ON_SHIFT' | 'ON_BREAK' | 'OFF_SHIFT'>('ALL');
  const list = Object.values(drivers)
    .filter((d) => tab === 'ALL' || d.shiftState === tab)
    .filter((d) => !search.trim() || d.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  const all = Object.values(drivers);
  const counts = { ALL: all.length, ON_SHIFT: all.filter((d) => d.shiftState === 'ON_SHIFT').length, ON_BREAK: all.filter((d) => d.shiftState === 'ON_BREAK').length, OFF_SHIFT: all.filter((d) => d.shiftState === 'OFF_SHIFT').length };
  const shiftLabel = { ON_SHIFT: 'On shift', ON_BREAK: 'On a break', OFF_SHIFT: 'Off shift' } as const;
  const open = (vehicleId: string | null) => vehicleId && select(vehicleId, { fly: false, tab: 'DRIVER' });

  return (
    <div className="page">
      <PageHeader title="Drivers" context={`${counts.ON_SHIFT} on shift · ${counts.ON_BREAK} on a break · ${counts.OFF_SHIFT} off`} />
      <div className="toolbar">
        <div className="search-field">
          <Search size={18} />
          <input placeholder="Search drivers" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search drivers" />
        </div>
        <div className="chips scroll-x">
          {(['ALL', 'ON_SHIFT', 'ON_BREAK', 'OFF_SHIFT'] as const).map((k) => (
            <button key={k} className={`chip ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
              {k === 'ALL' ? 'All' : shiftLabel[k]} <span className="n">{counts[k]}</span>
            </button>
          ))}
        </div>
      </div>
      {bp === 'mobile' ? (
        <ul className="vehicle-cards">
          {list.map((d) => {
            const v = d.assignedVehicleId ? vehicleMap[d.assignedVehicleId] : undefined;
            return (
              <li key={d.driverId}>
                <button className="vcard card" onClick={() => open(d.assignedVehicleId)}>
                  <div className="vc-top">
                    <span className="cell-person">
                      <Avatar src={d.photo} name={d.name} size={32} />
                      <b>{d.name}</b>
                    </span>
                    <span className={`shift ${d.shiftState.toLowerCase()}`}>{shiftLabel[d.shiftState]}</span>
                  </div>
                  <div className="faint small">
                    {v ? shortId(v.vehicleId) : '—'} · {d.tripsToday} trips · {formatINR(d.earningsToday)}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="card table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Driver</th>
                <th>Shift</th>
                <th>Vehicle</th>
                <th className="r">Trips today</th>
                <th className="r">Earnings</th>
                <th className="r hide-tablet">Online</th>
                <th className="r">Rating</th>
              </tr>
            </thead>
            <tbody>
              {list.map((d) => {
                const v = d.assignedVehicleId ? vehicleMap[d.assignedVehicleId] : undefined;
                return (
                  <tr key={d.driverId} onClick={() => open(d.assignedVehicleId)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && open(d.assignedVehicleId)}>
                    <td>
                      <div className="cell-person">
                        <Avatar src={d.photo} name={d.name} size={32} />
                        <span>
                          <b>{d.name}</b>
                          <div className="faint small num">{d.phone}</div>
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className={`shift ${d.shiftState.toLowerCase()}`}>{shiftLabel[d.shiftState]}</span>
                    </td>
                    <td>{v ? <span className="cell-person">{shortId(v.vehicleId)} <StatusPill status={v.status} /></span> : '—'}</td>
                    <td className="r num">{d.tripsToday}</td>
                    <td className="r num">{formatINR(d.earningsToday)}</td>
                    <td className="r num hide-tablet">{d.hoursOnlineToday} h</td>
                    <td className="r num">★ {d.rating.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
