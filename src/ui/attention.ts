/**
 * Turns raw alerts into human-readable Operations Feed rows and Action Center items
 * (DESIGN.md §17–18: only actionable cases in the Action Center, most urgent first).
 */
import { formatAgo, formatDuration, shortId } from '../core/format';
import type { Alert, AlertType, Vehicle, Zone } from '../contracts/types';

export const ALERT_TITLE: Record<AlertType, string> = {
  EXCESSIVE_IDLE: 'Parked too long',
  GPS_STALE: 'Location unavailable',
  LOW_BATTERY: 'Low battery',
  LOW_FUEL: 'Low fuel',
  MAINTENANCE_DUE: 'Service due',
  OVERSPEED: 'Overspeeding',
  LONG_WAIT_AT_PICKUP: 'Waiting at pickup',
  UNSERVED_DEMAND: 'Riders waiting',
  VEHICLE_OFFLINE: 'Vehicle offline',
};

/** Alert types that need a person to act. */
const ACTIONABLE: AlertType[] = ['VEHICLE_OFFLINE', 'GPS_STALE', 'LONG_WAIT_AT_PICKUP', 'UNSERVED_DEMAND', 'OVERSPEED', 'LOW_BATTERY', 'LOW_FUEL', 'EXCESSIVE_IDLE'];
const SEV_RANK = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const;

export interface ActionItem {
  alert: Alert;
  title: string;
  subject: string;
  context: string;
  vehicle?: Vehicle;
  zone?: Zone;
}

export function actionItems(alerts: Alert[], vehicles: Record<string, Vehicle>, zones: Zone[], now: number): ActionItem[] {
  return alerts
    .filter((a) => !a.resolvedAt && !a.acknowledged && ACTIONABLE.includes(a.type))
    // Idle warnings (1–2 h) stay in the feed; only critical idle needs a decision.
    .filter((a) => a.type !== 'EXCESSIVE_IDLE' || a.severity === 'CRITICAL')
    .sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || a.createdAt - b.createdAt)
    .map((a) => {
      const v = a.vehicleId ? vehicles[a.vehicleId] : undefined;
      const zone = a.zoneId ? zones.find((z) => z.zoneId === a.zoneId) : undefined;
      return { alert: a, title: ALERT_TITLE[a.type], subject: v ? `${shortId(v.vehicleId)} · ${v.driverName ?? 'No driver'}` : zone?.name ?? 'Fleet', context: contextFor(a, v, now), vehicle: v, zone };
    });
}

function contextFor(a: Alert, v: Vehicle | undefined, now: number): string {
  if (!v) return a.message;
  switch (a.type) {
    case 'EXCESSIVE_IDLE':
      return `Bay ${v.parkingBay ?? '—'} · parked ${formatDuration(v.parkingEntryTime ? now - v.parkingEntryTime : null)}`;
    case 'GPS_STALE':
      return `Last location ${formatAgo(now - v.lastGpsUpdate)}`;
    case 'VEHICLE_OFFLINE':
      return `No telemetry for ${formatDuration(now - v.lastGpsUpdate)}`;
    case 'LONG_WAIT_AT_PICKUP':
      return `At ${v.pickupLocation?.name ?? 'pickup'} · ${formatAgo(now - a.createdAt).replace(' ago', '')} so far`;
    case 'OVERSPEED':
      return `${Math.round(v.speed)} km/h right now`;
    case 'LOW_BATTERY':
      return `Battery ${Math.round(v.batteryPercentage ?? 0)}% · ${v.status === 'ON_TRIP' ? 'on a trip' : 'send to charge'}`;
    case 'LOW_FUEL':
      return `Fuel ${Math.round(v.fuelPercentage ?? 0)}%`;
    default:
      return a.message;
  }
}

export type FeedSeverity = 'critical' | 'warning' | 'info';
export function feedSeverity(a: Alert): FeedSeverity {
  return a.severity === 'CRITICAL' ? 'critical' : a.severity === 'WARNING' ? 'warning' : 'info';
}
