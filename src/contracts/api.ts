/**
 * REST contract for the ZenCabs Fleet Command Center.
 *
 * The frontend only ever talks to the backend through these paths, via an
 * `ApiClient`. In MOCK mode the client is routed to an in-browser mock server
 * (`src/mock/mockServer.ts`); in LIVE mode it issues real HTTP requests.
 */
import type {
  Alert,
  Booking,
  DispatchRequest,
  DispatchResult,
  Driver,
  FleetAnalytics,
  FleetStatusSummary,
  ParkingBayState,
  ParkingLotLayout,
  Trip,
  Vehicle,
  VehicleStatusUpdate,
  Zone,
  ZoneDemand,
  GPSFix,
} from './types';

export const API = {
  vehicles: '/api/vehicles',
  vehicle: (id: string) => `/api/vehicles/${encodeURIComponent(id)}`,
  vehicleTrips: (id: string) => `/api/vehicles/${encodeURIComponent(id)}/trips`,
  vehicleLocations: (id: string) => `/api/vehicles/${encodeURIComponent(id)}/locations`,
  drivers: '/api/drivers',
  driver: (id: string) => `/api/drivers/${encodeURIComponent(id)}`,
  trips: '/api/trips',
  trip: (id: string) => `/api/trips/${encodeURIComponent(id)}`,
  bookings: '/api/bookings',
  parking: '/api/parking',
  parkingLayout: '/api/parking/layout',
  fleetStatus: '/api/fleet/status',
  fleetAnalytics: '/api/fleet/analytics',
  zones: '/api/zones',
  zoneDemand: '/api/zones/demand',
  alerts: '/api/alerts',
  alertAck: (id: string) => `/api/alerts/${encodeURIComponent(id)}/ack`,
  dispatch: '/api/dispatch',
  vehicleStatus: '/api/vehicle/status',
  gpsLatest: '/api/gps/latest',
  /** Non-production: road graph used by the mock world and the 3D city. */
  mapNetwork: '/api/map/network',
} as const;

/** Response type for each GET endpoint, used for typed fetching. */
export interface ApiResponses {
  'GET /api/vehicles': Vehicle[];
  'GET /api/vehicles/:id': Vehicle;
  'GET /api/vehicles/:id/trips': Trip[];
  'GET /api/vehicles/:id/locations': GPSFix[];
  'GET /api/drivers': Driver[];
  'GET /api/drivers/:id': Driver;
  'GET /api/trips': Trip[];
  'GET /api/trips/:id': Trip;
  'GET /api/bookings': Booking[];
  'GET /api/parking': ParkingBayState[];
  'GET /api/parking/layout': ParkingLotLayout;
  'GET /api/fleet/status': FleetStatusSummary;
  'GET /api/fleet/analytics': FleetAnalytics;
  'GET /api/zones': Zone[];
  'GET /api/zones/demand': ZoneDemand[];
  'GET /api/alerts': Alert[];
  'GET /api/gps/latest': GPSFix[];
  'POST /api/dispatch': DispatchResult;
  'POST /api/vehicle/status': Vehicle;
  'POST /api/alerts/:id/ack': Alert;
}

export interface ApiRequestBodies {
  'POST /api/dispatch': DispatchRequest;
  'POST /api/vehicle/status': VehicleStatusUpdate;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
