/** Insights: live answers to the questions a fleet manager asks during a shift. */
import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { OPS_THRESHOLDS } from '../../config/dataConfig';
import { formatAgo, formatDuration, formatINR, IDLE_COLORS, parkingIdleLevel, shortId, STATUS_COLORS } from '../../core/format';
import { toScene } from '../../core/geo';
import { useFleetStore } from '../../store/fleetStore';
import { useServices } from '../../store/servicesContext';
import { Avatar, Card, StatusPill } from '../common';
import { PageHeader } from '../layout/Shell';

export function InsightsPage() {
  const { analyticsService, dispatchService } = useServices();
  useFleetStore((s) => s.vehicles);
  useFleetStore((s) => s.drivers);
  useFleetStore((s) => s.analyticsVersion);
  const { select, showOnMap, camera, set } = useFleetStore.getState();
  const [assigning, setAssigning] = useState(false);

  const idle = analyticsService.idleVehicles();
  const working = analyticsService.workingDrivers();
  const offShift = analyticsService.driversOffShift();
  const parkedLong = analyticsService.parkedTooLong(60);
  const top = analyticsService.topRevenue(5);
  const conc = analyticsService.concentration();
  const gaps = analyticsService.demandGaps().filter((g) => g.gap > 0);
  const rec = analyticsService.nextBookingRecommendation();
  const low = analyticsService.lowRevenue();
  const stale = analyticsService.staleGps();
  const maxRev = Math.max(1, ...top.map((v) => v.revenueToday));
  const maxConc = Math.max(1, ...conc.zones.map((z) => z.total));
  const open = (id: string) => select(id, { fly: false });

  const VLink = ({ id }: { id: string }) => (
    <button className="vlink" onClick={() => open(id)}>
      {shortId(id)}
    </button>
  );

  return (
    <div className="page">
      <PageHeader title="Insights" context="Live answers to the questions that run a shift" />
      <div className="insights-grid">
        <Card title="Next booking goes to" subtitle={rec?.forZone ?? 'Waiting for a demand signal…'} className="span-2 highlight">
          {rec?.result.recommended ? (
            <div className="rec">
              <div>
                <div className="rec-main">
                  <VLink id={rec.result.recommended.vehicleId} />
                  <span className="muted">
                    {rec.result.recommended.etaMinutes} min away · {rec.result.recommended.distanceKm} km
                  </span>
                </div>
                <ul className="reasons">
                  {rec.result.recommended.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                {rec.result.candidates.length > 1 && <p className="faint small">Next best: {rec.result.candidates.slice(1, 4).map((c) => `${shortId(c.vehicleId)} (${c.etaMinutes} min)`).join(' · ')}</p>}
              </div>
              {rec.result.booking.status === 'PENDING' && rec.result.booking.bookingId ? (
                <button
                  className="btn primary"
                  disabled={assigning}
                  onClick={async () => {
                    setAssigning(true);
                    try {
                      const r = await dispatchService.dispatch({ bookingId: rec.result.booking.bookingId, pickup: rec.result.booking.pickup, destination: rec.result.booking.destination, vehicleId: rec.result.recommended!.vehicleId });
                      if (r.assigned) showOnMap(rec.result.recommended!.vehicleId);
                    } finally {
                      setAssigning(false);
                    }
                  }}
                >
                  Assign {shortId(rec.result.recommended.vehicleId)}
                </button>
              ) : (
                <button className="btn" onClick={() => showOnMap(rec.result.recommended!.vehicleId)}>
                  Show on map
                </button>
              )}
            </div>
          ) : (
            <div className="empty">No car is free to take a booking right now.</div>
          )}
        </Card>

        <Card title="Areas short of cars" subtitle="Open requests and the next 30 minutes vs free cars nearby" count={gaps.length} alertCount>
          {!gaps.length && <div className="empty">Free cars cover demand in every area.</div>}
          <ul className="rows">
            {gaps.slice(0, 5).map((z) => (
              <li key={z.zoneId}>
                <button
                  className="row-btn"
                  onClick={() => {
                    if (!z.zone) return;
                    const p = toScene(z.zone.center.lat, z.zone.center.lng);
                    set({ page: 'dashboard', showZones: true });
                    camera({ kind: 'point', point: { x: p.x, z: p.z, distance: 1600 } });
                  }}
                >
                  <span>
                    <b>{z.zone?.name}</b>
                    <span className="faint small">
                      {z.pendingRequests} waiting · {z.forecastNext30} expected · {z.supply} free nearby
                    </span>
                  </span>
                  <span className="bad">Short {z.gap}</span>
                  <ArrowRight size={16} className="faint" />
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Parked too long" subtitle="Over 1 hour at base" count={parkedLong.length}>
          {!parkedLong.length && <div className="empty">No car has been parked over an hour.</div>}
          <ul className="rows">
            {parkedLong.slice(0, 6).map(({ v, ms }) => (
              <li key={v.vehicleId}>
                <VLink id={v.vehicleId} />
                <span className="muted">Bay {v.parkingBay}</span>
                <span className="num" style={{ color: `color-mix(in srgb, ${IDLE_COLORS[parkingIdleLevel(ms)]} 70%, #111827)` }}>
                  {formatDuration(ms)}
                </span>
                {v.status !== 'AVAILABLE' && <StatusPill status={v.status} />}
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Sitting idle" subtitle="Available and not moving" count={idle.length}>
          <ul className="rows">
            {idle.slice(0, 6).map(({ v, idleMs, atBase }) => (
              <li key={v.vehicleId}>
                <VLink id={v.vehicleId} />
                <span className="muted">{atBase ? `Base · ${v.parkingBay}` : 'In the city'}</span>
                <span className="num">{formatDuration(idleMs)}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Drivers working" subtitle={`${working.length} on shift · ${offShift.length} on a break or off`}>
          <div className="driver-chips">
            {working.map(({ d, v }) => (
              <button key={d.driverId} className="driver-chip" onClick={() => v && open(v.vehicleId)} title={`${d.name}${v ? ` · ${v.status.replace(/_/g, ' ').toLowerCase()}` : ''}`}>
                <Avatar src={d.photo} name={d.name} size={24} />
                <span>{d.name.split(' ')[0]}</span>
                <i style={{ background: v ? STATUS_COLORS[v.status] : '#94A3B8' }} />
              </button>
            ))}
          </div>
        </Card>

        <Card title="Top earners today">
          <ul className="bars">
            {top.map((v) => (
              <li key={v.vehicleId}>
                <VLink id={v.vehicleId} />
                <span className="bar">
                  <span style={{ width: `${(v.revenueToday / maxRev) * 100}%` }} />
                </span>
                <span className="num">{formatINR(v.revenueToday)}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Below revenue target" subtitle={`Under ${formatINR(OPS_THRESHOLDS.lowRevenueINR)} today`} count={low.length}>
          {!low.length && <div className="empty">Every car is above target.</div>}
          <ul className="rows">
            {low.slice(0, 6).map((v) => (
              <li key={v.vehicleId}>
                <VLink id={v.vehicleId} />
                <span className="muted">{v.tripsToday} trips</span>
                <span className="num">{formatINR(v.revenueToday)}</span>
                <StatusPill status={v.status} />
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Not reporting location" subtitle="No GPS for over a minute" count={stale.length} alertCount>
          {!stale.length && <div className="empty">Every vehicle is reporting.</div>}
          <ul className="rows">
            {stale.map(({ v, ageMs }) => (
              <li key={v.vehicleId}>
                <VLink id={v.vehicleId} />
                <span className="muted">{v.driverName}</span>
                <span className="num bad">{formatAgo(ageMs)}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Where the cars are" subtitle={`${conc.elsewhere} between named areas`}>
          <ul className="bars">
            {conc.zones.slice(0, 7).map((z) => (
              <li key={z.zoneId}>
                <span className="zname">{z.name}</span>
                <span className="bar">
                  <span style={{ width: `${(z.total / maxConc) * 100}%` }} />
                </span>
                <span className="num">{z.total}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
