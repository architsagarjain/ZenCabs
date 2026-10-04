import { useEffect, useState } from 'react';
import { formatAgo, formatClock, formatDuration, formatINR, shortId, STATUS_COLORS } from '../core/format';
import { DATA_CONFIG } from '../config/dataConfig';
import type { NamedPlace, Trip } from '../contracts/types';
import { useFleetStore } from '../store/fleetStore';
import { useServices } from '../store/servicesContext';
import { IdleBadge, Meter, Row, StatusPill } from './common';

export function VehiclePanel() {
  const { mapService, alertService } = useServices();
  const id = useFleetStore((s) => s.selectedVehicleId);
  const v = useFleetStore((s) => (id ? s.vehicleMap[id] : undefined));
  const driver = useFleetStore((s) => (v?.driverId ? s.drivers[v.driverId] : undefined));
  const now = useFleetStore((s) => s.now);
  const tab = useFleetStore((s) => s.detailTab);
  const showRoute = useFleetStore((s) => s.showRoute);
  const following = useFleetStore((s) => s.following);
  useFleetStore((s) => s.alerts);
  const { select, setDetailTab, toggle, camera, set } = useFleetStore.getState();
  if (!id || !v) return null;

  const parked = v.parkingEntryTime ? now - v.parkingEntryTime : null;
  const gpsAge = now - v.lastGpsUpdate;
  const zone = mapService.zoneOf(v.latitude, v.longitude);
  const location = v.parkingBay ? 'ZenCabs Base' : zone ? zone.name : 'Jammu city';
  const alerts = alertService.forVehicle(v.vehicleId);
  const energy = v.batteryPercentage ?? v.fuelPercentage;

  return (
    <aside className="panel right vehicle-panel" style={{ borderTopColor: STATUS_COLORS[v.status] }}>
      <div className="vp-head">
        <div>
          <h1>{shortId(v.vehicleId)}</h1>
          <div className="plate">{v.registrationNumber}</div>
          <div className="muted small">
            {v.vehicleModel} · {v.fuelKind.toLowerCase()}
          </div>
        </div>
        <button className="icon-btn" onClick={() => select(null)} title="Close (Esc)">
          ✕
        </button>
      </div>
      <StatusPill status={v.status} />

      <div className="tabs">
        {(['OVERVIEW', 'DRIVER', 'TRIPS', 'DISPATCH'] as const).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setDetailTab(t)}>
            {t.toLowerCase()}
          </button>
        ))}
      </div>

      <div className="vp-body">
        {tab === 'OVERVIEW' && (
          <>
            <Row k="Driver">{v.driverName ?? '—'}</Row>
            <Row k="Status">{v.status.replace(/_/g, ' ')}</Row>
            <Row k="Location">{location}</Row>
            <Row k="Parking bay">{v.parkingBay ?? '—'}</Row>
            {v.parkingBay && (
              <div className="parked-block">
                <span className="k">Parked</span>
                <div className="parked-time">{formatDuration(parked)}</div>
                <IdleBadge ms={parked} />
                {v.parkingEntryTime && <div className="muted small">Entered {formatClock(v.parkingEntryTime)}</div>}
              </div>
            )}
            {v.currentTripId && (
              <div className="trip-block">
                <div className="tb-row">
                  <i className="dot pickup" />
                  <span>{v.pickupLocation?.name}</span>
                </div>
                <div className="tb-line" />
                <div className="tb-row">
                  <i className="dot drop" />
                  <span>{v.destination?.name}</span>
                </div>
                {v.estimatedTripEnd && v.status === 'ON_TRIP' && (
                  <div className="muted small">
                    Started {v.tripStartTime ? formatClock(v.tripStartTime) : '—'} · ETA {formatClock(v.estimatedTripEnd)} ({formatDuration(Math.max(0, v.estimatedTripEnd - now))})
                  </div>
                )}
              </div>
            )}
            <div className="stat-grid">
              <div>
                <b>{v.tripsToday}</b>
                <span>Trips today</span>
              </div>
              <div>
                <b>{formatINR(v.revenueToday)}</b>
                <span>Revenue today</span>
              </div>
              <div>
                <b>{Math.round(v.distanceToday)} km</b>
                <span>Distance today</span>
              </div>
              <div>
                <b>{formatDuration(v.idleTimeToday)}</b>
                <span>Idle time</span>
              </div>
            </div>
            <Row k="Last GPS">
              <span className={gpsAge > DATA_CONFIG.GPS_STALE_AFTER_MS ? 'bad' : ''}>{formatAgo(gpsAge)}</span>
            </Row>
            <Row k="Speed / heading" mono>
              {Math.round(v.speed)} km/h · {Math.round(v.heading)}°
            </Row>
            <Row k="Position" mono>
              {v.latitude.toFixed(5)}, {v.longitude.toFixed(5)}
            </Row>
            <Row k="Maintenance">{v.maintenanceStatus.replace('_', ' ').toLowerCase()}</Row>
            {energy != null && (
              <Meter pct={energy} label={v.batteryPercentage != null ? 'Battery' : 'Fuel'} color={energy < 20 ? '#ef4444' : energy < 40 ? '#f59e0b' : '#22c55e'} />
            )}
            {alerts.length > 0 && (
              <div className="vp-alerts">
                {alerts.map((a) => (
                  <div key={a.alertId} className={`alert-row sev-${a.severity.toLowerCase()}`}>
                    {a.message}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {tab === 'DRIVER' && <DriverTab />}
        {tab === 'TRIPS' && <TripsTab vehicleId={v.vehicleId} />}
        {tab === 'DISPATCH' && <DispatchTab vehicleId={v.vehicleId} />}
      </div>

      <div className="vp-actions">
        <button onClick={() => setDetailTab('DRIVER')}>View driver</button>
        <button onClick={() => setDetailTab('TRIPS')}>View trips</button>
        <button className={showRoute ? 'on' : ''} onClick={() => toggle('showRoute')}>
          View route
        </button>
        <button className="accent" onClick={() => setDetailTab('DISPATCH')}>
          Dispatch
        </button>
        <button onClick={() => driver && set({ callDriverId: driver.driverId })}>Call driver</button>
        <button className={following ? 'on' : ''} onClick={() => camera({ kind: 'vehicle', vehicleId: v.vehicleId })}>
          Center camera
        </button>
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
  if (!d) return <p className="muted">No driver assigned.</p>;
  return (
    <div className="driver-card">
      <div className="dc-head">
        <img src={d.photo} alt={d.name} />
        <div>
          <b>{d.name}</b>
          <span className="muted">{d.driverId}</span>
          <span className={`shift ${d.shiftState.toLowerCase()}`}>{d.shiftState.replace('_', ' ')}</span>
        </div>
      </div>
      <Row k="Phone" mono>
        {d.phone}
      </Row>
      <Row k="Rating">★ {d.rating.toFixed(2)}</Row>
      <Row k="Licence" mono>
        {d.licenseNumber}
      </Row>
      <Row k="Shift started">{d.shiftStart ? `${formatClock(d.shiftStart)} (${formatDuration(now - d.shiftStart)})` : '—'}</Row>
      <Row k="Hours online">{d.hoursOnlineToday} h</Row>
      <Row k="Trips today">{d.tripsToday}</Row>
      <Row k="Earnings today">{formatINR(d.earningsToday)}</Row>
      <Row k="Languages">{d.languages.join(', ')}</Row>
      <Row k="With ZenCabs since">{d.joinedOn}</Row>
      <button className="btn primary wide" onClick={() => set({ callDriverId: d.driverId })}>
        Call {d.name.split(' ')[0]}
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
  if (!trips) return <p className="muted">Loading trips…</p>;
  if (!trips.length) return <p className="muted">No trips today.</p>;
  const total = trips.filter((t) => t.status === 'COMPLETED').reduce((s, t) => s + t.fare, 0);
  return (
    <div className="trips">
      <div className="muted small">
        {trips.length} trips · {formatINR(total)} completed fares
      </div>
      {trips.map((t) => (
        <div key={t.tripId} className="trip-item">
          <div className="ti-top">
            <span className="mono">{t.tripId}</span>
            <span className={`trip-status ${t.status.toLowerCase()}`}>{t.status.replace(/_/g, ' ')}</span>
          </div>
          <div className="ti-route">
            {t.pickup.name} → {t.destination.name}
          </div>
          <div className="muted small">
            {t.startedAt ? formatClock(t.startedAt) : formatClock(t.assignedAt)} · {t.distanceKm ? `${t.distanceKm} km · ` : ''}
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
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const find = (n: string): NamedPlace => places.find((p) => p.name === n)!;
  const canDispatch = v.status === 'AVAILABLE' || v.status === 'RETURNING_TO_BASE';

  const go = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await dispatchService.dispatch({ pickup: find(pickup), destination: find(dest), vehicleId });
      setMsg(r.assigned ? `Assigned ${shortId(vehicleId)} · booking ${r.booking.bookingId} · ETA ${r.recommended?.etaMinutes ?? '?'} min` : `Could not assign ${shortId(vehicleId)} (driver off shift, low charge or busy).`);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dispatch-tab">
      <p className="muted small">Send this vehicle to a customer. The vehicle will go ASSIGNED → EN ROUTE → WAITING → ON TRIP.</p>
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
        {canDispatch ? `Dispatch ${shortId(vehicleId)}` : `Unavailable (${v.status.replace(/_/g, ' ').toLowerCase()})`}
      </button>
      {msg && <div className="note">{msg}</div>}
    </div>
  );
}
