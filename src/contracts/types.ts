/**
 * ZenCabs domain model.
 *
 * These types are the single source of truth shared by the frontend, the mock
 * backend (in-browser simulation) and the reference Node server. They mirror
 * the REST/WebSocket contracts in `docs/API_CONTRACTS.md` and the database
 * schema in `db/schema.sql`. Timestamps are epoch milliseconds (UTC).
 */

export type VehicleStatus =
  | 'AVAILABLE'
  | 'ASSIGNED'
  | 'EN_ROUTE_PICKUP'
  | 'WAITING'
  | 'ON_TRIP'
  | 'RETURNING_TO_BASE'
  | 'MAINTENANCE'
  | 'OFFLINE';

export const VEHICLE_STATUSES: VehicleStatus[] = [
  'AVAILABLE',
  'ASSIGNED',
  'EN_ROUTE_PICKUP',
  'WAITING',
  'ON_TRIP',
  'RETURNING_TO_BASE',
  'MAINTENANCE',
  'OFFLINE',
];

export type VehicleType = 'SEDAN' | 'SUV' | 'EV_SEDAN' | 'HATCHBACK';
export type FuelKind = 'PETROL' | 'DIESEL' | 'CNG' | 'ELECTRIC';
export type MaintenanceStatus = 'OK' | 'DUE_SOON' | 'OVERDUE' | 'IN_SERVICE';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Vehicle {
  vehicleId: string; // "ZEN-014"
  registrationNumber: string; // "JK02AB1234"
  vehicleType: VehicleType;
  vehicleModel: string;
  fuelKind: FuelKind;
  driverId: string | null;
  driverName: string | null;
  driverPhone: string | null;
  driverPhoto: string | null;
  status: VehicleStatus;
  latitude: number;
  longitude: number;
  speed: number; // km/h
  heading: number; // degrees, 0 = north, clockwise
  parkingBay: string | null;
  parkingEntryTime: number | null;
  /** Server-computed snapshot in ms. Clients should recompute from parkingEntryTime. */
  parkingDuration: number | null;
  currentTripId: string | null;
  pickupLocation: NamedPlace | null;
  destination: NamedPlace | null;
  tripStartTime: number | null;
  estimatedTripEnd: number | null;
  tripsToday: number;
  revenueToday: number; // INR
  distanceToday: number; // km
  idleTimeToday: number; // ms
  batteryPercentage: number | null; // EVs only
  fuelPercentage: number | null; // ICE only
  lastGpsUpdate: number;
  maintenanceStatus: MaintenanceStatus;
  odometerKm: number;
  zoneId: string | null;
}

export interface NamedPlace extends LatLng {
  name: string;
  zoneId?: string;
}

export type DriverShiftState = 'ON_SHIFT' | 'ON_BREAK' | 'OFF_SHIFT';

export interface Driver {
  driverId: string;
  name: string;
  phone: string;
  photo: string; // URL or data URI
  licenseNumber: string;
  rating: number;
  joinedOn: string; // ISO date
  shiftState: DriverShiftState;
  shiftStart: number | null;
  shiftEnd: number | null;
  assignedVehicleId: string | null;
  tripsToday: number;
  earningsToday: number;
  hoursOnlineToday: number;
  languages: string[];
}

export type TripStatus =
  | 'REQUESTED'
  | 'ASSIGNED'
  | 'DRIVER_EN_ROUTE'
  | 'DRIVER_ARRIVED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';

export interface Trip {
  tripId: string;
  bookingId: string;
  vehicleId: string;
  driverId: string;
  status: TripStatus;
  pickup: NamedPlace;
  destination: NamedPlace;
  assignedAt: number;
  pickupArrivalAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
  estimatedEnd: number | null;
  distanceKm: number;
  fare: number;
  customerName: string;
  /** Planned route polyline, if known. */
  route: LatLng[];
}

export type BookingStatus = 'PENDING' | 'DISPATCHED' | 'FULFILLED' | 'CANCELLED' | 'UNSERVED';
export type BookingChannel = 'APP' | 'CALL_CENTER' | 'WALK_IN' | 'CORPORATE';

export interface Booking {
  bookingId: string;
  createdAt: number;
  customerName: string;
  customerPhone: string;
  channel: BookingChannel;
  pickup: NamedPlace;
  destination: NamedPlace;
  status: BookingStatus;
  vehicleTypePreference: VehicleType | null;
  tripId: string | null;
  estimatedFare: number;
}

export interface ParkingBay {
  bayId: string; // "A01"
  row: string; // "A"
  /** Position in the lot's local frame, meters. x → lot east, y → lot north. */
  x: number;
  y: number;
  /** Rotation in degrees (lot frame) the vehicle faces when parked. */
  rotation: number;
  width: number;
  length: number;
  kind: 'STANDARD' | 'EV_CHARGING' | 'SERVICE';
}

export interface ParkingLotLayout {
  lotId: string;
  name: string;
  /** Geographic anchor of the lot's local origin. */
  origin: LatLng;
  /** Clockwise rotation of the lot's local frame relative to true north, degrees. */
  bearing: number;
  width: number; // meters (local x)
  depth: number; // meters (local y)
  bays: ParkingBay[];
  /** Drive aisles in local meters: polylines vehicles follow inside the lot. */
  aisles: { id: string; points: { x: number; y: number }[] }[];
  gate: { x: number; y: number; name: string };
  buildings: { id: string; name: string; x: number; y: number; w: number; d: number; h: number }[];
}

export interface ParkingSession {
  sessionId: string;
  vehicleId: string;
  bayId: string;
  entryTime: number;
  exitTime: number | null;
}

export type ParkingIdleLevel = 'NORMAL' | 'ATTENTION' | 'WARNING' | 'CRITICAL';

export interface ParkingBayState {
  bay: ParkingBay;
  vehicleId: string | null;
  entryTime: number | null;
  reservedFor: string | null;
}

export interface GPSFix {
  vehicleId: string;
  latitude: number;
  longitude: number;
  speed: number; // km/h
  heading: number; // degrees
  accuracy: number; // meters
  timestamp: number;
  source: 'MOCK' | 'ZENCABS' | 'VENDOR';
}

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type AlertType =
  | 'EXCESSIVE_IDLE'
  | 'GPS_STALE'
  | 'LOW_BATTERY'
  | 'LOW_FUEL'
  | 'MAINTENANCE_DUE'
  | 'OVERSPEED'
  | 'LONG_WAIT_AT_PICKUP'
  | 'UNSERVED_DEMAND'
  | 'VEHICLE_OFFLINE';

export interface Alert {
  alertId: string;
  type: AlertType;
  severity: AlertSeverity;
  vehicleId: string | null;
  zoneId: string | null;
  message: string;
  createdAt: number;
  acknowledged: boolean;
  resolvedAt: number | null;
}

export interface Zone {
  zoneId: string;
  name: string;
  center: LatLng;
  radiusM: number;
  kind: 'AIRPORT' | 'RAIL' | 'BUS' | 'MARKET' | 'RESIDENTIAL' | 'COMMERCIAL' | 'HOSPITAL' | 'TEMPLE' | 'BASE';
}

export interface ZoneDemand {
  zoneId: string;
  pendingRequests: number;
  requestsLastHour: number;
  /** Expected requests in the next 30 minutes (forecast). */
  forecastNext30: number;
}

export interface FleetStatusSummary {
  serverTime: number;
  totalFleet: number;
  byStatus: Record<VehicleStatus, number>;
  onTrip: number;
  available: number;
  parkedOverOneHour: number;
  maintenance: number;
  offline: number;
  atBase: number;
}

export interface FleetAnalytics {
  serverTime: number;
  revenueToday: number;
  tripsToday: number;
  distanceToday: number;
  avgRevenuePerVehicle: number;
  utilizationPct: number;
  zones: Array<ZoneDemand & { supply: number; gap: number }>;
}

export interface DispatchRequest {
  bookingId?: string;
  pickup: NamedPlace;
  destination: NamedPlace;
  customerName?: string;
  vehicleTypePreference?: VehicleType | null;
  /** If set, the operator forces this vehicle; otherwise the engine picks. */
  vehicleId?: string;
  /** Preview only: return the recommendation without assigning. */
  dryRun?: boolean;
}

export interface DispatchCandidate {
  vehicleId: string;
  etaMinutes: number;
  distanceKm: number;
  score: number;
  reasons: string[];
}

export interface DispatchResult {
  booking: Booking;
  recommended: DispatchCandidate | null;
  candidates: DispatchCandidate[];
  trip: Trip | null;
  assigned: boolean;
}

export interface VehicleStatusUpdate {
  vehicleId: string;
  status: VehicleStatus;
  reason?: string;
}

export interface FleetEvent {
  eventId: string;
  type: string;
  vehicleId: string | null;
  message: string;
  at: number;
}
