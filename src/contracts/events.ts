/**
 * Realtime (WebSocket) contract.
 *
 * Every message on the wire is an envelope: `{ "event": "<name>", "data": {...}, "ts": 1700000000000 }`.
 * The mock realtime channel emits exactly the same envelopes as the backend will.
 */
import type { Alert, Booking, GPSFix, ParkingSession, Trip, Vehicle, VehicleStatus } from './types';

export interface RealtimeEvents {
  'vehicle.location.updated': GPSFix;
  'vehicle.status.updated': {
    vehicleId: string;
    previousStatus: VehicleStatus;
    status: VehicleStatus;
    vehicle: Vehicle;
    reason?: string;
  };
  'vehicle.entered.parking': { vehicleId: string; bayId: string; session: ParkingSession };
  'vehicle.left.parking': { vehicleId: string; bayId: string; session: ParkingSession };
  'trip.created': { trip: Trip; booking: Booking };
  'trip.started': { trip: Trip };
  'trip.completed': { trip: Trip };
  'driver.assigned': { driverId: string; vehicleId: string; tripId: string | null };
  'alert.created': { alert: Alert };
  /** Supplementary events (not in the initial spec but useful to the UI). */
  'booking.created': { booking: Booking };
  'booking.updated': { booking: Booking };
  'alert.resolved': { alert: Alert };
  'vehicle.updated': { vehicle: Vehicle };
}

export type RealtimeEventName = keyof RealtimeEvents;

export interface RealtimeEnvelope<E extends RealtimeEventName = RealtimeEventName> {
  event: E;
  data: RealtimeEvents[E];
  ts: number;
}

export const CORE_EVENTS: RealtimeEventName[] = [
  'vehicle.location.updated',
  'vehicle.status.updated',
  'vehicle.entered.parking',
  'vehicle.left.parking',
  'trip.created',
  'trip.started',
  'trip.completed',
  'driver.assigned',
  'alert.created',
];
