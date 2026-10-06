import { create } from 'zustand';
import type { Alert, Booking, Driver, ParkingBayState, Trip, Vehicle, VehicleStatus } from '../contracts/types';
import type { Services } from '../services';
import type { DispatchActivity } from '../services/dispatchService';

export type Page = 'dashboard' | 'fleet' | 'drivers' | 'insights';
export type SheetState = 'peek' | 'half' | 'full';
export type CameraPreset = 'REGION' | 'CITY' | 'BASE' | 'OVERVIEW';
export type DetailTab = 'OVERVIEW' | 'DRIVER' | 'TRIPS' | 'DISPATCH';
export type FleetFilter = VehicleStatus | 'PARKED_1H' | 'ALL' | 'AT_BASE' | 'BUSY';

export interface CameraRequest {
  id: number;
  kind: 'preset' | 'vehicle' | 'point';
  preset?: CameraPreset;
  vehicleId?: string;
  point?: { x: number; z: number; distance?: number };
}

interface FleetState {
  ready: boolean;
  // data snapshots (fed by services)
  vehicles: Vehicle[];
  vehicleMap: Record<string, Vehicle>;
  drivers: Record<string, Driver>;
  trips: Trip[];
  bookings: Booking[];
  bays: ParkingBayState[];
  alerts: Alert[];
  activity: DispatchActivity[];
  analyticsVersion: number;
  now: number;
  connection: 'connecting' | 'open' | 'closed';
  // ui state
  page: Page;
  paletteOpen: boolean;
  /** Mobile bottom sheet position. */
  sheet: SheetState;
  settingsOpen: boolean;
  feedTab: 'alerts' | 'activity';
  selectedVehicleId: string | null;
  hoveredVehicleId: string | null;
  following: boolean;
  detailTab: DetailTab;
  showRoute: boolean;
  filter: FleetFilter;
  search: string;
  showLabels: boolean;
  showZones: boolean;
  showTrails: boolean;
  dispatchOpen: boolean;
  cameraRequest: CameraRequest | null;
  simSpeed: number;
  callDriverId: string | null;

  select(vehicleId: string | null, opts?: { fly?: boolean; tab?: DetailTab }): void;
  showOnMap(vehicleId: string): void;
  hover(vehicleId: string | null): void;
  setPage(p: Page): void;
  setFilter(f: FleetFilter): void;
  setSearch(s: string): void;
  setDetailTab(t: DetailTab): void;
  toggle(key: 'showRoute' | 'showLabels' | 'showZones' | 'showTrails' | 'following'): void;
  set(p: Partial<FleetState>): void;
  camera(req: Omit<CameraRequest, 'id'>): void;
}

let camSeq = 1;

export const useFleetStore = create<FleetState>((set, get) => ({
  ready: false,
  vehicles: [],
  vehicleMap: {},
  drivers: {},
  trips: [],
  bookings: [],
  bays: [],
  alerts: [],
  activity: [],
  analyticsVersion: 0,
  now: Date.now(),
  connection: 'connecting',
  page: 'dashboard',
  paletteOpen: false,
  sheet: 'peek',
  settingsOpen: false,
  feedTab: 'alerts',
  selectedVehicleId: null,
  hoveredVehicleId: null,
  following: true,
  detailTab: 'OVERVIEW',
  showRoute: true,
  filter: 'ALL',
  search: '',
  showLabels: false,
  showZones: false,
  showTrails: false,
  dispatchOpen: false,
  cameraRequest: null,
  simSpeed: 1,
  callDriverId: null,

  select(vehicleId, opts = {}) {
    set({ selectedVehicleId: vehicleId, detailTab: opts.tab ?? 'OVERVIEW', following: !!vehicleId && get().page === 'dashboard' });
    if (vehicleId && opts.fly !== false && get().page === 'dashboard') get().camera({ kind: 'vehicle', vehicleId });
  },
  /** Jump to the live map and focus a vehicle (used from Fleet / Drivers / Insights). */
  showOnMap(vehicleId) {
    set({ page: 'dashboard', selectedVehicleId: vehicleId, following: true, paletteOpen: false });
    get().camera({ kind: 'vehicle', vehicleId });
  },
  hover: (hoveredVehicleId) => set({ hoveredVehicleId }),
  setPage(page) {
    set({ page, paletteOpen: false });
  },
  setFilter: (filter) => set({ filter }),
  setSearch: (search) => set({ search }),
  setDetailTab: (detailTab) => set({ detailTab }),
  toggle: (key) => set({ [key]: !get()[key] } as Partial<FleetState>),
  set: (p) => set(p),
  camera: (req) => set({ cameraRequest: { ...req, id: camSeq++ } }),
}));

/** Pushes service state into the store, throttled so the UI re-renders at a sane rate. */
export function bindServicesToStore(s: Services): () => void {
  const st = useFleetStore.getState;
  const pending = new Set<string>();
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    const patch: Record<string, unknown> = {};
    if (pending.has('vehicles')) {
      const vehicles = s.vehicleService.getAll().sort((a, b) => a.vehicleId.localeCompare(b.vehicleId));
      patch.vehicles = vehicles;
      patch.vehicleMap = Object.fromEntries(vehicles.map((v) => [v.vehicleId, v]));
    }
    if (pending.has('drivers')) patch.drivers = Object.fromEntries(s.driverService.getAll().map((d) => [d.driverId, d]));
    if (pending.has('bookings')) {
      patch.trips = s.bookingService.getTrips();
      patch.bookings = s.bookingService.getBookings();
    }
    if (pending.has('parking')) patch.bays = s.parkingService.getBays();
    if (pending.has('alerts')) patch.alerts = s.alertService.getAll();
    if (pending.has('activity')) patch.activity = [...s.dispatchService.activity()];
    if (pending.has('analytics')) patch.analyticsVersion = st().analyticsVersion + 1;
    pending.clear();
    useFleetStore.setState(patch);
  };
  const mark = (k: string) => () => {
    pending.add(k);
    if (!scheduled) {
      scheduled = true;
      setTimeout(flush, 250);
    }
  };
  const unsubs = [
    s.vehicleService.onChange(mark('vehicles')),
    s.driverService.onChange(mark('drivers')),
    s.bookingService.onChange(mark('bookings')),
    s.parkingService.onChange(mark('parking')),
    s.alertService.onChange(mark('alerts')),
    s.dispatchService.onChange(mark('activity')),
    s.analyticsService.onChange(mark('analytics')),
    s.realtime.onState((connection) => useFleetStore.setState({ connection })),
  ];
  ['vehicles', 'drivers', 'bookings', 'parking', 'alerts', 'activity', 'analytics'].forEach((k) => pending.add(k));
  flush();
  // 1 Hz clock for timers ("Parked for 18 min", "Last GPS 4 sec ago").
  const tick = setInterval(() => useFleetStore.setState({ now: s.clock.now(), simSpeed: s.simulation?.speed ?? 1 }), 1000);
  useFleetStore.setState({ ready: true, now: s.clock.now(), simSpeed: s.simulation?.speed ?? 1 });
  return () => {
    unsubs.forEach((u) => u());
    clearInterval(tick);
  };
}

/** Applies the fleet list filter (shared by list, HUD and 3D dimming). */
export function matchesFilter(v: Vehicle, filter: FleetFilter, now: number): boolean {
  switch (filter) {
    case 'ALL':
      return true;
    case 'PARKED_1H':
      return v.status === 'AVAILABLE' && !!v.parkingEntryTime && now - v.parkingEntryTime > 3_600_000;
    case 'AT_BASE':
      return !!v.parkingBay;
    case 'BUSY':
      return v.status === 'ASSIGNED' || v.status === 'EN_ROUTE_PICKUP' || v.status === 'WAITING';
    default:
      return v.status === filter;
  }
}
