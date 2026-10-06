/**
 * Vehicle drawer (DESIGN.md §28): right-side drawer on desktop, bottom sheet on phones.
 * Progressive disclosure: one-line summary + today's numbers first; driver, trips and
 * dispatch one tap away.
 */
import { Crosshair, MapPin, Navigation, Phone, Route, Send, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DATA_CONFIG } from '../config/dataConfig';
import { formatAgo, formatClock, formatDuration, formatINR, shortId, STATUS_COLORS } from '../core/format';
import type { NamedPlace, Trip, Vehicle } from '../contracts/types';
import { useFleetStore } from '../store/fleetStore';
import { useServices } from '../store/servicesContext';
import { ALERT_TITLE } from './attention';
import { Avatar, IdleBadge, Meter, Row, StatusPill } from './common';

function summary(v: Vehicle, now: number, place: string): string {
  switch (v.status) {
    case 'ON_TRIP':
      return `On a trip to ${v.destination?.name ?? 'destination'}${v.estimatedTripEnd ? ` · arrives in ${formatDuration(Math.max(0, v.estimatedTripEnd - now))}` : ''}`;
    case 'EN_ROUTE_PICKUP':
      return `Heading to pick up at ${v.pickupLocation?.name ?? 'pickup'}`;
    case 'ASSIGNED':
      return `Driver accepting a ride from ${v.pickupLocation?.name ?? 'pickup'}`;
    case 'WAITING':
      return `Waiting for the rider at ${v.pickupLocation?.name ?? 'pickup'}`;
    case 'RETURNING_TO_BASE':
      return 'Returning to ZenCabs Base';
    case 'MAINTENANCE':
      return `In the service bay${v.parkingBay ? ` (${v.parkingBay})` : ''}`;
    case 'OFFLINE':
      return `Offline · last seen ${formatAgo(now - v.lastGpsUpdate)}`;
    default:
      return v.parkingBay ? `Parked in bay ${v.parkingBay} for ${formatDuration(v.parkingEntryTime ? now - v.parkingEntryTime : null)}` : `Available near ${place}`;
  }
}

export function VehicleDrawer() {
  const { mapService, alertService } = useServices();
  const id = useFleetStore((s) => s.selectedVehicleId);
  const v = useFleetStore((s) => (id ? s.vehicleMap[id] : undefined));
  const driver = useFleetStore((s) => (v?.driverId ? s.drivers[v.driverId] : undefined));
  const now = useFleetStore((s) => s.now);
  const tab = useFleetStore((s) => s.detailTab);
  const page = useFleetStore((s) => s.page);
  const showRoute = useFleetStore((s) => s.showRoute);
  useFleetStore((s) => s.alerts);
  const { select, setDetailTab, toggle, camera, set, showOnMap } = useFleetStore.getState();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && select(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [select]);

  if (!id || !v) return null;
  const parked = v.parkingEntryTime ? now - v.parkingEntryTime : null;
  const gpsAge = now - v.lastGpsUpdate;
  const zone = mapService.zoneOf(v.latitude, v.longitude);
  const place = v.parkingBay ? 'ZenCabs Base' : zone ? zone.name : 'Jammu city';
  const issues = alertService.forVehicle(v.vehicleId);
  const energy = v.batteryPercentage ?? v.fuelPercentage;
  const canDispatch = v.status === 'AVAILABLE' || v.status === 'RETURNING_TO_BASE';
  const locate = () => (page === 'dashboard' ? camera({ kind: 'vehicle', vehicleId: v.vehicleId }) : showOnMap(v.vehicleId));

  return (
    <aside className="drawer" role="dialog" aria-label={`Vehicle ${shortId(v.vehicleId)}`} style={{ ['--status' as string]: STATUS_COLORS[v.status] }}>
      <div className="drawer-grip" aria-hidden>
        <span />
      </div>
      <header className="drawer-head">
        <div>
          <div className="dh-title">
            <h2>{shortId(v.vehicleId)}</h2>
            <StatusPill status={v.status} />
          </div>
          <div className="muted small">
            <span className="plate">{v.registrationNumber}</span> {v.vehicleModel}
          </div>
        </div>
        <button className="icon-btn" onClick={() => select(null)} aria-label="Close (Esc)" title="Close (Esc)">
          <X size={20} />
        </button>
      </header>

      <p className="drawer-summary">{summary(v, now, place)}</p>

      <div className="drawer-actions">
        {canDispatch ? (
          <button className="btn primary" onClick={() => setDetailTab('DISPATCH')}>
            <Send size={16} /> Dispatch
          </button>
        ) : (
          <button className="btn primary" disabled={!driver} onClick={() => driver && set({ callDriverId: driver.driverId })}>
            <Phone size={16} /> Call driver
          </button>
        )}
        {canDispatch && (
          <button className="btn" disabled={!driver} onClick={() => driver && set({ callDriverId: driver.driverId })}>
            <Phone size={16} /> Call driver
          </button>
        )}
        <button className="btn" onClick={locate}>
          <Crosshair size={16} /> {page === 'dashboard' ? 'Center camera' : 'Show on map'}
        </button>
        <button className={`btn ${showRoute ? 'on' : ''}`} onClick={() => toggle('showRoute')} aria-pressed={showRoute}>
          <Route size={16} /> View route
        </button>
      </div>

      <div className="tabs" role="tablist">
        {(
          [
            ['OVERVIEW', 'Overview'],
            ['DRIVER', 'View driver'],
            ['TRIPS', 'View trips'],
            ['DISPATCH', 'Dispatch'],
          ] as const
        ).map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setDetailTab(t)}>
            {label}
          </button>
        ))}
      </div>

      <div className="drawer-body">
        {tab === 'OVERVIEW' && (
          <>
            {issues.length > 0 && (
              <div className="issues">
                {issues.map((a) => (
                  <div key={a.alertId} className={`issue sev-${a.severity.toLowerCase()}`}>
                    <b>{ALERT_TITLE[a.type]}</b>
                    <span>{a.message}</span>
                  </div>
                ))}
              </div>
            )}
            {v.parkingBay && (
              <div className="parked-block">
                <span className="muted small">Parked in bay {v.parkingBay}</span>
                <div className="parked-time">{formatDuration(parked)}</div>
                <IdleBadge ms={parked} />
                {v.parkingEntryTime && <span className="faint small">Since {formatClock(v.parkingEntryTime)}</span>}
              </div>
            )}
            {v.currentTripId && (
              <div className="trip-block">
                <div className="tb-row">
                  <i className="tb-dot pickup" />
                  <span>{v.pickupLocation?.name}</span>
                </div>
                <div className="tb-line" />
                <div className="tb-row">
                  <MapPin size={14} className="tb-pin" />
                  <span>{v.destination?.name}</span>
                </div>
                {v.estimatedTripEnd && v.status === 'ON_TRIP' && (
                  <div className="faint small">
                    Started {v.tripStartTime ? formatClock(v.tripStartTime) : '—'} · ETA {formatClock(v.estimatedTripEnd)}
                  </div>
                )}
              </div>
            )}
            <div className="stat-grid">
              <div>
                <span>Trips today</span>
                <b>{v.tripsToday}</b>
              </div>
              <div>
                <span>Revenue today</span>
                <b>{formatINR(v.revenueToday)}</b>
              </div>
              <div>
                <span>Distance today</span>
                <b>{Math.round(v.distanceToday)} km</b>
              </div>
              <div>
                <span>Idle time</span>
                <b>{formatDuration(v.idleTimeToday)}</b>
              </div>
            </div>
            {energy != null && <Meter pct={energy} label={v.batteryPercentage != null ? 'Battery' : 'Fuel'} color={energy < 20 ? '#EF4444' : energy < 40 ? '#F59E0B' : '#10B981'} />}
            <div className="kv-list">
              <Row k="Driver">{v.driverName ?? '—'}</Row>
              <Row k="Location">{place}</Row>
              <Row k="Parking bay">{v.parkingBay ?? '—'}</Row>
              <Row k="Last GPS">
                <span className={gpsAge > DATA_CONFIG.GPS_STALE_AFTER_MS ? 'bad' : ''}>{formatAgo(gpsAge)}</span>
              </Row>
              <Row k="Speed">
                <span className="num">
                  {Math.round(v.speed)} km/h <Navigation size={12} style={{ transform: `rotate(${v.heading}deg)`, verticalAlign: -1 }} />
                </span>
              </Row>
              <Row k="Maintenance">{v.maintenanceStatus === 'OK' ? 'Up to date' : v.maintenanceStatus === 'DUE_SOON' ? 'Service due soon' : v.maintenanceStatus === 'OVERDUE' ? 'Service overdue' : 'In service'}</Row>
              <Row k="Position">
                <span className="num faint">
                  {v.latitude.toFixed(5)}, {v.longitude.toFixed(5)}
                </span>
              </Row>
            </div>
          </>
        )}
        {tab === 'DRIVER' && <DriverTab />}
        {tab === 'TRIPS' && <TripsTab vehicleId={v.vehicleId} />}
        {tab === 'DISPATCH' && <DispatchTab vehicleId={v.vehicleId} />}
      </div>
    </aside>
  );
}

function DriverTab() {
  const id = useFleetStore((s) => s.selectedVehicleId);
  const v = useFleetStore((s) => (id ? s.vehicleMap[id] : undefined));
  const d = useFleetStore((s) => (v?.driverId ? s.drivers[v.driverId] : undefined));
  const now = useFleetStore((s) => s.now);
  const set = useFleetStore((s) => s.set);
  if (!d) return <div className="empty">No driver assigned to this vehicle.</div>;
  const shift = d.shiftState === 'ON_SHIFT' ? 'On shift' : d.shiftState === 'ON_BREAK' ? 'On a break' : 'Off shift';
  return (
    <div className="driver-card">
      <div className="dc-head">
        <Avatar src={d.photo} name={d.name} size={56} />
        <div>
          <b>{d.name}</b>
          <span className="muted small">
            {shift} · ★ {d.rating.toFixed(2)}
          </span>
        </div>
      </div>
      <div className="stat-grid">
        <div>
          <span>Trips today</span>
          <b>{d.tripsToday}</b>
        </div>
        <div>
          <span>Earnings today</span>
          <b>{formatINR(d.earningsToday)}</b>
        </div>
        <div>
          <span>Online today</span>
          <b>{d.hoursOnlineToday} h</b>
        </div>
        <div>
          <span>Shift started</span>
          <b>{d.shiftStart ? formatClock(d.shiftStart).slice(0, 5) : '—'}</b>
        </div>
      </div>
      <div className="kv-list">
        <Row k="Phone">
          <span className="num">{d.phone}</span>
        </Row>
        <Row k="Licence">
          <span className="num">{d.licenseNumber}</span>
        </Row>
        <Row k="Languages">{d.languages.join(', ')}</Row>
        <Row k="With ZenCabs since">{new Date(d.joinedOn).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</Row>
        {d.shiftStart && <Row k="Time on shift">{formatDuration(now - d.shiftStart)}</Row>}
      </div>
      <button className="btn primary wide" onClick={() => set({ callDriverId: d.driverId })}>
        <Phone size={16} /> Call {d.name.split(' ')[0]}
      </button>
    </div>
  );
}

function TripsTab({ vehicleId }: { vehicleId: string }) {
  const { bookingService } = useServices();
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const tripsVersion = useFleetStore((s) => s.trips.length);
  useEffect(() => {
    let alive = true;
    bookingService.tripsForVehicle(vehicleId).then((t) => alive && setTrips(t));
    return () => {
      alive = false;
    };
  }, [vehicleId, bookingService, tripsVersion]);
  if (!trips) return <div className="empty">Loading trips…</div>;
  if (!trips.length) return <div className="empty">No trips today yet.</div>;
  const total = trips.filter((t) => t.status === 'COMPLETED').reduce((s, t) => s + t.fare, 0);
  const label: Record<Trip['status'], string> = { REQUESTED: 'Requested', ASSIGNED: 'Assigned', DRIVER_EN_ROUTE: 'Driver on the way', DRIVER_ARRIVED: 'At pickup', IN_PROGRESS: 'On trip', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };
  return (
    <div className="trips">
      <p className="muted small">
        {trips.length} trips · {formatINR(total)} in completed fares
      </p>
      {trips.map((t) => (
        <div key={t.tripId} className="trip-item">
          <div className="ti-top">
            <b>
              {t.pickup.name} → {t.destination.name}
            </b>
            <span className={`trip-status ${t.status.toLowerCase()}`}>{label[t.status]}</span>
          </div>
          <div className="faint small">
            {formatClock(t.startedAt ?? t.assignedAt).slice(0, 5)} · {t.distanceKm ? `${t.distanceKm} km · ` : ''}
            {formatINR(t.fare)} · {t.customerName}
          </div>
        </div>
      ))}
    </div>
  );
}

function DispatchTab({ vehicleId }: { vehicleId: string }) {
  const { mapService, dispatchService } = useServices();
  const v = useFleetStore((s) => s.vehicleMap[vehicleId]);
  const places = mapService.places().filter((p) => p.name !== 'ZenCabs Base');
  const [pickup, setPickup] = useState(places[0]?.name ?? '');
  const [dest, setDest] = useState(places[3]?.name ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const find = (n: string): NamedPlace => places.find((p) => p.name === n)!;
  const canDispatch = v.status === 'AVAILABLE' || v.status === 'RETURNING_TO_BASE';

  const go = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await dispatchService.dispatch({ pickup: find(pickup), destination: find(dest), vehicleId });
      setMsg(
        r.assigned
          ? { ok: true, text: `${shortId(vehicleId)} is on the way · about ${r.recommended?.etaMinutes ?? '?'} min to pickup` }
          : { ok: false, text: `${shortId(vehicleId)} can't take this ride right now — the driver may be off shift, low on charge or already busy.` },
      );
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="form">
      <p className="muted small">Send this car to a rider. You can follow it on the map as it goes to the pickup and starts the trip.</p>
      <label>
        Pickup
        <select value={pickup} onChange={(e) => setPickup(e.target.value)}>
          {places.map((p) => (
            <option key={p.name}>{p.name}</option>
          ))}
        </select>
      </label>
      <label>
        Destination
        <select value={dest} onChange={(e) => setDest(e.target.value)}>
          {places.map((p) => (
            <option key={p.name}>{p.name}</option>
          ))}
        </select>
      </label>
      <button className="btn primary wide" disabled={!canDispatch || busy || pickup === dest} onClick={go}>
        {canDispatch ? `Dispatch ${shortId(vehicleId)}` : 'Not available for dispatch'}
      </button>
      {msg && <div className={`note ${msg.ok ? '' : 'bad'}`}>{msg.text}</div>}
    </div>
  );
}
