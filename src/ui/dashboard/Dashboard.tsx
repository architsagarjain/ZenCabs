import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Compass,
  Crosshair,
  Info,
  Layers,
  MapPin,
  Minus,
  Phone,
  Plus,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { formatAgo, formatDuration, formatINR, IDLE_COLORS, IDLE_LABEL, shortId, STATUS_COLORS, STATUS_LABEL } from '../../core/format';
import { toScene } from '../../core/geo';
import { VEHICLE_STATUSES } from '../../contracts/types';
import { FleetScene } from '../../scene/FleetScene';
import { cameraApi } from '../../scene/registry';
import { useFleetStore, type FleetFilter } from '../../store/fleetStore';
import { useServices } from '../../store/servicesContext';
import { useBreakpoint } from '../../store/useBreakpoint';
import { actionItems, ALERT_TITLE, feedSeverity } from '../attention';
import { ChartCard, MiniChart } from '../charts';
import { Card, KpiCard } from '../common';
import { PageHeader } from '../layout/Shell';

const MIN = 60_000;

function greeting(t: number) {
  const h = new Date(t).getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function DashboardPage({ active }: { active: boolean }) {
  const bp = useBreakpoint();
  const now = useFleetStore((s) => s.now);
  const set = useFleetStore((s) => s.set);
  if (bp === 'mobile') {
    return (
      <div className="dashboard-mobile">
        <MapCard active={active} mobile />
        <MobileSheet />
      </div>
    );
  }
  return (
    <div className="page dashboard">
      <PageHeader
        title={greeting(now)}
        context={
          <>
            Here's what's happening across Jammu right now · <span className="num">{new Date(now).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
          </>
        }
        action={
          <button className="btn primary" onClick={() => set({ dispatchOpen: true })}>
            <Plus size={18} /> New ride request
          </button>
        }
      />
      <KpiRow />
      <div className="dash-main">
        <MapCard active={active} />
        <div className="dash-side">
          <ActionCenter />
          <OperationsFeed />
        </div>
      </div>
      <Trends />
    </div>
  );
}

// ───────────────────────────── KPIs

export function KpiRow({ compact = false }: { compact?: boolean }) {
  const { analyticsService } = useServices();
  const vehicles = useFleetStore((s) => s.vehicles);
  const now = useFleetStore((s) => s.now);
  const filter = useFleetStore((s) => s.filter);
  useFleetStore((s) => s.analyticsVersion);
  const { setFilter, setPage } = useFleetStore.getState();
  const st = analyticsService.fleetStatus(vehicles);
  const tot = analyticsService.totals();
  const inService = st.totalFleet - st.maintenance - st.offline;
  const availAtBase = vehicles.filter((v) => v.status === 'AVAILABLE' && v.parkingBay).length;
  const longest = Math.max(0, ...vehicles.filter((v) => v.status === 'AVAILABLE' && v.parkingEntryTime).map((v) => now - v.parkingEntryTime!));
  const toggle = (f: FleetFilter) => setFilter(filter === f ? 'ALL' : f);

  const cards = [
    <KpiCard key="trip" label="On trip" value={st.onTrip} context={`of ${inService} in service`} delta={analyticsService.delta('onTrip', st.onTrip)} spark={analyticsService.spark('onTrip')} active={filter === 'ON_TRIP'} onClick={() => toggle('ON_TRIP')} />,
    <KpiCard key="avail" label="Available" value={st.available} context={`${availAtBase} at base · ${st.available - availAtBase} in the city`} delta={analyticsService.delta('available', st.available)} spark={analyticsService.spark('available')} active={filter === 'AVAILABLE'} onClick={() => toggle('AVAILABLE')} />,
    <KpiCard key="req" label="Open requests" value={tot.pendingRequests} context={tot.pendingRequests ? 'Waiting for a driver' : 'Every request is assigned'} delta={analyticsService.delta('pending', tot.pendingRequests)} upIsGood={false} />,
    <KpiCard key="parked" label="Parked over 1 hr" value={st.parkedOverOneHour} context={st.parkedOverOneHour ? `Longest ${formatDuration(longest)}` : 'No long idle at base'} delta={analyticsService.delta('parkedOverOneHour', st.parkedOverOneHour)} upIsGood={false} active={filter === 'PARKED_1H'} onClick={() => toggle('PARKED_1H')} />,
    <KpiCard key="rev" label="Revenue today" value={formatINR(tot.revenueToday)} context={`${tot.tripsToday} trips · ${tot.utilizationPct}% utilisation`} delta={(() => { const d = analyticsService.delta('revenue', tot.revenueToday, 60 * MIN); return d && { ...d, format: (n: number) => formatINR(Math.abs(n)) }; })()} spark={analyticsService.spark('revenue')} />,
    <KpiCard key="health" label="Fleet health" value={<>{inService}<span className="kpi-of">/{st.totalFleet}</span></>} context={`${st.maintenance} in maintenance · ${st.offline} offline`} onClick={() => setPage('fleet')} />,
  ];
  return <div className={`kpi-row ${compact ? 'compact' : ''}`}>{cards}</div>;
}

// ───────────────────────────── Map

export function MapCard({ active, mobile = false }: { active: boolean; mobile?: boolean }) {
  return (
    <section className={`map-card ${mobile ? 'mobile' : 'card'}`} aria-label="Live fleet map">
      <div className="map-canvas">
        <FleetScene active={active} />
      </div>
      <MapToolbar />
      <ZoomControls />
      <MapAttribution />
    </section>
  );
}

function MapToolbar() {
  const selected = useFleetStore((s) => s.selectedVehicleId);
  const following = useFleetStore((s) => s.following);
  const filter = useFleetStore((s) => s.filter);
  const { camera, set, setFilter } = useFleetStore.getState();
  const [preset, setPreset] = useState<'REGION' | 'CITY' | 'BASE' | null>(null);
  const [open, setOpen] = useState<'layers' | 'legend' | null>(null);
  const go = (p: 'REGION' | 'CITY' | 'BASE') => {
    setPreset(p);
    camera({ kind: 'preset', preset: p });
  };
  return (
    <>
      <div className="map-toolbar">
        <div className="segmented on-map" role="group" aria-label="Map view">
          {(['REGION', 'CITY', 'BASE'] as const).map((p) => (
            <button key={p} className={preset === p && !following ? 'active' : ''} onClick={() => go(p)}>
              {p === 'REGION' ? 'Region' : p === 'CITY' ? 'City' : 'Base'}
            </button>
          ))}
        </div>
        {selected && following && (
          <span className="map-chip">
            <Crosshair size={14} /> Following {shortId(selected)}
            <button aria-label="Stop following" onClick={() => set({ following: false })}>
              <X size={14} />
            </button>
          </span>
        )}
        {filter !== 'ALL' && (
          <span className="map-chip">
            Showing: {filterLabel(filter)}
            <button aria-label="Clear filter" onClick={() => setFilter('ALL')}>
              <X size={14} />
            </button>
          </span>
        )}
      </div>
      <div className="map-toolbar right">
        <button className={`map-btn ${open === 'legend' ? 'on' : ''}`} onClick={() => setOpen(open === 'legend' ? null : 'legend')}>
          Legend
        </button>
        <button className={`map-btn ${open === 'layers' ? 'on' : ''}`} onClick={() => setOpen(open === 'layers' ? null : 'layers')} aria-label="Map layers">
          <Layers size={16} /> Layers
        </button>
        {open === 'layers' && <LayersPopover />}
        {open === 'legend' && <LegendPopover />}
      </div>
    </>
  );
}

export function filterLabel(f: FleetFilter) {
  return f === 'PARKED_1H' ? 'parked over 1 hr' : f === 'AT_BASE' ? 'at base' : f === 'BUSY' ? 'en route' : f === 'ALL' ? 'all' : STATUS_LABEL[f].toLowerCase();
}

export function LayersPopover() {
  const showLabels = useFleetStore((s) => s.showLabels);
  const showZones = useFleetStore((s) => s.showZones);
  const showTrails = useFleetStore((s) => s.showTrails);
  const toggle = useFleetStore((s) => s.toggle);
  const rows: [string, string, boolean, 'showLabels' | 'showZones' | 'showTrails'][] = [
    ['Vehicle labels', 'ID and status above every car', showLabels, 'showLabels'],
    ['Demand zones', 'Requests vs available cars by area', showZones, 'showZones'],
    ['GPS trail', 'Breadcrumbs for the selected vehicle', showTrails, 'showTrails'],
  ];
  return (
    <div className="popover">
      {rows.map(([title, sub, on, key]) => (
        <label key={key} className="switch-row">
          <span>
            <b>{title}</b>
            <span>{sub}</span>
          </span>
          <input type="checkbox" className="switch" checked={on} onChange={() => toggle(key)} />
        </label>
      ))}
    </div>
  );
}

function LegendPopover() {
  return (
    <div className="popover legend-pop">
      <b>Vehicle status</b>
      <ul>
        {VEHICLE_STATUSES.map((s) => (
          <li key={s}>
            <i style={{ background: STATUS_COLORS[s] }} />
            {STATUS_LABEL[s]}
          </li>
        ))}
      </ul>
      <b>Parking time</b>
      <ul>
        {(['NORMAL', 'ATTENTION', 'WARNING', 'CRITICAL'] as const).map((l, i) => (
          <li key={l}>
            <i className="sq" style={{ background: IDLE_COLORS[l] }} />
            {IDLE_LABEL[l]} <span className="faint">{['0–30 min', '30–60 min', '1–2 hr', '2 hr +'][i]}</span>
          </li>
        ))}
      </ul>
      <p className="faint small">Drag to pan · right-drag or two fingers to rotate · scroll, pinch or double-click to zoom</p>
    </div>
  );
}

function ZoomControls() {
  const { parkingService } = useServices();
  return (
    <div className="zoom-controls" role="group" aria-label="Zoom">
      <button onClick={() => cameraApi.current?.zoomBy(0.5)} title="Zoom in (+)" aria-label="Zoom in">
        <Plus size={20} />
      </button>
      <button onClick={() => cameraApi.current?.zoomBy(2)} title="Zoom out (−)" aria-label="Zoom out">
        <Minus size={20} />
      </button>
      <span className="zc-sep" />
      <button onClick={() => cameraApi.current?.resetNorth()} title="Face north" aria-label="Face north">
        <Compass size={20} />
      </button>
      <button
        onClick={() => {
          const lot = parkingService.layout;
          const c = parkingService.localToScene(lot.width / 2, lot.depth / 2);
          useFleetStore.getState().camera({ kind: 'point', point: { x: c.x, z: c.z, distance: 220 } });
        }}
        title="ZenCabs base"
        aria-label="Go to ZenCabs base"
      >
        <MapPin size={20} />
      </button>
    </div>
  );
}

function MapAttribution() {
  const { mapService } = useServices();
  return (
    <div className="map-attribution" title={mapService.network.attribution}>
      © OpenStreetMap contributors · Overture Maps · Google · Microsoft
    </div>
  );
}

// ───────────────────────────── Action center + operations feed

export function ActionCenter({ limit = 4 }: { limit?: number }) {
  const { mapService, alertService } = useServices();
  const alerts = useFleetStore((s) => s.alerts);
  const vehicleMap = useFleetStore((s) => s.vehicleMap);
  const drivers = useFleetStore((s) => s.drivers);
  const now = useFleetStore((s) => s.now);
  const { select, set, camera } = useFleetStore.getState();
  const [all, setAll] = useState(false);
  const items = actionItems(alerts, vehicleMap, mapService.zones, now);
  const shown = all ? items : items.slice(0, limit);
  return (
    <section id="action-center">
      <Card
        title="Action center"
        subtitle={items.length ? 'Only what needs a person, most urgent first' : undefined}
        count={items.length}
        alertCount
        action={items.length > limit ? <button className="link-btn" onClick={() => setAll(!all)}>{all ? 'Show less' : `See all ${items.length}`}</button> : undefined}
      >
        {!items.length && (
          <div className="empty">
            <CheckCircle2 size={22} />
            <b>Nothing needs attention</b>
            Every vehicle is reporting and riders are being served.
          </div>
        )}
        <ul className="action-list">
          {shown.map((it) => {
            const sev = feedSeverity(it.alert);
            const driver = it.vehicle?.driverId ? drivers[it.vehicle.driverId] : undefined;
            return (
              <li key={it.alert.alertId} className={`action-item sev-${sev}`}>
                <SevIcon sev={sev} />
                <div className="ai-body">
                  <div className="ai-top">
                    <b>{it.title}</b>
                    <span className="faint small">{formatAgo(now - it.alert.createdAt)}</span>
                  </div>
                  <div className="ai-subject">{it.subject}</div>
                  <div className="ai-context muted">{it.context}</div>
                  <div className="ai-actions">
                    {driver && (
                      <button className="btn sm" onClick={() => set({ callDriverId: driver.driverId })}>
                        <Phone size={14} /> Call
                      </button>
                    )}
                    {it.vehicle && (
                      <button className="btn sm" onClick={() => select(it.vehicle!.vehicleId)}>
                        <Crosshair size={14} /> Locate
                      </button>
                    )}
                    {it.zone && !it.vehicle && (
                      <>
                        <button className="btn sm primary" onClick={() => set({ dispatchOpen: true })}>
                          Assign a car
                        </button>
                        <button
                          className="btn sm"
                          onClick={() => {
                            const p = toScene(it.zone!.center.lat, it.zone!.center.lng);
                            set({ showZones: true });
                            camera({ kind: 'point', point: { x: p.x, z: p.z, distance: 1600 } });
                          }}
                        >
                          Show area
                        </button>
                      </>
                    )}
                    <button className="btn sm ghost" onClick={() => alertService.acknowledge(it.alert.alertId)}>
                      Resolve
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}

function SevIcon({ sev }: { sev: 'critical' | 'warning' | 'info' }) {
  const Icon = sev === 'critical' ? AlertOctagon : sev === 'warning' ? AlertTriangle : Info;
  return (
    <span className={`sev-icon ${sev}`} aria-label={sev}>
      <Icon size={16} strokeWidth={2.2} />
    </span>
  );
}

export function OperationsFeed({ limit = 40 }: { limit?: number }) {
  const alerts = useFleetStore((s) => s.alerts);
  const activity = useFleetStore((s) => s.activity);
  const now = useFleetStore((s) => s.now);
  const tab = useFleetStore((s) => s.feedTab);
  const { select, set } = useFleetStore.getState();
  const open = alerts.filter((a) => !a.resolvedAt);
  return (
    <Card
      title="Operations feed"
      className="feed-card"
      action={
        <div className="segmented sm" role="tablist">
          <button role="tab" aria-selected={tab === 'alerts'} className={tab === 'alerts' ? 'active' : ''} onClick={() => set({ feedTab: 'alerts' })}>
            Alerts {open.length > 0 && <span className="num faint">{open.length}</span>}
          </button>
          <button role="tab" aria-selected={tab === 'activity'} className={tab === 'activity' ? 'active' : ''} onClick={() => set({ feedTab: 'activity' })}>
            Activity
          </button>
        </div>
      }
    >
      <ul className="feed-list">
        {tab === 'alerts' &&
          alerts.slice(0, limit).map((a) => {
            const sev = feedSeverity(a);
            return (
              <li key={a.alertId} className={a.resolvedAt ? 'resolved' : ''} onClick={() => a.vehicleId && select(a.vehicleId)}>
                <SevIcon sev={sev} />
                <div>
                  <div className="fi-top">
                    <b>{ALERT_TITLE[a.type]}</b>
                    <span className="faint small">{a.resolvedAt ? 'Resolved' : formatAgo(now - a.createdAt)}</span>
                  </div>
                  <div className="muted small">{a.message}</div>
                </div>
              </li>
            );
          })}
        {tab === 'alerts' && !alerts.length && <li className="empty">No alerts yet.</li>}
        {tab === 'activity' &&
          activity.slice(0, limit).map((a) => (
            <li key={a.id} onClick={() => a.vehicleId && select(a.vehicleId)}>
              <span className={`act-dot k-${a.kind.toLowerCase()}`} />
              <div>
                <div className="fi-top">
                  <span>{a.text}</span>
                  <span className="faint small">{formatAgo(now - a.at)}</span>
                </div>
              </div>
            </li>
          ))}
        {tab === 'activity' && !activity.length && <li className="empty">Waiting for the first dispatch…</li>}
      </ul>
    </Card>
  );
}

// ───────────────────────────── Trends

export function Trends() {
  const { analyticsService } = useServices();
  useFleetStore((s) => s.analyticsVersion);
  useFleetStore((s) => s.trips.length);
  const rides = analyticsService.ridesByHour();
  const revenue = analyticsService.revenueCurve();
  const util = analyticsService.history().slice(-120);
  const hourLabel = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`;
  const timeLabel = (t: number) => new Date(t).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(' ', '').toLowerCase();
  const ridePts = rides.map((r) => ({ x: r.hour, y: r.rides, label: hourLabel(r.hour) }));
  const revPts = revenue.map((r) => ({ x: r.t, y: r.value, label: timeLabel(r.t) }));
  const utilPts = util.map((s) => ({ x: s.t, y: s.utilization, label: timeLabel(s.t) }));
  const totalRides = rides.reduce((a, r) => a + r.rides, 0);
  const inr = (n: number) => (n >= 100000 ? `₹${(n / 100000).toFixed(1)}L` : n >= 1000 ? `₹${Math.round(n / 1000)}k` : `₹${Math.round(n)}`);
  return (
    <div className="trends">
      <ChartCard title="Rides" subtitle="Completed per hour, today" value={totalRides} points={ridePts} format={(n) => String(Math.round(n))}>
        <MiniChart kind="bar" points={ridePts} format={(n) => String(Math.round(n))} ariaLabel={`Completed rides per hour today, ${totalRides} in total`} />
      </ChartCard>
      <ChartCard title="Revenue" subtitle="Cumulative fares, today" value={formatINR(revPts[revPts.length - 1]?.y ?? 0)} points={revPts} format={inr}>
        <MiniChart kind="area" points={revPts} format={inr} ariaLabel="Cumulative revenue today" />
      </ChartCard>
      <ChartCard title="Fleet utilisation" subtitle={utilPts.length > 1 ? 'Share of in-service cars that are busy' : 'Builds up while the console is open'} value={`${utilPts[utilPts.length - 1]?.y ?? 0}%`} points={utilPts} format={(n) => `${Math.round(n)}%`}>
        <MiniChart kind="line" points={utilPts} format={(n) => `${Math.round(n)}%`} yMax={100} ariaLabel="Fleet utilisation over time" />
      </ChartCard>
    </div>
  );
}

// ───────────────────────────── Mobile bottom sheet

const SNAP = { peek: 0, half: 1, full: 2 } as const;

function MobileSheet() {
  const sheet = useFleetStore((s) => s.sheet);
  const set = useFleetStore((s) => s.set);
  const selected = useFleetStore((s) => s.selectedVehicleId);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y0: number; h0: number; moved: boolean } | null>(null);
  const [dragH, setDragH] = useState<number | null>(null);

  const heights = () => {
    const vh = ref.current?.parentElement?.clientHeight ?? window.innerHeight;
    // Peek shows the handle and the KPI strip, nothing cut in half.
    const k = ref.current?.querySelector<HTMLElement>('.kpi-row');
    const peek = k ? k.offsetTop + k.offsetHeight + 8 : 168;
    return { peek, half: Math.round(vh * 0.52), full: Math.round(vh - 12) };
  };
  useEffect(() => setDragH(null), [sheet]);

  const onDown = (e: RPointerEvent) => {
    drag.current = { y0: e.clientY, h0: heights()[sheet], moved: false };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: RPointerEvent) => {
    if (!drag.current) return;
    const dy = drag.current.y0 - e.clientY;
    if (Math.abs(dy) > 4) drag.current.moved = true;
    const h = heights();
    setDragH(Math.max(h.peek - 40, Math.min(h.full, drag.current.h0 + dy)));
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      set({ sheet: sheet === 'peek' ? 'half' : 'peek' });
      return;
    }
    const h = heights();
    const cur = dragH ?? h[sheet];
    const best = (Object.keys(SNAP) as (keyof typeof SNAP)[]).reduce((a, b) => (Math.abs(h[b] - cur) < Math.abs(h[a] - cur) ? b : a));
    set({ sheet: best });
    setDragH(null);
  };

  if (selected) return null; // the vehicle sheet takes over
  const height = dragH ?? heights()[sheet];
  return (
    <div className={`m-sheet ${dragH != null ? 'dragging' : ''}`} ref={ref} style={{ height }}>
      <div className="m-handle" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} role="button" aria-label="Resize panel">
        <span />
      </div>
      <div className="m-sheet-body">
        <KpiRow compact />
        <div className="m-sheet-actions">
          <button className="btn primary wide" onClick={() => set({ dispatchOpen: true })}>
            <Plus size={18} /> New ride request
          </button>
        </div>
        <ActionCenter limit={3} />
        <OperationsFeed limit={25} />
      </div>
    </div>
  );
}
