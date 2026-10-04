import { useState } from 'react';
import { formatAgo, formatDuration, formatINR, IDLE_COLORS, parkingIdleLevel, shortId, STATUS_COLORS } from '../core/format';
import { toScene } from '../core/geo';
import { OPS_THRESHOLDS } from '../config/dataConfig';
import { BRAND } from '../config/theme';
import { useFleetStore } from '../store/fleetStore';
import { useServices } from '../store/servicesContext';
import { Card, StatusPill } from './common';

/**
 * Operations view: one card per question a fleet manager asks during a shift.
 * Every answer is computed by analyticsService from live service data.
 */
export function OperationsPanel() {
  const { analyticsService, dispatchService } = useServices();
  useFleetStore((s) => s.vehicles);
  useFleetStore((s) => s.drivers);
  useFleetStore((s) => s.analyticsVersion);
  const now = useFleetStore((s) => s.now);
  const { select, camera } = useFleetStore.getState();
  const [assigning, setAssigning] = useState(false);

  const idle = analyticsService.idleVehicles();
  const working = analyticsService.workingDrivers();
  const offShift = analyticsService.driversOffShift();
  const parkedLong = analyticsService.parkedTooLong(60);
  const top = analyticsService.topRevenue(6);
  const conc = analyticsService.concentration();
  const gaps = analyticsService.demandGaps();
  const rec = analyticsService.nextBookingRecommendation();
  const low = analyticsService.lowRevenue();
  const stale = analyticsService.staleGps();
  const maxRev = Math.max(1, ...top.map((v) => v.revenueToday));
  const maxConc = Math.max(1, ...conc.zones.map((z) => z.total));

  const VLink = ({ id }: { id: string }) => (
    <button className="vlink" onClick={() => select(id)}>
      {shortId(id)}
    </button>
  );

  return (
    <aside className="panel left ops-panel">
      <div className="panel-head">
        <h2>Operations</h2>
        <span className="muted">Live answers · updated continuously</span>
      </div>
      <div className="ops-scroll">
        <Card icon="🎯" title="Which vehicle should receive the next booking?" subtitle={rec?.forZone ?? 'Waiting for demand signal…'} accent={BRAND.sky}>
          {rec?.result.recommended ? (
            <>
              <div className="rec">
                <VLink id={rec.result.recommended.vehicleId} />
                <span>
                  ETA {rec.result.recommended.etaMinutes} min · {rec.result.recommended.distanceKm} km
                </span>
              </div>
              <ul className="reasons">
                {rec.result.recommended.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              {rec.result.booking.status === 'PENDING' && rec.result.booking.bookingId && (
                <button
                  className="btn primary"
                  disabled={assigning}
                  onClick={async () => {
                    setAssigning(true);
                    try {
                      const r = await dispatchService.dispatch({ bookingId: rec.result.booking.bookingId, pickup: rec.result.booking.pickup, destination: rec.result.booking.destination, vehicleId: rec.result.recommended!.vehicleId });
                      if (r.assigned) select(rec.result.recommended!.vehicleId);
                    } finally {
                      setAssigning(false);
                    }
                  }}
                >
                  Assign {shortId(rec.result.recommended.vehicleId)} now
                </button>
              )}
              {rec.result.candidates.length > 1 && (
                <div className="muted small">
                  Next best: {rec.result.candidates.slice(1, 4).map((c) => `${shortId(c.vehicleId)} (${c.etaMinutes}m)`).join(' · ')}
                </div>
              )}
            </>
          ) : (
            <p className="muted">No dispatchable vehicle right now.</p>
          )}
        </Card>

        <Card icon="⏱" title="Which cars have been parked too long?" subtitle={`${parkedLong.length} parked > 1 hr at base`} accent="#F97316">
          {parkedLong.length === 0 && <p className="muted">None — great.</p>}
          {parkedLong.map(({ v, ms }) => {
            const lvl = parkingIdleLevel(ms);
            return (
              <div className="ops-row" key={v.vehicleId}>
                <VLink id={v.vehicleId} />
                <span className="muted">Bay {v.parkingBay}</span>
                <span className="mono" style={{ color: IDLE_COLORS[lvl] }}>
                  {formatDuration(ms)}
                </span>
                {v.status !== 'AVAILABLE' && <StatusPill status={v.status} small />}
              </div>
            );
          })}
        </Card>

        <Card icon="🔥" title="Which areas have demand but not enough vehicles?" subtitle="Pending + 30-min forecast vs available supply" accent="#DC2626">
          {gaps.length === 0 && <p className="muted">Supply covers demand everywhere.</p>}
          {gaps.slice(0, 6).map((z) => (
            <div
              className="ops-row clickable"
              key={z.zoneId}
              onClick={() => {
                if (!z.zone) return;
                const p = toScene(z.zone.center.lat, z.zone.center.lng);
                camera({ kind: 'point', point: { x: p.x, z: p.z, distance: 900 } });
              }}
            >
              <b>{z.zone?.name}</b>
              <span className="muted">
                {z.pendingRequests} waiting · {z.forecastNext30} expected
              </span>
              <span className={z.gap > 0 ? 'bad' : 'ok'}>{z.gap > 0 ? `short ${z.gap}` : `supply ${z.supply}`}</span>
            </div>
          ))}
        </Card>

        <Card icon="💤" title="Which vehicles are sitting idle?" subtitle={`${idle.length} available and stationary`} accent="#16A34A">
          {idle.slice(0, 10).map(({ v, idleMs, atBase }) => (
            <div className="ops-row" key={v.vehicleId}>
              <VLink id={v.vehicleId} />
              <span className="muted">{atBase ? `Base · ${v.parkingBay}` : 'In field'}</span>
              <span className="mono">{formatDuration(idleMs)}</span>
            </div>
          ))}
        </Card>

        <Card icon="🧑‍✈️" title="Which drivers are currently working?" subtitle={`${working.length} on shift · ${offShift.length} on break / off`} accent={BRAND.tagline}>
          <div className="driver-grid">
            {working.map(({ d, v }) => (
              <button key={d.driverId} className="driver-chip" onClick={() => v && select(v.vehicleId)} title={d.name}>
                <img src={d.photo} alt="" />
                <span>{d.name.split(' ')[0]}</span>
                <i style={{ background: v ? STATUS_COLORS[v.status] : '#64748b' }} />
              </button>
            ))}
          </div>
          {offShift.length > 0 && <div className="muted small">Not working: {offShift.map((d) => `${d.name} (${d.shiftState.replace('_', ' ').toLowerCase()})`).join(', ')}</div>}
        </Card>

        <Card icon="💰" title="Which vehicles are making the most revenue?" subtitle="Top earners today" accent={BRAND.aqua}>
          {top.map((v) => (
            <div className="bar-row" key={v.vehicleId}>
              <VLink id={v.vehicleId} />
              <div className="bar">
                <div style={{ width: `${(v.revenueToday / maxRev) * 100}%` }} />
              </div>
              <span className="mono">{formatINR(v.revenueToday)}</span>
            </div>
          ))}
        </Card>

        <Card icon="📉" title="Which cars haven't generated enough revenue?" subtitle={`Below ${formatINR(OPS_THRESHOLDS.lowRevenueINR)} today`} accent="#f59e0b">
          {low.length === 0 && <p className="muted">Every vehicle is above target.</p>}
          {low.slice(0, 8).map((v) => (
            <div className="ops-row" key={v.vehicleId}>
              <VLink id={v.vehicleId} />
              <span className="muted">{v.tripsToday} trips</span>
              <span className="mono bad">{formatINR(v.revenueToday)}</span>
              <StatusPill status={v.status} small />
            </div>
          ))}
        </Card>

        <Card icon="📡" title="Which vehicles haven't sent GPS recently?" subtitle="No fix for over 60 sec" accent="#64748b">
          {stale.length === 0 && <p className="muted">All vehicles reporting.</p>}
          {stale.map(({ v, ageMs }) => (
            <div className="ops-row" key={v.vehicleId}>
              <VLink id={v.vehicleId} />
              <span className="muted">{v.driverName}</span>
              <span className="mono bad">{formatAgo(ageMs)}</span>
              <StatusPill status={v.status} small />
            </div>
          ))}
        </Card>

        <Card icon="📍" title="Where are my cars concentrated?" subtitle={`${conc.elsewhere} vehicles between zones`} accent={BRAND.aquaDeep}>
          {conc.zones.map((z) => (
            <div className="bar-row" key={z.zoneId}>
              <span className="zname">{z.name}</span>
              <div className="bar stacked">
                <div style={{ width: `${(z.available / maxConc) * 100}%`, background: STATUS_COLORS.AVAILABLE }} />
                <div style={{ width: `${(z.busy / maxConc) * 100}%`, background: STATUS_COLORS.ON_TRIP }} />
                <div style={{ width: `${((z.total - z.available - z.busy) / maxConc) * 100}%`, background: '#BDBDBD' }} />
              </div>
              <span className="mono">{z.total}</span>
            </div>
          ))}
          <div className="legend small">
            <i style={{ background: STATUS_COLORS.AVAILABLE }} /> available <i style={{ background: STATUS_COLORS.ON_TRIP }} /> busy <i style={{ background: '#BDBDBD' }} /> other
          </div>
        </Card>
        <div className="muted small" style={{ padding: '4px 4px 12px' }}>
          Snapshot at {new Date(now).toLocaleTimeString('en-IN', { hour12: false })}
        </div>
      </div>
    </aside>
  );
}
