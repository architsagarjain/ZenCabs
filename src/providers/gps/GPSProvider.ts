import type { Unsubscribe } from '../../core/emitter';
import type { GPSFix } from '../../contracts/types';

/**
 * Source of raw vehicle position fixes. The 3D scene never knows which
 * implementation is active — it only sees GPSFix objects via gpsService.
 */
export interface GPSProvider {
  readonly name: string;
  start(): Promise<void>;
  stop(): void;
  onFix(handler: (fix: GPSFix) => void): Unsubscribe;
  /** Most recent fix per vehicle (initial positions on startup / reconnect). */
  latest(): Promise<GPSFix[]>;
  /** Recent breadcrumb trail for one vehicle. */
  history(vehicleId: string): Promise<GPSFix[]>;
}
