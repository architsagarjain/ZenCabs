/**
 * Service container. This is the ONLY place that knows whether data is mocked.
 *
 *   MOCK:  SimulationEngine ─┬─ mockRouter ── MockApiClient ─┐
 *                            ├─ events ──── MockRealtimeClient├─▶ services ─▶ store ─▶ UI / 3D
 *                            └─ gpsFeed ─── MockGPSProvider ──┘
 *
 *   LIVE:  ZenCabs backend ─┬─ REST ───── HttpApiClient ─────┐
 *                           ├─ WebSocket ─ WebSocketRealtime ├─▶ services ─▶ store ─▶ UI / 3D
 *                           └─ (relayed) ─ ZenCabsGPSProvider┘
 */
import { DATA_CONFIG, type DataConfig } from '../config/dataConfig';
import { SimClock, WallClock, type Clock } from '../core/clock';
import { CORE_EVENTS, type RealtimeEventName } from '../contracts/events';
import { API } from '../contracts/api';
import type { FleetStatusSummary } from '../contracts/types';
import type { GPSProvider } from '../providers/gps/GPSProvider';
import { ZenCabsGPSProvider } from '../providers/gps/ZenCabsGPSProvider';
import { HttpApiClient, type ApiClient } from '../transport/ApiClient';
import { MockRealtimeClient, WebSocketRealtimeClient, type RealtimeClient } from '../transport/RealtimeClient';
import { AlertService } from './alertService';
import { AnalyticsService } from './analyticsService';
import { BookingService } from './bookingService';
import { DispatchService } from './dispatchService';
import { DriverService } from './driverService';
import { GpsService } from './gpsService';
import { MapService } from './mapService';
import { ParkingService } from './parkingService';
import { VehicleService } from './vehicleService';

export interface SimulationControl {
  setSpeed(speed: number): void;
  readonly speed: number;
}

export interface Services {
  mode: DataConfig['DATA_MODE'];
  clock: Clock;
  api: ApiClient;
  realtime: RealtimeClient;
  gpsProvider: GPSProvider;
  vehicleService: VehicleService;
  driverService: DriverService;
  gpsService: GpsService;
  bookingService: BookingService;
  dispatchService: DispatchService;
  parkingService: ParkingService;
  analyticsService: AnalyticsService;
  alertService: AlertService;
  mapService: MapService;
  /** Only present in MOCK mode. */
  simulation: SimulationControl | null;
}

const EXTRA_EVENTS: RealtimeEventName[] = ['booking.created', 'booking.updated', 'alert.resolved', 'vehicle.updated'];

export async function createServices(config: DataConfig = DATA_CONFIG): Promise<Services> {
  let clock: Clock;
  let api: ApiClient;
  let realtime: RealtimeClient;
  let gpsProvider: GPSProvider;
  let simulation: SimulationControl | null = null;

  if (config.DATA_MODE === 'MOCK') {
    // Lazy-load the simulation so it is not part of a LIVE bundle's hot path.
    const [{ SimulationEngine }, { createMockRouter }, { MockApiClient }, { MockGPSProvider }, { fetchMapData }] = await Promise.all([
      import('../mock/SimulationEngine'),
      import('../mock/mockRouter'),
      import('../transport/MockApiClient'),
      import('../providers/gps/MockGPSProvider'),
      import('../mock/world/jammuMap'),
    ]);
    // Real Jammu road network (OpenStreetMap via Overture Maps), served as a static file.
    const map = await fetchMapData();
    const simClock = new SimClock(Date.now(), config.SIM_SPEED);
    clock = simClock;
    const engine = new SimulationEngine({ clock: simClock, map });
    engine.start();
    api = new MockApiClient(createMockRouter(engine));
    // Location updates reach the UI via the GPS provider, as they would from a telematics vendor.
    realtime = new MockRealtimeClient(engine.events, [...CORE_EVENTS.filter((e) => e !== 'vehicle.location.updated'), ...EXTRA_EVENTS], () => simClock.now());
    gpsProvider = new MockGPSProvider(engine);
    simulation = {
      setSpeed: (s) => simClock.setSpeed(s),
      get speed() {
        return simClock.speed;
      },
    };
    (globalThis as any).__zencabsEngine = engine; // handy for debugging in the console
  } else {
    clock = new WallClock();
    api = new HttpApiClient(config.API_BASE_URL);
    realtime = new WebSocketRealtimeClient(config.WS_URL);
    gpsProvider = new ZenCabsGPSProvider(api, realtime);
    const status = await api.get<FleetStatusSummary>(API.fleetStatus);
    clock.sync(status.serverTime);
  }

  realtime.connect();

  const mapService = new MapService(api);
  const gpsService = new GpsService(gpsProvider, clock);
  const vehicleService = new VehicleService(api, realtime, gpsService, clock);
  const driverService = new DriverService(api, realtime);
  const bookingService = new BookingService(api, realtime);
  const dispatchService = new DispatchService(api, realtime, clock);
  const parkingService = new ParkingService(api, realtime, clock);
  const alertService = new AlertService(api, realtime);
  const analyticsService = new AnalyticsService(api, clock, vehicleService, driverService, bookingService, dispatchService, mapService);

  await mapService.init();
  await gpsService.init();
  await Promise.all([vehicleService.init(), driverService.init(), bookingService.init(), dispatchService.init(), parkingService.init(), alertService.init()]);
  await analyticsService.init();

  // Safety net next to realtime: periodic snapshot resync (handles missed WS messages).
  setInterval(() => {
    vehicleService.refresh().catch(() => undefined);
    parkingService.refresh().catch(() => undefined);
  }, config.RESYNC_INTERVAL_MS);
  setInterval(() => driverService.refresh().catch(() => undefined), config.RESYNC_INTERVAL_MS * 2);

  return {
    mode: config.DATA_MODE,
    clock,
    api,
    realtime,
    gpsProvider,
    vehicleService,
    driverService,
    gpsService,
    bookingService,
    dispatchService,
    parkingService,
    analyticsService,
    alertService,
    mapService,
    simulation,
  };
}
