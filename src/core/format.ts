import { PARKING_THRESHOLDS } from '../config/dataConfig';
import type { ParkingIdleLevel, VehicleStatus } from '../contracts/types';

export function formatDuration(ms: number | null | undefined, opts: { seconds?: boolean } = {}): string {
  if (ms == null || !isFinite(ms)) return '—';
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h} hr ${m} min`;
  if (m > 0) return opts.seconds ? `${m} min ${s} sec` : `${m} min`;
  return `${s} sec`;
}

export function formatAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} sec ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h} hr ${m % 60} min ago`;
}

export function formatINR(n: number): string {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

export function formatClock(t: number): string {
  return new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function parkingIdleLevel(durationMs: number | null): ParkingIdleLevel {
  if (durationMs == null) return 'NORMAL';
  const min = durationMs / 60_000;
  if (min >= PARKING_THRESHOLDS.criticalMin) return 'CRITICAL';
  if (min >= PARKING_THRESHOLDS.warningMin) return 'WARNING';
  if (min >= PARKING_THRESHOLDS.attentionMin) return 'ATTENTION';
  return 'NORMAL';
}

export const IDLE_COLORS: Record<ParkingIdleLevel, string> = {
  NORMAL: '#22c55e',
  ATTENTION: '#facc15',
  WARNING: '#fb923c',
  CRITICAL: '#ef4444',
};

export const IDLE_LABEL: Record<ParkingIdleLevel, string> = {
  NORMAL: 'Normal',
  ATTENTION: 'Attention',
  WARNING: 'Warning',
  CRITICAL: 'Critical idle',
};

export const STATUS_COLORS: Record<VehicleStatus, string> = {
  AVAILABLE: '#22c55e',
  ASSIGNED: '#a78bfa',
  EN_ROUTE_PICKUP: '#38bdf8',
  WAITING: '#f472b6',
  ON_TRIP: '#3b82f6',
  RETURNING_TO_BASE: '#2dd4bf',
  MAINTENANCE: '#f59e0b',
  OFFLINE: '#64748b',
};

export const STATUS_LABEL: Record<VehicleStatus, string> = {
  AVAILABLE: 'Available',
  ASSIGNED: 'Assigned',
  EN_ROUTE_PICKUP: 'En route to pickup',
  WAITING: 'Waiting at pickup',
  ON_TRIP: 'On trip',
  RETURNING_TO_BASE: 'Returning to base',
  MAINTENANCE: 'Maintenance',
  OFFLINE: 'Offline',
};

export function shortId(vehicleId: string): string {
  return vehicleId.replace('-', ' ');
}
