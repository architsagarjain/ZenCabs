/**
 * Data source configuration.
 *
 *   DATA_MODE = "MOCK"  → everything runs against the in-browser simulation
 *                          (mock REST server + mock realtime channel + MockGPSProvider).
 *   DATA_MODE = "LIVE"  → services talk to the ZenCabs backend over HTTP/WebSocket and
 *                          GPS comes from ZenCabsGPSProvider.
 *
 * Only the transport layer changes between modes; services and UI are identical.
 * Override with Vite env vars (see `.env.example`) or `?mode=LIVE` in the URL.
 */
export type DataMode = 'MOCK' | 'LIVE';
export type GPSProviderKind = 'MOCK' | 'ZENCABS';

export interface DataConfig {
  DATA_MODE: DataMode;
  API_BASE_URL: string;
  WS_URL: string;
  GPS_PROVIDER: GPSProviderKind;
  /** How often services re-sync full snapshots (safety net next to realtime events). */
  RESYNC_INTERVAL_MS: number;
  /** A vehicle whose last GPS fix is older than this is considered stale. */
  GPS_STALE_AFTER_MS: number;
  /** Simulation speed multiplier at startup (MOCK only). */
  SIM_SPEED: number;
}

const env = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {};
const query = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();

const mode = (query.get('mode') ?? env.VITE_DATA_MODE ?? 'MOCK').toUpperCase() as DataMode;

export const DATA_CONFIG: DataConfig = {
  DATA_MODE: mode === 'LIVE' ? 'LIVE' : 'MOCK',
  API_BASE_URL: env.VITE_API_BASE_URL ?? 'http://localhost:8787',
  WS_URL: env.VITE_WS_URL ?? 'ws://localhost:8787/ws',
  GPS_PROVIDER: mode === 'LIVE' ? ((env.VITE_GPS_PROVIDER ?? 'ZENCABS').toUpperCase() as GPSProviderKind) : 'MOCK',
  RESYNC_INTERVAL_MS: 15_000,
  GPS_STALE_AFTER_MS: 60_000,
  SIM_SPEED: Number(query.get('speed') ?? 3),
};

/** Operational thresholds — tune here, not in components. */
export const PARKING_THRESHOLDS = {
  attentionMin: 30,
  warningMin: 60,
  criticalMin: 120,
};

export const OPS_THRESHOLDS = {
  lowRevenueINR: 1500,
  lowBatteryPct: 20,
  lowFuelPct: 15,
  overspeedKmh: 70,
  longWaitMin: 6,
};
