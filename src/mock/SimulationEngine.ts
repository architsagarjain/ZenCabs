/**
 * ZenCabs mock world.
 *
 * Plays the role of the production backend + vehicle telematics during the
 * prototype phase: it owns the "truth" for 40 vehicles, moves them along the
 * road network, runs the dispatch lifecycle, opens/closes parking sessions,
 * raises alerts, and emits exactly the realtime events the real backend will.
 *
 * Nothing in the UI imports this file. It is reached only through
 *   - MockApiClient  → mockRouter → engine queries / commands
 *   - MockRealtimeClient → engine.events
 *   - MockGPSProvider → engine.gpsFeed
 * and it runs unchanged inside the reference Node server (server/index.ts).
 */
import type { Clock } from '../core/clock';
import { Emitter } from '../core/emitter';
import { fromScene, localToLatLng, toScene } from '../core/geo';
import type { RealtimeEvents } from '../contracts/events';
import type { MapNetwork } from '../contracts/map';
import type {
  Alert,
  AlertSeverity,
  AlertType,
  Booking,
  DispatchCandidate,
  DispatchRequest,
  DispatchResult,
  Driver,
  FleetAnalytics,
  FleetStatusSummary,
  GPSFix,
  NamedPlace,
  ParkingBay,
  ParkingBayState,
  ParkingLotLayout,
  ParkingSession,
  Trip,
  Vehicle,
  VehicleStatus,
  VehicleStatusUpdate,
  Zone,
  ZoneDemand,
} from '../contracts/types';
import { CUSTOMER_NAMES, rng, seedFleet } from './fleetSeed';
import { buildWorld, type RawMapData } from './world/jammuMap';
import { bayAccess, buildParkingLot, SPINE_X } from './world/parkingLot';
import { CLASS_SPEED_MPS, RoadGraph, type GraphNode } from './world/roadGraph';

type Phase =
  | 'PARKED'
  | 'ACCEPTING'
  | 'TO_PICKUP'
  | 'WAITING'
  | 'ON_TRIP'
  | 'RETURNING'
  | 'IDLE_FIELD'
  | 'TO_STAND'
  | 'MAINT'
  | 'OFFLINE';

interface PathPoint {
  x: number;
  z: number;
  nodeId?: string;
  /** Segment starting at this point is driven in reverse (body faces backwards). */
  reverse?: boolean;
  /** Segment starting at this point is inside the lot (slow, no signals). */
  lot?: boolean;
  /** Speed for the segment starting here, m/s. */
  v?: number;
}

interface Motion {
  pts: PathPoint[];
  cum: number[];
  s: number;
  speed: number;
  stopUntil: number;
  onArrive: () => void;
  /** Cached segment index for s (s only moves forward). */
  seg: number;
}

interface SimVehicle {
  v: Vehicle;
  phase: Phase;
  x: number;
  z: number;
  motion: Motion | null;
  nodeId: string | null;
  bookingId: string | null;
  phaseUntil: number;
  reservedBay: string | null;
  gpsMutedUntil: number;
  nextGpsAt: number;
  idleSince: number;
  factor: number;
  speedingUntil: number;
  history: GPSFix[];
}

export interface EngineOptions {
  clock: Clock;
  /** Real Jammu map (public/maps/jammu-map.json). */
  map: RawMapData;
  seed?: number;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const LANE_OFFSET = 2.6;
/** Vehicles operate mostly within this radius of the city centre (outstation trips aside). */
const CITY_RADIUS = 6500;
const OUTSTATION_SHARE = 0.05;
/** City-wide ride requests per minute (Jammu-scale distances, 40 cars). */
const REQUESTS_PER_MIN = 0.9;
const LOT_SPEED = 2.6;


export class SimulationEngine {
  readonly events = new Emitter<RealtimeEvents>();
  readonly gpsFeed = new Emitter<{ fix: GPSFix }>();
  readonly network: MapNetwork;
  readonly zones: Zone[];
  readonly layout: ParkingLotLayout;
  readonly clock: Clock;

  private graph: RoadGraph;
  /** Relative ride-request rate per zone (from the map's landmarks). */
  private demandWeight: Record<string, number>;
  private demandTotal: number;
  private cityNodes: GraphNode[];
  private rand: () => number;
  private fleet = new Map<string, SimVehicle>();
  private drivers = new Map<string, Driver>();
  private trips = new Map<string, Trip>();
  private bookings = new Map<string, Booking>();
  private bays = new Map<string, ParkingBayState>();
  private sessions: ParkingSession[] = [];
  private alerts: Alert[] = [];
  private activeAlertKeys = new Map<string, string>();
  private zoneSurgePhase = new Map<string, number>();
  private zoneRequestLog: { zoneId: string; at: number }[] = [];
  private seq = 1000;
  private lastTick: number;
  private nextDemandCheck = 0;
  private nextAlertCheck = 0;
  private nextChaos = 0;
  private nextDispatchCheck = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: EngineOptions) {
    this.clock = opts.clock;
    this.rand = rng(opts.seed ?? 7);
    const world = buildWorld(opts.map);
    this.network = world.network;
    this.zones = world.zones;
    this.demandWeight = world.demand;
    this.demandTotal = Object.values(world.demand).reduce((a, b) => a + b, 0);
    this.layout = buildParkingLot(world.lotSW);
    this.graph = new RoadGraph(this.network);
    this.cityNodes = this.graph.nodeList.filter((n) => n.id !== 'BASE_GATE' && Math.hypot(n.x, n.z) < CITY_RADIUS);
    for (const z of this.zones) this.zoneSurgePhase.set(z.zoneId, this.rand() * Math.PI * 2);
    for (const bay of this.layout.bays) this.bays.set(bay.bayId, { bay, vehicleId: null, entryTime: null, reservedFor: null });
    this.lastTick = this.clock.now();
    this.seed();
  }

  // ───────────────────────────────────────────── lifecycle

  start(intervalMs = 100) {
    if (this.timer) return;
    this.lastTick = this.clock.now();
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  tick() {
    const now = this.clock.now();
    let dt = now - this.lastTick;
    if (dt <= 0) return;
    dt = Math.min(dt, 120_000);
    // Sub-step so fast-forwarding stays stable.
    const steps = Math.ceil(dt / 1000);
    const step = dt / steps;
    for (let i = 1; i <= steps; i++) this.step(this.lastTick + step * i, step);
    this.lastTick = now;
  }

  private step(now: number, dtMs: number) {
    const dt = dtMs / 1000;
    for (const sv of this.fleet.values()) {
      if (sv.motion) this.advance(sv, dt, now);
      this.updatePhase(sv, now);
      this.updateEnergyAndIdle(sv, dt, now);
      this.maybeEmitGps(sv, now);
    }
    if (now >= this.nextDemandCheck) {
      this.generateDemand(now, 10);
      this.nextDemandCheck = now + 10_000;
    }
    if (now >= this.nextDispatchCheck) {
      this.autoDispatch(now);
      this.updateDrivers(now);
      this.nextDispatchCheck = now + 3_000;
    }
    if (now >= this.nextAlertCheck) {
      this.evaluateAlerts(now);
      this.nextAlertCheck = now + 5_000;
    }
    if (now >= this.nextChaos) {
      this.chaos(now);
      this.nextChaos = now + 60_000;
    }
  }

  // ───────────────────────────────────────────── seeding

  private seed() {
    const now = this.clock.now();
    const { vehicles, drivers } = seedFleet(now);
    for (const d of drivers) this.drivers.set(d.driverId, d);

    const order = vehicles.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const roles: string[] = [
      ...Array(2).fill('MAINT'),
      ...Array(2).fill('OFFLINE'),
      ...Array(11).fill('PARKED'),
      ...Array(16).fill('ON_TRIP'),
      ...Array(3).fill('TO_PICKUP'),
      ...Array(1).fill('WAITING'),
      ...Array(2).fill('RETURNING'),
      ...Array(3).fill('IDLE_FIELD'),
    ];
    const parkedMinutes = [6, 14, 22, 38, 47, 66, 84, 107, 131, 176, 256];
    let parkedIdx = 0;
    let fieldIdx = 0;

    order.forEach((vi, k) => {
      const v = vehicles[vi];
      const sv: SimVehicle = {
        v,
        phase: 'PARKED',
        x: 0,
        z: 0,
        motion: null,
        nodeId: null,
        bookingId: null,
        phaseUntil: 0,
        reservedBay: null,
        gpsMutedUntil: 0,
        nextGpsAt: now + this.rand() * 2000,
        idleSince: now,
        factor: 0.86 + this.rand() * 0.24,
        speedingUntil: 0,
        history: [],
      };
      this.fleet.set(v.vehicleId, sv);
      this.seedTripHistory(sv, now);
      const role = roles[k];
      const driver = this.drivers.get(v.driverId!)!;

      switch (role) {
        case 'MAINT': {
          const bay = this.bays.get(k === 0 ? 'S01' : 'S02')!.bay;
          this.placeInBay(sv, bay, now - (40 + this.rand() * 200) * MIN, false);
          v.status = 'MAINTENANCE';
          v.maintenanceStatus = 'IN_SERVICE';
          sv.phase = 'MAINT';
          driver.shiftState = 'OFF_SHIFT';
          break;
        }
        case 'OFFLINE': {
          driver.shiftState = 'OFF_SHIFT';
          v.status = 'OFFLINE';
          sv.phase = 'OFFLINE';
          if (k === 2) {
            const bay = this.bays.get('D10')!.bay;
            this.placeInBay(sv, bay, now - 310 * MIN, false);
            sv.phase = 'OFFLINE';
            v.lastGpsUpdate = now - 302 * MIN;
          } else {
            const tt = this.zoneCenter('Z-talabtillo');
            const n = this.graph.nearest(tt.x + 300, tt.z - 200);
            this.setPos(sv, n.x + 6, n.z + 8, 90);
            sv.nodeId = n.id;
            v.lastGpsUpdate = now - 187 * MIN;
          }
          break;
        }
        case 'PARKED': {
          const mins = parkedMinutes[parkedIdx++];
          const bay = this.pickFreeBay(v.fuelKind === 'ELECTRIC');
          this.placeInBay(sv, bay, now - mins * MIN, false);
          v.status = 'AVAILABLE';
          if (mins > 100 && parkedIdx % 2 === 0) {
            driver.shiftState = 'ON_BREAK';
          } else if (mins > 100) {
            driver.shiftState = 'OFF_SHIFT';
            driver.shiftStart = null;
          }
          break;
        }
        case 'IDLE_FIELD': {
          const place = this.zoneCenter(['Z-railway', 'Z-busstand', 'Z-gmc'][fieldIdx++ % 3]);
          const n = this.graph.nearest(place.x, place.z);
          this.setPos(sv, n.x + (this.rand() - 0.5) * 30, n.z + (this.rand() - 0.5) * 30, this.rand() * 360);
          sv.nodeId = n.id;
          sv.phase = 'IDLE_FIELD';
          sv.idleSince = now - (1 + this.rand() * 7) * MIN;
          v.status = 'AVAILABLE';
          break;
        }
        case 'RETURNING': {
          const start = this.randomFieldNode(900);
          this.setPos(sv, start.x, start.z, 0);
          sv.nodeId = start.id;
          this.sendToBase(sv, now, false);
          break;
        }
        case 'ON_TRIP':
        case 'TO_PICKUP':
        case 'WAITING': {
          this.seedActiveTrip(sv, role as Phase, now);
          break;
        }
      }
      v.zoneId = this.zoneAt(sv.x, sv.z);
      if (sv.phase !== 'OFFLINE') v.lastGpsUpdate = now - this.rand() * 3000;
    });

    // Some recent booking history so demand stats are populated from the first frame.
    for (const z of this.zones) {
      const w = this.demandWeight[z.zoneId] ?? 0;
      const count = Math.round(w * 9 * (0.6 + this.rand() * 0.8));
      for (let i = 0; i < count; i++) this.zoneRequestLog.push({ zoneId: z.zoneId, at: now - this.rand() * HOUR });
    }
    this.generateDemand(now, 0);
  }

  private seedTripHistory(sv: SimVehicle, now: number) {
    const v = sv.v;
    let revenue = 0;
    let dist = 0;
    const dayStart = new Date(now);
    dayStart.setHours(6, 0, 0, 0);
    const span = Math.max(HOUR, now - dayStart.getTime() - 30 * MIN);
    for (let i = 0; i < v.tripsToday; i++) {
      const a = this.randomPlace();
      let b = this.randomPlace();
      if (b.name === a.name) b = this.randomPlace();
      const km = Math.round((2 + this.rand() * 9) * 10) / 10;
      const fare = this.fareFor(km, 2 + this.rand() * 4, v.vehicleType);
      const start = now - span + (span * (i + this.rand() * 0.6)) / Math.max(1, v.tripsToday);
      revenue += fare;
      dist += km * 1.25;
      const tripId = this.id('TRP');
      const bookingId = this.id('BKG');
      this.trips.set(tripId, {
        tripId,
        bookingId,
        vehicleId: v.vehicleId,
        driverId: v.driverId!,
        status: 'COMPLETED',
        pickup: a,
        destination: b,
        assignedAt: start - 6 * MIN,
        pickupArrivalAt: start - MIN,
        startedAt: start,
        completedAt: start + km * 2.6 * MIN,
        estimatedEnd: start + km * 2.6 * MIN,
        distanceKm: km,
        fare,
        customerName: CUSTOMER_NAMES[Math.floor(this.rand() * CUSTOMER_NAMES.length)],
        route: [],
      });
    }
    v.revenueToday = revenue;
    v.distanceToday = Math.round(dist + 6 + this.rand() * 18);
    const d = this.drivers.get(v.driverId!);
    if (d) {
      d.tripsToday = v.tripsToday;
      d.earningsToday = Math.round(revenue * 0.78);
    }
  }

  private seedActiveTrip(sv: SimVehicle, role: Phase, now: number) {
    const pickupNode = this.demandNode();
    let destNode = this.destinationNode(pickupNode.id);
    const booking = this.makeBooking(this.placeAtNode(pickupNode.id), this.placeAtNode(destNode.id), now - 12 * MIN, 'APP');
    this.bookings.set(booking.bookingId, booking);
    const trip = this.makeTrip(sv, booking, now - 10 * MIN);
    sv.bookingId = booking.bookingId;
    booking.status = 'DISPATCHED';
    booking.tripId = trip.tripId;

    if (role === 'ON_TRIP') {
      this.setPos(sv, toScene(booking.pickup.lat, booking.pickup.lng).x, toScene(booking.pickup.lat, booking.pickup.lng).z, 0);
      sv.nodeId = pickupNode.id;
      trip.status = 'IN_PROGRESS';
      trip.pickupArrivalAt = now - 9 * MIN;
      this.beginTrip(sv, trip, now, false);
      // fast-forward along the route
      if (sv.motion) {
        const total = sv.motion.cum[sv.motion.cum.length - 1];
        const frac = 0.08 + this.rand() * 0.75;
        sv.motion.s = total * frac;
        const elapsed = (total * frac) / 10;
        trip.startedAt = now - elapsed * 1000;
        sv.v.tripStartTime = trip.startedAt;
        this.syncMotionPose(sv);
      }
    } else if (role === 'TO_PICKUP') {
      const start = this.randomFieldNode(0, pickupNode, 2200);
      this.setPos(sv, start.x, start.z, 0);
      sv.nodeId = start.id;
      trip.status = 'DRIVER_EN_ROUTE';
      this.driveToPickup(sv, trip, now, false);
      if (sv.motion) {
        sv.motion.s = sv.motion.cum[sv.motion.cum.length - 1] * this.rand() * 0.5;
        this.syncMotionPose(sv);
      }
    } else {
      const p = toScene(booking.pickup.lat, booking.pickup.lng);
      this.setPos(sv, p.x + 4, p.z + 10, 0);
      sv.nodeId = pickupNode.id;
      trip.status = 'DRIVER_ARRIVED';
      trip.pickupArrivalAt = now - 2 * MIN;
      sv.phase = 'WAITING';
      sv.phaseUntil = now + 45_000;
      sv.v.status = 'WAITING';
    }
  }

  // ───────────────────────────────────────────── geometry helpers

  private lotPoint(x: number, y: number): { x: number; z: number } {
    const ll = localToLatLng(this.layout.origin, this.layout.bearing, x, y);
    return toScene(ll.lat, ll.lng);
  }

  private bayPose(bay: ParkingBay) {
    const p = this.lotPoint(bay.x, bay.y);
    return { x: p.x, z: p.z, heading: (bay.rotation + this.layout.bearing) % 360 };
  }

  private setPos(sv: SimVehicle, x: number, z: number, heading: number) {
    sv.x = x;
    sv.z = z;
    const ll = fromScene(x, z);
    sv.v.latitude = ll.lat;
    sv.v.longitude = ll.lng;
    sv.v.heading = heading;
  }

  private placeInBay(sv: SimVehicle, bay: ParkingBay, entryTime: number, emit: boolean) {
    const pose = this.bayPose(bay);
    this.setPos(sv, pose.x, pose.z, pose.heading);
    sv.v.speed = 0;
    sv.phase = 'PARKED';
    sv.nodeId = null;
    sv.v.parkingBay = bay.bayId;
    sv.v.parkingEntryTime = entryTime;
    sv.v.parkingDuration = this.clock.now() - entryTime;
    const st = this.bays.get(bay.bayId)!;
    st.vehicleId = sv.v.vehicleId;
    st.entryTime = entryTime;
    st.reservedFor = null;
    sv.reservedBay = null;
    const session: ParkingSession = { sessionId: this.id('PKS'), vehicleId: sv.v.vehicleId, bayId: bay.bayId, entryTime, exitTime: null };
    this.sessions.push(session);
    if (emit) this.events.emit('vehicle.entered.parking', { vehicleId: sv.v.vehicleId, bayId: bay.bayId, session: { ...session } });
  }

  private leaveBay(sv: SimVehicle, now: number) {
    const bayId = sv.v.parkingBay;
    if (!bayId) return;
    const st = this.bays.get(bayId)!;
    st.vehicleId = null;
    st.entryTime = null;
    const session = [...this.sessions].reverse().find((s) => s.vehicleId === sv.v.vehicleId && s.exitTime == null);
    if (session) session.exitTime = now;
    sv.v.parkingBay = null;
    sv.v.parkingEntryTime = null;
    sv.v.parkingDuration = null;
    this.resolveAlertsFor(sv.v.vehicleId, ['EXCESSIVE_IDLE']);
    this.events.emit('vehicle.left.parking', {
      vehicleId: sv.v.vehicleId,
      bayId,
      session: session ? { ...session } : { sessionId: '', vehicleId: sv.v.vehicleId, bayId, entryTime: now, exitTime: now },
    });
  }

  private pickFreeBay(preferEV: boolean): ParkingBay {
    const free = [...this.bays.values()].filter((b) => !b.vehicleId && !b.reservedFor && b.bay.kind !== 'SERVICE');
    const ev = free.filter((b) => b.bay.kind === 'EV_CHARGING');
    const std = free.filter((b) => b.bay.kind === 'STANDARD');
    const pool = preferEV && ev.length ? ev : std.length ? std : free;
    // Fill from the gate side for realism, with a little randomness.
    pool.sort((a, b) => a.bay.x - b.bay.x + (this.rand() - 0.5) * 9);
    return pool[0].bay;
  }

  private lotExitPoints(bay: ParkingBay): PathPoint[] {
    const { aisleY } = bayAccess(bay);
    const pBay = this.lotPoint(bay.x, bay.y);
    const pAisle = this.lotPoint(bay.x, aisleY);
    const pSpine = this.lotPoint(SPINE_X, aisleY);
    const pGate = this.lotPoint(this.layout.gate.x, this.layout.gate.y);
    const road = this.graph.nodes.get('BASE_GATE')!;
    return [
      { ...pBay, reverse: true, lot: true, v: 1.6 },
      { ...pAisle, lot: true, v: LOT_SPEED },
      { ...pSpine, lot: true, v: LOT_SPEED },
      { ...pGate, lot: true, v: 3.2 },
      { x: road.x, z: road.z, nodeId: 'BASE_GATE' },
    ];
  }

  private lotEntryPoints(bay: ParkingBay): PathPoint[] {
    const { aisleY } = bayAccess(bay);
    const pGate = this.lotPoint(this.layout.gate.x, this.layout.gate.y);
    return [
      { ...pGate, lot: true, v: LOT_SPEED },
      { ...this.lotPoint(SPINE_X, aisleY), lot: true, v: LOT_SPEED },
      { ...this.lotPoint(bay.x, aisleY), lot: true, v: 1.8 },
      { ...this.lotPoint(bay.x, bay.y), lot: true },
    ];
  }

  /** Converts a node route to path points along the real road geometry, with left-hand lane offset. */
  private nodePathPoints(nodeIds: string[]): PathPoint[] {
    if (nodeIds.length === 1) {
      const n = this.graph.nodes.get(nodeIds[0])!;
      return [{ x: n.x, z: n.z, nodeId: n.id }];
    }
    const pts: PathPoint[] = [];
    for (let i = 0; i < nodeIds.length - 1; i++) {
      const e = this.graph.edge(nodeIds[i], nodeIds[i + 1]);
      const v = e ? CLASS_SPEED_MPS[e.cls] : 8;
      const geom = e?.pts ?? [this.graph.nodes.get(nodeIds[i])!, this.graph.nodes.get(nodeIds[i + 1])!];
      for (let k = 0; k < geom.length - 1; k++) {
        pts.push({ x: geom[k].x, z: geom[k].z, nodeId: k === 0 ? nodeIds[i] : undefined, v });
      }
    }
    const last = this.graph.nodes.get(nodeIds[nodeIds.length - 1])!;
    pts.push({ x: last.x, z: last.z, nodeId: last.id });
    return offsetLeft(pts, LANE_OFFSET);
  }

  /** Route from the vehicle's current situation to a road node. */
  private routeFromCurrent(sv: SimVehicle, targetNode: string): PathPoint[] {
    let prefix: PathPoint[];
    let start: string;
    if (sv.v.parkingBay) {
      const bay = this.bays.get(sv.v.parkingBay)!.bay;
      prefix = this.lotExitPoints(bay);
      start = 'BASE_GATE';
    } else if (sv.motion) {
      const m = sv.motion;
      const seg = segmentIndex(m, m.s);
      prefix = [{ x: sv.x, z: sv.z, v: m.pts[seg]?.v, lot: m.pts[seg]?.lot }];
      let k = seg + 1;
      while (k < m.pts.length && !m.pts[k].nodeId) prefix.push(m.pts[k++]);
      if (k < m.pts.length) {
        start = m.pts[k].nodeId!;
      } else {
        start = this.graph.nearest(sv.x, sv.z, (id) => id === 'BASE_GATE').id;
      }
    } else {
      const n = sv.nodeId ? this.graph.nodes.get(sv.nodeId)! : this.graph.nearest(sv.x, sv.z, (id) => id === 'BASE_GATE');
      prefix = [{ x: sv.x, z: sv.z, v: 6 }];
      start = n.id;
    }
    const nodes = this.graph.route(start, targetNode);
    const body = this.nodePathPoints(nodes);
    return [...prefix, ...body];
  }

  private setMotion(sv: SimVehicle, pts: PathPoint[], onArrive: () => void, now: number) {
    const clean: PathPoint[] = [];
    for (const p of pts) {
      const last = clean[clean.length - 1];
      if (last && Math.hypot(last.x - p.x, last.z - p.z) < 0.5) {
        clean[clean.length - 1] = { ...last, ...p, x: last.x, z: last.z, reverse: last.reverse, v: last.v ?? p.v };
        continue;
      }
      clean.push(p);
    }
    if (clean.length < 2) {
      sv.motion = null;
      onArrive();
      return;
    }
    const cum = [0];
    for (let i = 1; i < clean.length; i++) cum.push(cum[i - 1] + Math.hypot(clean[i].x - clean[i - 1].x, clean[i].z - clean[i - 1].z));
    sv.motion = { pts: clean, cum, s: 0, speed: sv.motion?.speed ?? 0, stopUntil: 0, onArrive, seg: 0 };
    sv.nodeId = null;
    sv.nextGpsAt = Math.min(sv.nextGpsAt, now);
  }

  private advance(sv: SimVehicle, dt: number, now: number) {
    const m = sv.motion!;
    const total = m.cum[m.cum.length - 1];
    if (now < m.stopUntil) {
      m.speed = Math.max(0, m.speed - 6 * dt);
      sv.v.speed = Math.round(m.speed * 3.6);
      return;
    }
    const seg = segmentIndex(m, m.s);
    const p = m.pts[seg];
    let target = (p.v ?? 9) * (p.lot ? 1 : sv.factor);
    if (now < sv.speedingUntil && !p.lot) target = Math.max(target, 21);
    const toNext = m.cum[seg + 1] - m.s;
    if (seg + 2 < m.pts.length && turnAngle(m.pts[seg], m.pts[seg + 1], m.pts[seg + 2]) > 35 && toNext < 28) {
      target = Math.min(target, p.lot ? 1.6 : 4.8);
    }
    const toEnd = total - m.s;
    if (toEnd < 30) target = Math.min(target, Math.max(1.2, toEnd / 3.2));
    const accel = target > m.speed ? 2.4 : 5;
    m.speed += Math.sign(target - m.speed) * Math.min(Math.abs(target - m.speed), accel * dt);
    let ns = m.s + m.speed * dt;

    // Traffic signals at arterial intersections.
    for (let k = seg + 1; k < m.pts.length - 1 && m.cum[k] <= ns; k++) {
      const q = m.pts[k];
      if (q.nodeId && this.graph.signalNodes.has(q.nodeId) && !q.lot && this.rand() < 0.2) {
        ns = m.cum[k] - 1;
        m.stopUntil = now + (6 + this.rand() * 22) * 1000;
        break;
      }
    }

    const travelled = Math.max(0, Math.min(ns, total) - m.s);
    m.s = Math.min(ns, total);
    sv.v.distanceToday += travelled / 1000;
    sv.v.odometerKm += travelled / 1000;
    this.drainEnergy(sv, travelled);
    this.syncMotionPose(sv);
    sv.v.speed = Math.round(m.speed * 3.6);
    if (m.s >= total - 0.01) {
      sv.motion = null;
      sv.v.speed = 0;
      sv.nextGpsAt = Math.min(sv.nextGpsAt, now);
      m.onArrive();
    }
  }

  private syncMotionPose(sv: SimVehicle) {
    const m = sv.motion!;
    const seg = segmentIndex(m, m.s);
    const a = m.pts[seg];
    const b = m.pts[Math.min(seg + 1, m.pts.length - 1)];
    const len = m.cum[seg + 1] - m.cum[seg] || 1;
    const t = Math.min(1, Math.max(0, (m.s - m.cum[seg]) / len));
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    let heading = (Math.atan2(b.x - a.x, -(b.z - a.z)) * 180) / Math.PI;
    if (a.reverse) heading += 180;
    this.setPos(sv, x, z, (heading + 360) % 360);
  }

  // ───────────────────────────────────────────── lifecycle phases

  private setStatus(sv: SimVehicle, status: VehicleStatus, reason?: string) {
    const prev = sv.v.status;
    if (prev === status) return;
    sv.v.status = status;
    this.events.emit('vehicle.status.updated', { vehicleId: sv.v.vehicleId, previousStatus: prev, status, vehicle: this.snapshot(sv), reason });
  }

  private updatePhase(sv: SimVehicle, now: number) {
    if (sv.phase === 'ACCEPTING' && now >= sv.phaseUntil) {
      const trip = this.tripOf(sv);
      if (trip) this.driveToPickup(sv, trip, now, true);
    } else if (sv.phase === 'WAITING' && now >= sv.phaseUntil) {
      const trip = this.tripOf(sv);
      if (trip) this.beginTrip(sv, trip, now, true);
    } else if (sv.phase === 'IDLE_FIELD' && now - sv.idleSince > (7 + (sv.factor - 0.86) * 30) * MIN) {
      this.sendToBase(sv, now, true, 'No bookings nearby — returning to base');
    }
  }

  private driveToPickup(sv: SimVehicle, trip: Trip, now: number, emit: boolean) {
    const booking = this.bookings.get(trip.bookingId)!;
    const pickupNode = this.graph.nearest(...xz(booking.pickup), (id) => id === 'BASE_GATE');
    const pts = this.routeFromCurrent(sv, pickupNode.id);
    trimEnd(pts, 6 + this.rand() * 14);
    if (sv.v.parkingBay) this.leaveBay(sv, now);
    if (sv.reservedBay) this.releaseReservation(sv);
    sv.phase = 'TO_PICKUP';
    trip.status = 'DRIVER_EN_ROUTE';
    trip.route = pts.map((p) => fromScene(p.x, p.z));
    this.setMotion(
      sv,
      pts,
      () => {
        sv.phase = 'WAITING';
        sv.nodeId = pickupNode.id;
        const longWait = this.rand() < 0.08;
        sv.phaseUntil = this.clock.now() + (longWait ? 7.5 * MIN : (20 + this.rand() * 60) * 1000);
        trip.status = 'DRIVER_ARRIVED';
        trip.pickupArrivalAt = this.clock.now();
        this.setStatus(sv, 'WAITING', `Arrived at ${booking.pickup.name}`);
      },
      now,
    );
    if (emit) this.setStatus(sv, 'EN_ROUTE_PICKUP', `Heading to ${booking.pickup.name}`);
    else sv.v.status = 'EN_ROUTE_PICKUP';
  }

  private beginTrip(sv: SimVehicle, trip: Trip, now: number, emit: boolean) {
    const destNode = this.graph.nearest(...xz(trip.destination), (id) => id === 'BASE_GATE');
    const pts = this.routeFromCurrent(sv, destNode.id);
    trimEnd(pts, 5 + this.rand() * 12);
    const lengthM = pathLength(pts);
    trip.status = 'IN_PROGRESS';
    trip.startedAt = now;
    trip.distanceKm = Math.round((lengthM / 1000) * 10) / 10;
    trip.estimatedEnd = now + (lengthM / (9.5 * sv.factor)) * 1000 + 40_000;
    trip.route = pts.map((p) => fromScene(p.x, p.z));
    sv.phase = 'ON_TRIP';
    sv.v.tripStartTime = now;
    sv.v.estimatedTripEnd = trip.estimatedEnd;
    this.resolveAlertsFor(sv.v.vehicleId, ['LONG_WAIT_AT_PICKUP']);
    this.setMotion(sv, pts, () => this.completeTrip(sv, trip), now);
    if (emit) {
      this.setStatus(sv, 'ON_TRIP', `Trip to ${trip.destination.name}`);
      this.events.emit('trip.started', { trip: { ...trip } });
    } else sv.v.status = 'ON_TRIP';
  }

  private completeTrip(sv: SimVehicle, trip: Trip) {
    const now = this.clock.now();
    const waitMin = trip.pickupArrivalAt && trip.startedAt ? (trip.startedAt - trip.pickupArrivalAt) / MIN : 0;
    trip.status = 'COMPLETED';
    trip.completedAt = now;
    trip.fare = this.fareFor(trip.distanceKm, waitMin, sv.v.vehicleType);
    const booking = this.bookings.get(trip.bookingId);
    if (booking) booking.status = 'FULFILLED';
    sv.v.tripsToday += 1;
    sv.v.revenueToday += trip.fare;
    sv.v.currentTripId = null;
    sv.v.pickupLocation = null;
    sv.v.destination = null;
    sv.v.tripStartTime = null;
    sv.v.estimatedTripEnd = null;
    sv.bookingId = null;
    const d = sv.v.driverId ? this.drivers.get(sv.v.driverId) : null;
    if (d) {
      d.tripsToday += 1;
      d.earningsToday += Math.round(trip.fare * 0.78);
    }
    this.events.emit('trip.completed', { trip: { ...trip } });

    const energy = sv.v.batteryPercentage ?? sv.v.fuelPercentage ?? 100;
    const lowEnergy = energy < (sv.v.batteryPercentage != null ? 35 : 22);
    if (lowEnergy || this.rand() < 0.3) {
      this.sendToBase(sv, now, true, lowEnergy ? 'Low charge — returning to base' : 'Trip complete — returning to base');
    } else {
      sv.phase = 'IDLE_FIELD';
      sv.idleSince = now;
      sv.nodeId = this.graph.nearest(sv.x, sv.z, (id) => id === 'BASE_GATE').id;
      this.setStatus(sv, 'AVAILABLE', `Dropped off at ${trip.destination.name}`);
    }
  }

  private sendToBase(sv: SimVehicle, now: number, emit: boolean, reason = 'Returning to base') {
    const bay = this.pickFreeBay(sv.v.fuelKind === 'ELECTRIC');
    this.bays.get(bay.bayId)!.reservedFor = sv.v.vehicleId;
    sv.reservedBay = bay.bayId;
    const pts = [...this.routeFromCurrent(sv, 'BASE_GATE'), ...this.lotEntryPoints(bay)];
    sv.phase = 'RETURNING';
    this.setMotion(
      sv,
      pts,
      () => {
        const t = this.clock.now();
        this.placeInBay(sv, bay, t, true);
        this.setStatus(sv, 'AVAILABLE', `Parked in bay ${bay.bayId}`);
      },
      now,
    );
    if (emit) this.setStatus(sv, 'RETURNING_TO_BASE', reason);
    else sv.v.status = 'RETURNING_TO_BASE';
  }

  private releaseReservation(sv: SimVehicle) {
    if (!sv.reservedBay) return;
    const st = this.bays.get(sv.reservedBay);
    if (st && st.reservedFor === sv.v.vehicleId) st.reservedFor = null;
    sv.reservedBay = null;
  }

  private tripOf(sv: SimVehicle): Trip | undefined {
    return sv.v.currentTripId ? this.trips.get(sv.v.currentTripId) : undefined;
  }

  // ───────────────────────────────────────────── demand + dispatch

  private generateDemand(now: number, windowSec: number) {
    const hourFactor = 1;
    for (const z of this.zones) {
      const w = this.demandWeight[z.zoneId];
      if (!w) continue;
      const surge = this.zoneSurge(z.zoneId, now);
      const lambda = (w / this.demandTotal) * REQUESTS_PER_MIN * surge * hourFactor * (windowSec / 60);
      let n = poisson(lambda, this.rand);
      while (n-- > 0) {
        const node = this.randomNodeInZone(z);
        const dest = this.destinationNode(node.id);
        const b = this.makeBooking(this.placeAtNode(node.id), this.placeAtNode(dest.id), now, this.rand() < 0.7 ? 'APP' : 'CALL_CENTER');
        this.bookings.set(b.bookingId, b);
        this.zoneRequestLog.push({ zoneId: z.zoneId, at: now });
        this.events.emit('booking.created', { booking: { ...b } });
      }
    }
    this.zoneRequestLog = this.zoneRequestLog.filter((r) => now - r.at < HOUR);
  }

  private zoneSurge(zoneId: string, now: number): number {
    const ph = this.zoneSurgePhase.get(zoneId) ?? 0;
    return 0.55 + 0.75 * (0.5 + 0.5 * Math.sin(now / (23 * MIN) + ph)) + 0.25 * Math.sin(now / (7 * MIN) + ph * 2);
  }

  private autoDispatch(now: number) {
    const pending = [...this.bookings.values()].filter((b) => b.status === 'PENDING').sort((a, b) => a.createdAt - b.createdAt);
    for (const b of pending) {
      // Simulates a short "searching for driver" window before assignment.
      if (now - b.createdAt < 8_000) continue;
      const cands = this.rankCandidates(b.pickup, b.vehicleTypePreference, now);
      if (cands.length) {
        this.assign(this.fleet.get(cands[0].vehicleId)!, b, now);
      } else if (now - b.createdAt > 9 * MIN) {
        b.status = 'UNSERVED';
        this.events.emit('booking.updated', { booking: { ...b } });
      }
    }
  }

  private isDispatchable(sv: SimVehicle): boolean {
    const d = sv.v.driverId ? this.drivers.get(sv.v.driverId) : null;
    if (!d || d.shiftState !== 'ON_SHIFT') return false;
    const energy = sv.v.batteryPercentage ?? sv.v.fuelPercentage ?? 100;
    if (energy < (sv.v.batteryPercentage != null ? 25 : 12)) return false;
    if (sv.v.status === 'AVAILABLE' && (sv.phase === 'PARKED' || sv.phase === 'IDLE_FIELD' || sv.phase === 'TO_STAND')) return true;
    if (sv.v.status === 'RETURNING_TO_BASE' && sv.motion) {
      // Only while still on the road network far from base.
      const ahead = sv.motion.pts.slice(segmentIndex(sv.motion, sv.motion.s) + 1);
      const onRoad = ahead.some((p) => p.nodeId && p.nodeId !== 'BASE_GATE');
      const gate = this.graph.nodes.get('BASE_GATE')!;
      return onRoad && Math.hypot(sv.x - gate.x, sv.z - gate.z) > 400;
    }
    return false;
  }

  rankCandidates(pickup: NamedPlace, pref: Vehicle['vehicleType'] | null | undefined, now: number): DispatchCandidate[] {
    const p = toScene(pickup.lat, pickup.lng);
    const out: DispatchCandidate[] = [];
    for (const sv of this.fleet.values()) {
      if (!this.isDispatchable(sv)) continue;
      if (pref && sv.v.vehicleType !== pref) continue;
      const straight = Math.hypot(sv.x - p.x, sv.z - p.z);
      const roadM = straight * 1.32;
      const exitPenaltySec = sv.v.parkingBay ? 70 : 0;
      const etaMin = (roadM / 8.6 + exitPenaltySec) / 60;
      const reasons = [`${(roadM / 1000).toFixed(1)} km away · ETA ${Math.max(1, Math.round(etaMin))} min`];
      let score = etaMin;
      const parkedFor = sv.v.parkingEntryTime ? now - sv.v.parkingEntryTime : 0;
      const idleFor = sv.phase === 'IDLE_FIELD' ? now - sv.idleSince : parkedFor;
      if (idleFor > 20 * MIN) {
        const bonus = Math.min(3, (idleFor / MIN) * 0.025);
        score -= bonus;
        reasons.push(`Idle ${Math.round(idleFor / MIN)} min — fairness boost`);
      }
      if (sv.v.status === 'RETURNING_TO_BASE') {
        score += 0.5;
        reasons.push('Returning to base — can be re-tasked');
      }
      const energy = sv.v.batteryPercentage ?? sv.v.fuelPercentage;
      if (energy != null) {
        if (energy < 40) {
          score += 1.5;
          reasons.push(`${sv.v.batteryPercentage != null ? 'Battery' : 'Fuel'} ${Math.round(energy)}% — penalised`);
        } else reasons.push(`${sv.v.batteryPercentage != null ? 'Battery' : 'Fuel'} ${Math.round(energy)}%`);
      }
      const d = this.drivers.get(sv.v.driverId!);
      if (d && d.rating >= 4.8) {
        score -= 0.3;
        reasons.push(`Driver rating ${d.rating.toFixed(2)}`);
      }
      out.push({ vehicleId: sv.v.vehicleId, etaMinutes: Math.max(1, Math.round(etaMin)), distanceKm: Math.round(roadM / 100) / 10, score: Math.round(score * 100) / 100, reasons });
    }
    return out.sort((a, b) => a.score - b.score);
  }

  private assign(sv: SimVehicle, booking: Booking, now: number): Trip {
    const trip = this.makeTrip(sv, booking, now);
    booking.status = 'DISPATCHED';
    booking.tripId = trip.tripId;
    sv.bookingId = booking.bookingId;
    if (sv.reservedBay && sv.v.status === 'RETURNING_TO_BASE') this.releaseReservation(sv);
    if (sv.motion && sv.v.status === 'RETURNING_TO_BASE') {
      // Re-task: re-route straight to pickup.
      this.driveToPickup(sv, trip, now, false);
      sv.v.status = 'ASSIGNED';
      this.setStatus(sv, 'EN_ROUTE_PICKUP', `Re-tasked to ${booking.pickup.name}`);
    } else {
      sv.phase = 'ACCEPTING';
      sv.phaseUntil = now + (5 + this.rand() * 9) * 1000;
      this.setStatus(sv, 'ASSIGNED', `Booking ${booking.bookingId} at ${booking.pickup.name}`);
    }
    this.events.emit('booking.updated', { booking: { ...booking } });
    this.events.emit('trip.created', { trip: { ...trip }, booking: { ...booking } });
    this.events.emit('driver.assigned', { driverId: sv.v.driverId!, vehicleId: sv.v.vehicleId, tripId: trip.tripId });
    this.resolveZoneAlert(booking.pickup.zoneId ?? null);
    return trip;
  }

  private makeTrip(sv: SimVehicle, booking: Booking, now: number): Trip {
    const tripId = this.id('TRP');
    const trip: Trip = {
      tripId,
      bookingId: booking.bookingId,
      vehicleId: sv.v.vehicleId,
      driverId: sv.v.driverId!,
      status: 'ASSIGNED',
      pickup: booking.pickup,
      destination: booking.destination,
      assignedAt: now,
      pickupArrivalAt: null,
      startedAt: null,
      completedAt: null,
      estimatedEnd: null,
      distanceKm: 0,
      fare: booking.estimatedFare,
      customerName: booking.customerName,
      route: [],
    };
    this.trips.set(tripId, trip);
    sv.v.currentTripId = tripId;
    sv.v.pickupLocation = booking.pickup;
    sv.v.destination = booking.destination;
    return trip;
  }

  private makeBooking(pickup: NamedPlace, destination: NamedPlace, at: number, channel: Booking['channel']): Booking {
    const km = (Math.hypot(...diff(pickup, destination)) * 1.3) / 1000;
    return {
      bookingId: this.id('BKG'),
      createdAt: at,
      customerName: CUSTOMER_NAMES[Math.floor(this.rand() * CUSTOMER_NAMES.length)],
      customerPhone: `+91 9${Math.floor(100000000 + this.rand() * 899999999)}`,
      channel,
      pickup,
      destination,
      status: 'PENDING',
      vehicleTypePreference: this.rand() < 0.1 ? 'SUV' : null,
      tripId: null,
      estimatedFare: this.fareFor(km, 0, 'SEDAN'),
    };
  }

  private fareFor(km: number, waitMin: number, type: Vehicle['vehicleType']): number {
    const mult = type === 'SUV' ? 1.4 : type === 'HATCHBACK' ? 0.9 : 1;
    return Math.round((60 + km * 17 + Math.max(0, waitMin - 3) * 2) * mult);
  }

  // ───────────────────────────────────────────── energy, idle, drivers

  private drainEnergy(sv: SimVehicle, meters: number) {
    if (sv.v.batteryPercentage != null) sv.v.batteryPercentage = Math.max(3, sv.v.batteryPercentage - meters * 0.00042);
    if (sv.v.fuelPercentage != null) sv.v.fuelPercentage = Math.max(3, sv.v.fuelPercentage - meters * 0.00022);
  }

  private updateEnergyAndIdle(sv: SimVehicle, dt: number, now: number) {
    if (sv.v.parkingBay) {
      sv.v.parkingDuration = sv.v.parkingEntryTime ? now - sv.v.parkingEntryTime : null;
      const bay = this.bays.get(sv.v.parkingBay)!.bay;
      if (sv.v.batteryPercentage != null) {
        const rate = bay.kind === 'EV_CHARGING' ? 0.6 : 0.08; // % per minute
        sv.v.batteryPercentage = Math.min(100, sv.v.batteryPercentage + (rate * dt) / 60);
      }
      if (sv.v.fuelPercentage != null && sv.v.fuelPercentage < 30 && sv.v.status === 'AVAILABLE') sv.v.fuelPercentage = Math.min(95, sv.v.fuelPercentage + (2 * dt) / 60);
    }
    if (sv.v.status === 'AVAILABLE' && !sv.motion) {
      const d = sv.v.driverId ? this.drivers.get(sv.v.driverId) : null;
      if (d?.shiftState === 'ON_SHIFT') sv.v.idleTimeToday += dt * 1000;
    }
  }

  private updateDrivers(now: number) {
    for (const sv of this.fleet.values()) {
      const d = sv.v.driverId ? this.drivers.get(sv.v.driverId) : null;
      if (!d) continue;
      if (d.shiftState === 'ON_SHIFT') d.hoursOnlineToday += 3 / 3600;
      // Drivers on break come back after a while.
      if (d.shiftState === 'ON_BREAK' && sv.v.parkingEntryTime && now - sv.v.parkingEntryTime > 80 * MIN && this.rand() < 0.015) {
        d.shiftState = 'ON_SHIFT';
        this.events.emit('vehicle.updated', { vehicle: this.snapshot(sv) });
      }
    }
  }

  private maybeEmitGps(sv: SimVehicle, now: number) {
    if (sv.phase === 'OFFLINE' || now < sv.nextGpsAt) return;
    const moving = !!sv.motion;
    sv.nextGpsAt = now + (moving ? 2000 : 8000) * (0.9 + this.rand() * 0.2);
    if (now < sv.gpsMutedUntil) return;
    const noise = moving ? 0.8 : 0;
    const ll = fromScene(sv.x + (this.rand() - 0.5) * noise, sv.z + (this.rand() - 0.5) * noise);
    const fix: GPSFix = {
      vehicleId: sv.v.vehicleId,
      latitude: ll.lat,
      longitude: ll.lng,
      speed: sv.v.speed,
      heading: Math.round(sv.v.heading * 10) / 10,
      accuracy: 3 + Math.round(this.rand() * 4),
      timestamp: now,
      source: 'MOCK',
    };
    sv.v.lastGpsUpdate = now;
    sv.v.zoneId = this.zoneAt(sv.x, sv.z);
    sv.history.push(fix);
    if (sv.history.length > 400) sv.history.splice(0, sv.history.length - 400);
    this.gpsFeed.emit('fix', fix);
    this.events.emit('vehicle.location.updated', fix);
  }

  /** Random operational noise: GPS dropouts, speeding, drivers taking breaks. */
  private chaos(now: number) {
    const moving = [...this.fleet.values()].filter((s) => s.motion && s.phase !== 'RETURNING');
    if (moving.length && this.rand() < 0.55) {
      const sv = moving[Math.floor(this.rand() * moving.length)];
      sv.gpsMutedUntil = now + (75 + this.rand() * 90) * 1000;
    }
    if (moving.length && this.rand() < 0.25) {
      const sv = moving[Math.floor(this.rand() * moving.length)];
      sv.speedingUntil = now + 40_000;
    }
    const parkedOnShift = [...this.fleet.values()].filter((s) => s.phase === 'PARKED' && s.v.status === 'AVAILABLE' && this.drivers.get(s.v.driverId!)?.shiftState === 'ON_SHIFT');
    if (parkedOnShift.length > 4 && this.rand() < 0.07) {
      const sv = parkedOnShift[Math.floor(this.rand() * parkedOnShift.length)];
      this.drivers.get(sv.v.driverId!)!.shiftState = 'ON_BREAK';
      this.events.emit('vehicle.updated', { vehicle: this.snapshot(sv) });
    }
    // Airport flight arrival: burst of demand.
    if (this.rand() < 0.03) {
      const airport = this.zones.find((z) => z.zoneId === 'Z-airport')!;
      const n = 3 + Math.floor(this.rand() * 3);
      for (let i = 0; i < n; i++) {
        const node = this.randomNodeInZone(airport);
        const b = this.makeBooking(this.placeAtNode(node.id), this.placeAtNode(this.destinationNode(node.id).id), now, 'APP');
        this.bookings.set(b.bookingId, b);
        this.zoneRequestLog.push({ zoneId: airport.zoneId, at: now });
        this.events.emit('booking.created', { booking: { ...b } });
      }
    }
  }

  // ───────────────────────────────────────────── alerts

  private evaluateAlerts(now: number) {
    for (const sv of this.fleet.values()) {
      const v = sv.v;
      const id = v.vehicleId;
      if (v.status === 'OFFLINE') {
        this.raise('VEHICLE_OFFLINE', 'WARNING', id, null, `${label(id)} is offline — no telemetry for ${Math.round((now - v.lastGpsUpdate) / MIN)} min`);
        continue;
      }
      const parkedMin = v.parkingEntryTime ? (now - v.parkingEntryTime) / MIN : 0;
      if (v.parkingBay && v.status === 'AVAILABLE') {
        if (parkedMin >= 120) this.raise('EXCESSIVE_IDLE', 'CRITICAL', id, null, `${label(id)} critical idle — parked ${fmtMin(parkedMin)} in bay ${v.parkingBay}`, 'crit');
        else if (parkedMin >= 60) this.raise('EXCESSIVE_IDLE', 'WARNING', id, null, `${label(id)} parked over 1 hr in bay ${v.parkingBay}`);
      }
      const gpsAge = now - v.lastGpsUpdate;
      if (gpsAge > 60_000) this.raise('GPS_STALE', 'WARNING', id, null, `${label(id)} — no GPS fix for ${Math.round(gpsAge / 1000)} sec`);
      else this.resolveAlertsFor(id, ['GPS_STALE']);
      if (v.batteryPercentage != null && v.batteryPercentage < 20) this.raise('LOW_BATTERY', 'WARNING', id, null, `${label(id)} battery at ${Math.round(v.batteryPercentage)}%`);
      else this.resolveAlertsFor(id, ['LOW_BATTERY']);
      if (v.fuelPercentage != null && v.fuelPercentage < 15) this.raise('LOW_FUEL', 'WARNING', id, null, `${label(id)} fuel at ${Math.round(v.fuelPercentage)}%`);
      if (v.maintenanceStatus === 'DUE_SOON' || v.maintenanceStatus === 'OVERDUE') this.raise('MAINTENANCE_DUE', 'INFO', id, null, `${label(id)} service ${v.maintenanceStatus === 'OVERDUE' ? 'overdue' : 'due soon'} (${Math.round(v.odometerKm).toLocaleString('en-IN')} km)`);
      if (v.speed > 70) this.raise('OVERSPEED', 'CRITICAL', id, null, `${label(id)} overspeeding at ${v.speed} km/h`);
      else this.resolveAlertsFor(id, ['OVERSPEED']);
      if (sv.phase === 'WAITING') {
        const trip = this.tripOf(sv);
        const waited = trip?.pickupArrivalAt ? (now - trip.pickupArrivalAt) / MIN : 0;
        if (waited > 6) this.raise('LONG_WAIT_AT_PICKUP', 'WARNING', id, null, `${label(id)} waiting ${Math.round(waited)} min at ${trip?.pickup.name}`);
      }
    }
    // Unserved demand per zone.
    for (const z of this.zones) {
      const stuck = [...this.bookings.values()].filter((b) => b.status === 'PENDING' && b.pickup.zoneId === z.zoneId && now - b.createdAt > 3 * MIN);
      if (stuck.length) this.raise('UNSERVED_DEMAND', stuck.length > 2 ? 'CRITICAL' : 'WARNING', null, z.zoneId, `${stuck.length} ride request${stuck.length > 1 ? 's' : ''} waiting > 3 min at ${z.name}`);
    }
  }

  private raise(type: AlertType, severity: AlertSeverity, vehicleId: string | null, zoneId: string | null, message: string, variant = '') {
    const key = `${type}:${vehicleId ?? zoneId}${variant}`;
    if (this.activeAlertKeys.has(key)) return;
    const alert: Alert = { alertId: this.id('ALR'), type, severity, vehicleId, zoneId, message, createdAt: this.clock.now(), acknowledged: false, resolvedAt: null };
    this.alerts.unshift(alert);
    if (this.alerts.length > 300) this.alerts.length = 300;
    this.activeAlertKeys.set(key, alert.alertId);
    this.events.emit('alert.created', { alert: { ...alert } });
  }

  private resolveAlertsFor(vehicleId: string, types: AlertType[]) {
    for (const [key, alertId] of this.activeAlertKeys) {
      const [type, rest] = key.split(':');
      if (!types.includes(type as AlertType) || !rest.startsWith(vehicleId)) continue;
      this.activeAlertKeys.delete(key);
      const a = this.alerts.find((x) => x.alertId === alertId);
      if (a && !a.resolvedAt) {
        a.resolvedAt = this.clock.now();
        this.events.emit('alert.resolved', { alert: { ...a } });
      }
    }
  }

  private resolveZoneAlert(zoneId: string | null) {
    if (!zoneId) return;
    const key = `UNSERVED_DEMAND:${zoneId}`;
    const alertId = this.activeAlertKeys.get(key);
    if (!alertId) return;
    const still = [...this.bookings.values()].some((b) => b.status === 'PENDING' && b.pickup.zoneId === zoneId);
    if (still) return;
    this.activeAlertKeys.delete(key);
    const a = this.alerts.find((x) => x.alertId === alertId);
    if (a) {
      a.resolvedAt = this.clock.now();
      this.events.emit('alert.resolved', { alert: { ...a } });
    }
  }

  // ───────────────────────────────────────────── places

  private zoneAt(x: number, z: number): string | null {
    let best: string | null = null;
    let bd = Infinity;
    for (const zone of this.zones) {
      const c = toScene(zone.center.lat, zone.center.lng);
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < zone.radiusM && d < bd) (bd = d), (best = zone.zoneId);
    }
    return best;
  }

  private nearestZone(x: number, z: number): Zone {
    let best = this.zones[0];
    let bd = Infinity;
    for (const zone of this.zones) {
      const c = toScene(zone.center.lat, zone.center.lng);
      const d = Math.hypot(c.x - x, c.z - z) - zone.radiusM;
      if (d < bd) (bd = d), (best = zone);
    }
    return best;
  }

  private zoneCenter(zoneId: string) {
    const z = this.zones.find((x) => x.zoneId === zoneId) ?? this.zones[0];
    return toScene(z.center.lat, z.center.lng);
  }

  private randomNodeInZone(zone: Zone) {
    const c = toScene(zone.center.lat, zone.center.lng);
    const nodes = this.graph.nodesWithin(c.x, c.z, zone.radiusM);
    return nodes.length ? nodes[Math.floor(this.rand() * nodes.length)] : this.graph.nearest(c.x, c.z);
  }

  private demandNode() {
    const zs = this.zones.filter((z) => this.demandWeight[z.zoneId]);
    let r = this.rand() * this.demandTotal;
    for (const z of zs) {
      r -= this.demandWeight[z.zoneId];
      if (r <= 0) return this.randomNodeInZone(z);
    }
    return this.randomNodeInZone(zs[0]);
  }

  private destinationNode(fromId: string) {
    const from = this.graph.nodes.get(fromId)!;
    // Occasional outstation ride to a neighbouring town (Nagrota, Akhnoor, R.S. Pura, …).
    if (this.rand() < OUTSTATION_SHARE) {
      const towns = this.zones.filter((z) => z.radiusM >= 1200 && Math.hypot(...diffXZ(this.zoneCenter(z.zoneId), from)) > 6000);
      if (towns.length) return this.randomNodeInZone(towns[Math.floor(this.rand() * towns.length)]);
    }
    for (let i = 0; i < 20; i++) {
      const n = this.rand() < 0.65 ? this.demandNode() : this.randomFieldNode(0);
      const d = Math.hypot(n.x - from.x, n.z - from.z);
      if (d > 1000 && d < 4500) return n;
    }
    return this.randomFieldNode(900, from);
  }

  private randomFieldNode(minFromBase: number, near?: { x: number; z: number }, maxDist = Infinity) {
    const gate = this.graph.nodes.get('BASE_GATE')!;
    const list = this.cityNodes.filter((n) => {
      if (Math.hypot(n.x - gate.x, n.z - gate.z) < minFromBase) return false;
      if (near && Math.hypot(n.x - near.x, n.z - near.z) > maxDist) return false;
      if (near && Math.hypot(n.x - near.x, n.z - near.z) < 500) return false;
      return true;
    });
    const pool = list.length ? list : this.cityNodes;
    return pool[Math.floor(this.rand() * pool.length)];
  }

  private placeAtNode(nodeId: string): NamedPlace {
    const n = this.graph.nodes.get(nodeId)!;
    const zoneId = this.zoneAt(n.x, n.z);
    const zone = this.zones.find((z) => z.zoneId === zoneId);
    const named = this.graph.adj.get(nodeId)?.find((e) => e.name);
    const name = zone ? zone.name : named ? named.name : `Near ${this.nearestZone(n.x, n.z).name}`;
    return { ...fromScene(n.x, n.z), name, zoneId: zoneId ?? undefined };
  }

  private randomPlace(): NamedPlace {
    return this.placeAtNode(this.demandNode().id);
  }

  private id(prefix: string) {
    return `${prefix}-${(this.seq++).toString(36).toUpperCase()}`;
  }

  // ───────────────────────────────────────────── public query API (used by mock router)

  private snapshot(sv: SimVehicle): Vehicle {
    const v = { ...sv.v };
    v.parkingDuration = v.parkingEntryTime ? this.clock.now() - v.parkingEntryTime : null;
    v.distanceToday = Math.round(v.distanceToday * 10) / 10;
    if (v.batteryPercentage != null) v.batteryPercentage = Math.round(v.batteryPercentage);
    if (v.fuelPercentage != null) v.fuelPercentage = Math.round(v.fuelPercentage);
    return v;
  }

  getVehicles(): Vehicle[] {
    return [...this.fleet.values()].map((sv) => this.snapshot(sv));
  }

  getVehicle(id: string): Vehicle | undefined {
    const sv = this.fleet.get(id);
    return sv && this.snapshot(sv);
  }

  getDrivers(): Driver[] {
    return [...this.drivers.values()].map((d) => ({ ...d, hoursOnlineToday: Math.round(d.hoursOnlineToday * 10) / 10 }));
  }

  getDriver(id: string): Driver | undefined {
    const d = this.drivers.get(id);
    return d && { ...d };
  }

  getTrips(filter: { vehicleId?: string; status?: string } = {}): Trip[] {
    return [...this.trips.values()]
      .filter((t) => (!filter.vehicleId || t.vehicleId === filter.vehicleId) && (!filter.status || t.status === filter.status))
      .sort((a, b) => b.assignedAt - a.assignedAt)
      .map((t) => ({ ...t }));
  }

  getTrip(id: string): Trip | undefined {
    const t = this.trips.get(id);
    return t && { ...t };
  }

  getBookings(): Booking[] {
    const now = this.clock.now();
    return [...this.bookings.values()]
      .filter((b) => b.status === 'PENDING' || now - b.createdAt < 2 * HOUR)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 200)
      .map((b) => ({ ...b }));
  }

  getParking(): ParkingBayState[] {
    return [...this.bays.values()].map((b) => ({ ...b }));
  }

  getLocationHistory(vehicleId: string): GPSFix[] {
    return [...(this.fleet.get(vehicleId)?.history ?? [])];
  }

  getLatestFixes(): GPSFix[] {
    return [...this.fleet.values()].map((sv) => ({
      vehicleId: sv.v.vehicleId,
      latitude: sv.v.latitude,
      longitude: sv.v.longitude,
      speed: sv.v.speed,
      heading: sv.v.heading,
      accuracy: 5,
      timestamp: sv.v.lastGpsUpdate,
      source: 'MOCK' as const,
    }));
  }

  getAlerts(): Alert[] {
    return this.alerts.map((a) => ({ ...a }));
  }

  ackAlert(id: string): Alert | undefined {
    const a = this.alerts.find((x) => x.alertId === id);
    if (a) a.acknowledged = true;
    return a && { ...a };
  }

  getFleetStatus(): FleetStatusSummary {
    const now = this.clock.now();
    const byStatus = Object.fromEntries(
      ['AVAILABLE', 'ASSIGNED', 'EN_ROUTE_PICKUP', 'WAITING', 'ON_TRIP', 'RETURNING_TO_BASE', 'MAINTENANCE', 'OFFLINE'].map((s) => [s, 0]),
    ) as Record<VehicleStatus, number>;
    let parkedOverOneHour = 0;
    let atBase = 0;
    for (const sv of this.fleet.values()) {
      byStatus[sv.v.status]++;
      if (sv.v.parkingBay) atBase++;
      if (sv.v.status === 'AVAILABLE' && sv.v.parkingEntryTime && now - sv.v.parkingEntryTime > HOUR) parkedOverOneHour++;
    }
    return {
      serverTime: now,
      totalFleet: this.fleet.size,
      byStatus,
      onTrip: byStatus.ON_TRIP,
      available: byStatus.AVAILABLE,
      parkedOverOneHour,
      maintenance: byStatus.MAINTENANCE,
      offline: byStatus.OFFLINE,
      atBase,
    };
  }

  getZoneDemand(): ZoneDemand[] {
    const now = this.clock.now();
    return this.zones
      .filter((z) => this.demandWeight[z.zoneId])
      .map((z) => {
        const pending = [...this.bookings.values()].filter((b) => b.status === 'PENDING' && b.pickup.zoneId === z.zoneId).length;
        const lastHour = this.zoneRequestLog.filter((r) => r.zoneId === z.zoneId && now - r.at < HOUR).length;
        const forecast = (this.demandWeight[z.zoneId] / this.demandTotal) * REQUESTS_PER_MIN * 30 * this.zoneSurge(z.zoneId, now + 15 * MIN);
        return { zoneId: z.zoneId, pendingRequests: pending, requestsLastHour: lastHour, forecastNext30: Math.round(forecast * 10) / 10 };
      });
  }

  getAnalytics(): FleetAnalytics {
    const vehicles = this.getVehicles();
    const revenueToday = vehicles.reduce((s, v) => s + v.revenueToday, 0);
    const tripsToday = vehicles.reduce((s, v) => s + v.tripsToday, 0);
    const distanceToday = vehicles.reduce((s, v) => s + v.distanceToday, 0);
    const busy = vehicles.filter((v) => ['ASSIGNED', 'EN_ROUTE_PICKUP', 'WAITING', 'ON_TRIP'].includes(v.status)).length;
    const operable = vehicles.filter((v) => v.status !== 'MAINTENANCE' && v.status !== 'OFFLINE').length;
    const zones = this.getZoneDemand().map((d) => {
      const zone = this.zones.find((z) => z.zoneId === d.zoneId)!;
      const c = toScene(zone.center.lat, zone.center.lng);
      const supply = [...this.fleet.values()].filter(
        (sv) => this.isDispatchable(sv) && sv.v.status === 'AVAILABLE' && Math.hypot(sv.x - c.x, sv.z - c.z) < zone.radiusM + 500,
      ).length;
      return { ...d, supply, gap: Math.max(0, Math.round(d.pendingRequests + d.forecastNext30 / 3 - supply)) };
    });
    return {
      serverTime: this.clock.now(),
      revenueToday,
      tripsToday,
      distanceToday: Math.round(distanceToday),
      avgRevenuePerVehicle: Math.round(revenueToday / Math.max(1, vehicles.length)),
      utilizationPct: Math.round((busy / Math.max(1, operable)) * 100),
      zones,
    };
  }

  // ───────────────────────────────────────────── commands

  dispatch(req: DispatchRequest): DispatchResult {
    const now = this.clock.now();
    let booking = req.bookingId ? this.bookings.get(req.bookingId) : undefined;
    if (!booking) {
      const pickupNode = this.graph.nearest(...xz(req.pickup), (id) => id === 'BASE_GATE');
      const destNode = this.graph.nearest(...xz(req.destination), (id) => id === 'BASE_GATE');
      const pickup = { ...this.placeAtNode(pickupNode.id), name: req.pickup.name || this.placeAtNode(pickupNode.id).name };
      const destination = { ...this.placeAtNode(destNode.id), name: req.destination.name || this.placeAtNode(destNode.id).name };
      booking = this.makeBooking(pickup, destination, now, 'CALL_CENTER');
      if (req.customerName) booking.customerName = req.customerName;
      booking.vehicleTypePreference = req.vehicleTypePreference ?? null;
      if (!req.dryRun) {
        this.bookings.set(booking.bookingId, booking);
        this.events.emit('booking.created', { booking: { ...booking } });
      }
    }
    const candidates = this.rankCandidates(booking.pickup, booking.vehicleTypePreference, now).slice(0, 6);
    if (booking.status !== 'PENDING' && !req.dryRun) {
      // Already dispatched (e.g. by auto-dispatch) — never double-assign.
      return { booking: { ...booking }, recommended: null, candidates, trip: null, assigned: false };
    }
    let recommended: DispatchCandidate | null = candidates[0] ?? null;
    if (req.vehicleId) {
      const forced = this.fleet.get(req.vehicleId);
      if (!forced || !this.isDispatchable(forced)) {
        return { booking: { ...booking }, recommended, candidates, trip: null, assigned: false };
      }
      recommended = candidates.find((c) => c.vehicleId === req.vehicleId) ?? this.rankCandidates(booking.pickup, null, now).find((c) => c.vehicleId === req.vehicleId) ?? null;
    }
    if (req.dryRun || !recommended) {
      return { booking: { ...booking }, recommended, candidates, trip: null, assigned: false };
    }
    const trip = this.assign(this.fleet.get(recommended.vehicleId)!, booking, now);
    return { booking: { ...booking }, recommended, candidates, trip: { ...trip }, assigned: true };
  }

  setVehicleStatus(update: VehicleStatusUpdate): Vehicle {
    const sv = this.fleet.get(update.vehicleId);
    if (!sv) throw Object.assign(new Error('Vehicle not found'), { status: 404 });
    const now = this.clock.now();
    const idle = sv.v.status === 'AVAILABLE' || sv.v.status === 'MAINTENANCE' || sv.v.status === 'OFFLINE';
    if (!idle || sv.motion) throw Object.assign(new Error(`Cannot change status while vehicle is ${sv.v.status}`), { status: 409 });
    const d = sv.v.driverId ? this.drivers.get(sv.v.driverId) : null;
    if (update.status === 'AVAILABLE') {
      sv.phase = sv.v.parkingBay ? 'PARKED' : 'IDLE_FIELD';
      sv.idleSince = now;
      if (sv.v.maintenanceStatus === 'IN_SERVICE') sv.v.maintenanceStatus = 'OK';
      if (d) d.shiftState = 'ON_SHIFT';
      sv.v.lastGpsUpdate = now;
      this.resolveAlertsFor(sv.v.vehicleId, ['VEHICLE_OFFLINE', 'MAINTENANCE_DUE']);
      if (sv.v.parkingBay && this.bays.get(sv.v.parkingBay)!.bay.kind === 'SERVICE') {
        // Leaving the workshop: move to a regular bay.
        const from = this.bays.get(sv.v.parkingBay)!.bay;
        this.leaveBay(sv, now);
        const to = this.pickFreeBay(sv.v.fuelKind === 'ELECTRIC');
        this.bays.get(to.bayId)!.reservedFor = sv.v.vehicleId;
        sv.reservedBay = to.bayId;
        const exit = this.lotExitPoints(from).slice(0, 3);
        const entry = this.lotEntryPoints(to).slice(1);
        sv.phase = 'RETURNING';
        this.setMotion(sv, [...exit, ...entry], () => {
          this.placeInBay(sv, to, this.clock.now(), true);
          sv.phase = 'PARKED';
        }, now);
      }
    } else if (update.status === 'MAINTENANCE') {
      sv.phase = 'MAINT';
      sv.v.maintenanceStatus = 'IN_SERVICE';
      if (d) d.shiftState = 'OFF_SHIFT';
    } else if (update.status === 'OFFLINE') {
      sv.phase = 'OFFLINE';
      if (d) d.shiftState = 'OFF_SHIFT';
    } else {
      throw Object.assign(new Error(`Status ${update.status} is set by the dispatch lifecycle`), { status: 422 });
    }
    this.setStatus(sv, update.status, update.reason ?? 'Operator override');
    return this.snapshot(sv);
  }
}

// ───────────────────────────────────────────── helpers

function segmentIndex(m: Motion, s: number): number {
  let i = m.cum[m.seg] <= s ? m.seg : 0;
  while (i < m.cum.length - 2 && m.cum[i + 1] <= s) i++;
  m.seg = i;
  return i;
}

function turnAngle(a: PathPoint, b: PathPoint, c: PathPoint): number {
  const h1 = Math.atan2(b.x - a.x, b.z - a.z);
  const h2 = Math.atan2(c.x - b.x, c.z - b.z);
  let d = Math.abs(h2 - h1);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return (d * 180) / Math.PI;
}

function pathLength(pts: PathPoint[]) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return s;
}

function trimEnd(pts: PathPoint[], d: number) {
  while (pts.length >= 2 && d > 0) {
    const a = pts[pts.length - 2];
    const b = pts[pts.length - 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len > d + 1) {
      const t = (len - d) / len;
      pts[pts.length - 1] = { ...b, x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      return;
    }
    if (pts.length <= 2) return;
    pts.pop();
    d -= len;
  }
}

/** Offsets a polyline to the left of travel (India drives on the left). */
function offsetLeft(pts: PathPoint[], off: number): PathPoint[] {
  if (pts.length < 2) return pts;
  const normals: { x: number; z: number }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    const dz = pts[i + 1].z - pts[i].z;
    const l = Math.hypot(dx, dz) || 1;
    normals.push({ x: dz / l, z: -dx / l });
  }
  return pts.map((p, i) => {
    const n0 = normals[Math.max(0, i - 1)];
    const n1 = normals[Math.min(normals.length - 1, i)];
    let nx = n0.x + n1.x;
    let nz = n0.z + n1.z;
    const l = Math.hypot(nx, nz);
    if (l < 1e-3) return { ...p, x: p.x + n1.x * off, z: p.z + n1.z * off };
    nx /= l;
    nz /= l;
    const cos = Math.max(0.5, nx * n1.x + nz * n1.z);
    return { ...p, x: p.x + (nx * off) / cos, z: p.z + (nz * off) / cos };
  });
}

function poisson(lambda: number, rand: () => number) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > L);
  return k - 1;
}

function xz(p: { lat: number; lng: number }): [number, number] {
  const s = toScene(p.lat, p.lng);
  return [s.x, s.z];
}

function diff(a: { lat: number; lng: number }, b: { lat: number; lng: number }): [number, number] {
  const pa = toScene(a.lat, a.lng);
  const pb = toScene(b.lat, b.lng);
  return [pa.x - pb.x, pa.z - pb.z];
}

function diffXZ(a: { x: number; z: number }, b: { x: number; z: number }): [number, number] {
  return [a.x - b.x, a.z - b.z];
}

function label(vehicleId: string) {
  return vehicleId.replace('-', ' ');
}

function fmtMin(m: number) {
  const h = Math.floor(m / 60);
  return h ? `${h} hr ${Math.round(m % 60)} min` : `${Math.round(m)} min`;
}
