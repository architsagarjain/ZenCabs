import type { Clock } from '../core/clock';
import { DATA_CONFIG, OPS_THRESHOLDS } from '../config/dataConfig';
import { API } from '../contracts/api';
import type { DispatchResult, FleetAnalytics, FleetStatusSummary, Vehicle, VehicleStatus } from '../contracts/types';
import { VEHICLE_STATUSES } from '../contracts/types';
import type { ApiClient } from '../transport/ApiClient';
import { ObservableService } from './base';
import type { BookingService } from './bookingService';
import type { DispatchService } from './dispatchService';
import type { DriverService } from './driverService';
import type { MapService } from './mapService';
import type { VehicleService } from './vehicleService';

const HOUR = 3_600_000;
const MIN = 60_000;

export interface KpiSample {
  t: number;
  onTrip: number;
  available: number;
  pending: number;
  revenue: number;
  utilization: number;
  parkedOverOneHour: number;
  inService: number;
}
export type KpiKey = Exclude<keyof KpiSample, 't'>;
const BUSY: VehicleStatus[] = ['ASSIGNED', 'EN_ROUTE_PICKUP', 'WAITING', 'ON_TRIP'];

/**
 * Fleet metrics. HUD counters are derived live from vehicleService (so they
 * react instantly to realtime events); heavier aggregates (zone demand,
 * revenue totals) come from GET /api/fleet/analytics.
 */
export class AnalyticsService extends ObservableService {
  private server: FleetAnalytics | null = null;
  private recommendation: { result: DispatchResult; forZone: string; at: number } | null = null;
  /** Client-side KPI history (one sample per simulated/real minute) for deltas and sparklines. */
  private samples: KpiSample[] = [];

  constructor(
    private api: ApiClient,
    private clock: Clock,
    private vehicles: VehicleService,
    private drivers: DriverService,
    private bookings: BookingService,
    private dispatch: DispatchService,
    private map: MapService,
  ) {
    super();
  }

  async init() {
    await this.refresh();
    setInterval(() => this.refresh().catch(() => undefined), 5_000);
  }

  async refresh() {
    this.sample();
    this.server = await this.api.get<FleetAnalytics>(API.fleetAnalytics);
    await this.refreshRecommendation();
    this.notify();
  }

  /** Server-side snapshot (authoritative totals). */
  fetchServerStatus() {
    return this.api.get<FleetStatusSummary>(API.fleetStatus);
  }

  fleetStatus(list: Vehicle[] = this.vehicles.getAll()): FleetStatusSummary {
    const byStatus = Object.fromEntries(VEHICLE_STATUSES.map((s) => [s, 0])) as Record<VehicleStatus, number>;
    let parkedOverOneHour = 0;
    let atBase = 0;
    const now = this.clock.now();
    for (const v of list) {
      byStatus[v.status]++;
      if (v.parkingBay) atBase++;
      if (v.status === 'AVAILABLE' && v.parkingEntryTime && now - v.parkingEntryTime > HOUR) parkedOverOneHour++;
    }
    return {
      serverTime: now,
      totalFleet: list.length,
      byStatus,
      onTrip: byStatus.ON_TRIP,
      available: byStatus.AVAILABLE,
      parkedOverOneHour,
      maintenance: byStatus.MAINTENANCE,
      offline: byStatus.OFFLINE,
      atBase,
    };
  }

  totals() {
    const list = this.vehicles.getAll();
    const busy = list.filter((v) => BUSY.includes(v.status)).length;
    const operable = list.filter((v) => v.status !== 'MAINTENANCE' && v.status !== 'OFFLINE').length;
    return {
      revenueToday: list.reduce((s, v) => s + v.revenueToday, 0),
      tripsToday: list.reduce((s, v) => s + v.tripsToday, 0),
      distanceToday: Math.round(list.reduce((s, v) => s + v.distanceToday, 0)),
      utilizationPct: Math.round((busy / Math.max(1, operable)) * 100),
      pendingRequests: this.bookings.pendingBookings().length,
    };
  }

  private sample() {
    const now = this.clock.now();
    const last = this.samples[this.samples.length - 1];
    if (last && now - last.t < MIN) return;
    const st = this.fleetStatus();
    const tot = this.totals();
    this.samples.push({
      t: now,
      onTrip: st.onTrip,
      available: st.available,
      pending: tot.pendingRequests,
      revenue: tot.revenueToday,
      utilization: tot.utilizationPct,
      parkedOverOneHour: st.parkedOverOneHour,
      inService: st.totalFleet - st.maintenance - st.offline,
    });
    if (this.samples.length > 600) this.samples.shift();
  }

  history(): KpiSample[] {
    return this.samples;
  }

  /** Change in a KPI vs ~`windowMs` ago (or the oldest sample if history is shorter). */
  delta(key: KpiKey, current: number, windowMs = 30 * MIN): { delta: number; sinceMs: number } | null {
    const now = this.clock.now();
    const past = this.samples.find((x) => x.t >= now - windowMs) ?? this.samples[0];
    if (!past || now - past.t < 4 * MIN) return null;
    return { delta: current - past[key], sinceMs: now - past.t };
  }

  /** Last `n` samples of a KPI for a sparkline. */
  spark(key: KpiKey, n = 12): number[] {
    return this.samples.slice(-n).map((x) => x[key]);
  }

  /** Completed rides per hour today (from trip records). */
  ridesByHour(): { hour: number; rides: number }[] {
    const now = new Date(this.clock.now());
    const start = new Date(now);
    start.setHours(6, 0, 0, 0);
    const buckets = new Map<number, number>();
    for (let h = 6; h <= now.getHours(); h++) buckets.set(h, 0);
    for (const t of this.bookings.getTrips()) {
      if (t.status !== 'COMPLETED' || !t.completedAt || t.completedAt < start.getTime()) continue;
      const h = new Date(t.completedAt).getHours();
      if (buckets.has(h)) buckets.set(h, buckets.get(h)! + 1);
    }
    return [...buckets].map(([hour, rides]) => ({ hour, rides }));
  }

  /** Cumulative revenue today, in 30-minute steps (from completed trip fares). */
  revenueCurve(): { t: number; value: number }[] {
    const now = this.clock.now();
    const start = new Date(now);
    start.setHours(6, 0, 0, 0);
    const trips = this.bookings
      .getTrips()
      .filter((t) => t.status === 'COMPLETED' && t.completedAt && t.completedAt >= start.getTime())
      .sort((a, b) => a.completedAt! - b.completedAt!);
    const out: { t: number; value: number }[] = [];
    let i = 0;
    let sum = 0;
    for (let t = start.getTime(); t <= now; t += 30 * MIN) {
      while (i < trips.length && trips[i].completedAt! <= t) sum += trips[i++].fare;
      out.push({ t, value: sum });
    }
    while (i < trips.length) sum += trips[i++].fare;
    out.push({ t: now, value: sum });
    return out;
  }

  zoneDemand() {
    return this.server?.zones ?? [];
  }

  // ───────────── Operations view: answers to the fleet manager's questions

  /** Which vehicles are sitting idle? (available, stationary) */
  idleVehicles() {
    return this.vehicles
      .getAll()
      .filter((v) => v.status === 'AVAILABLE' && v.speed < 3)
      .map((v) => ({ v, idleMs: v.parkingEntryTime ? this.clock.now() - v.parkingEntryTime : this.vehicles.statusAge(v.vehicleId), atBase: !!v.parkingBay }))
      .sort((a, b) => b.idleMs - a.idleMs);
  }

  /** Which drivers are currently working? */
  workingDrivers() {
    return this.drivers
      .getAll()
      .filter((d) => d.shiftState === 'ON_SHIFT')
      .map((d) => ({ d, v: this.vehicles.get(d.assignedVehicleId ?? '') }))
      .sort((a, b) => Number(BUSY.includes(b.v?.status as VehicleStatus)) - Number(BUSY.includes(a.v?.status as VehicleStatus)));
  }

  driversOffShift() {
    return this.drivers.getAll().filter((d) => d.shiftState !== 'ON_SHIFT');
  }

  /** Which cars have been parked too long? */
  parkedTooLong(minMinutes = 60) {
    const now = this.clock.now();
    return this.vehicles
      .getAll()
      .filter((v) => v.parkingBay && v.parkingEntryTime && now - v.parkingEntryTime >= minMinutes * 60_000 && v.status !== 'MAINTENANCE')
      .map((v) => ({ v, ms: now - v.parkingEntryTime! }))
      .sort((a, b) => b.ms - a.ms);
  }

  /** Which vehicles are making the most revenue? */
  topRevenue(n = 8) {
    return [...this.vehicles.getAll()].sort((a, b) => b.revenueToday - a.revenueToday).slice(0, n);
  }

  /** Which cars haven't generated enough revenue today? */
  lowRevenue(threshold = OPS_THRESHOLDS.lowRevenueINR) {
    return this.vehicles
      .getAll()
      .filter((v) => v.status !== 'MAINTENANCE' && v.revenueToday < threshold)
      .sort((a, b) => a.revenueToday - b.revenueToday);
  }

  /** Which vehicles haven't communicated GPS data recently? */
  staleGps(afterMs = DATA_CONFIG.GPS_STALE_AFTER_MS) {
    const now = this.clock.now();
    return this.vehicles
      .getAll()
      .map((v) => ({ v, ageMs: now - v.lastGpsUpdate }))
      .filter((x) => x.ageMs > afterMs || x.v.status === 'OFFLINE')
      .sort((a, b) => b.ageMs - a.ageMs);
  }

  /** Where are my cars concentrated? */
  concentration() {
    const counts = new Map<string, { zoneId: string; name: string; total: number; available: number; busy: number }>();
    let elsewhere = 0;
    for (const v of this.vehicles.getAll()) {
      const z = this.map.zoneOf(v.latitude, v.longitude);
      if (!z) {
        elsewhere++;
        continue;
      }
      const c = counts.get(z.zoneId) ?? { zoneId: z.zoneId, name: z.name, total: 0, available: 0, busy: 0 };
      c.total++;
      if (v.status === 'AVAILABLE') c.available++;
      if (BUSY.includes(v.status)) c.busy++;
      counts.set(z.zoneId, c);
    }
    return { zones: [...counts.values()].sort((a, b) => b.total - a.total), elsewhere };
  }

  /** Which areas have demand but not enough vehicles? */
  demandGaps() {
    return this.zoneDemand()
      .map((z) => ({ ...z, zone: this.map.zone(z.zoneId) }))
      .filter((z) => z.gap > 0 || z.pendingRequests > 0)
      .sort((a, b) => b.gap - a.gap || b.pendingRequests - a.pendingRequests);
  }

  /** Which vehicle should receive the next booking? */
  nextBookingRecommendation() {
    return this.recommendation;
  }

  private async refreshRecommendation() {
    const pending = this.bookings.pendingBookings();
    const oldest = pending[pending.length - 1];
    let pickup;
    let forZone;
    if (oldest) {
      pickup = oldest.pickup;
      forZone = `Pending request at ${oldest.pickup.name}`;
    } else {
      const top = [...this.zoneDemand()].sort((a, b) => b.forecastNext30 - b.supply - (a.forecastNext30 - a.supply))[0];
      const zone = top && this.map.zone(top.zoneId);
      if (!zone) return;
      pickup = { ...zone.center, name: zone.name, zoneId: zone.zoneId };
      forZone = `Highest forecast demand: ${zone.name}`;
    }
    try {
      const result = await this.dispatch.recommend({ pickup, destination: pickup, bookingId: oldest?.bookingId });
      this.recommendation = { result, forZone, at: this.clock.now() };
    } catch {
      /* keep previous */
    }
  }
}
