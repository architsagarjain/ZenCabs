import type { Clock } from '../core/clock';
import { localToLatLng, toScene } from '../core/geo';
import { parkingIdleLevel } from '../core/format';
import { API } from '../contracts/api';
import type { ParkingBay, ParkingBayState, ParkingIdleLevel, ParkingLotLayout } from '../contracts/types';
import type { ApiClient } from '../transport/ApiClient';
import type { RealtimeClient } from '../transport/RealtimeClient';
import { ObservableService } from './base';

/** Parking lot digital twin: layout, live bay occupancy and parking timers. */
export class ParkingService extends ObservableService {
  layout!: ParkingLotLayout;
  private bays = new Map<string, ParkingBayState>();
  private poseCache = new Map<string, { x: number; z: number; heading: number }>();

  constructor(
    private api: ApiClient,
    private realtime: RealtimeClient,
    private clock: Clock,
  ) {
    super();
  }

  async init() {
    this.layout = await this.api.get<ParkingLotLayout>(API.parkingLayout);
    await this.refresh();
    this.realtime.on('vehicle.entered.parking', ({ vehicleId, bayId, session }) => {
      const st = this.bays.get(bayId);
      if (st) this.bays.set(bayId, { ...st, vehicleId, entryTime: session.entryTime, reservedFor: null });
      this.notify();
    });
    this.realtime.on('vehicle.left.parking', ({ bayId }) => {
      const st = this.bays.get(bayId);
      if (st) this.bays.set(bayId, { ...st, vehicleId: null, entryTime: null });
      this.notify();
    });
  }

  async refresh() {
    const list = await this.api.get<ParkingBayState[]>(API.parking);
    this.bays = new Map(list.map((b) => [b.bay.bayId, b]));
    this.notify();
  }

  getBays() {
    return [...this.bays.values()];
  }

  bayOf(vehicleId: string) {
    return this.getBays().find((b) => b.vehicleId === vehicleId);
  }

  durationMs(entryTime: number | null | undefined): number | null {
    return entryTime ? this.clock.now() - entryTime : null;
  }

  idleLevel(entryTime: number | null | undefined): ParkingIdleLevel {
    return parkingIdleLevel(this.durationMs(entryTime));
  }

  occupancy() {
    const std = this.getBays().filter((b) => b.bay.kind !== 'SERVICE');
    const used = std.filter((b) => b.vehicleId).length;
    return { used, total: std.length, free: std.length - used };
  }

  /** Lot-local point → scene coordinates (shared with the 3D twin). */
  localToScene(x: number, y: number) {
    const ll = localToLatLng(this.layout.origin, this.layout.bearing, x, y);
    return toScene(ll.lat, ll.lng);
  }

  /** Scene pose of a bay (where a parked car is rendered). */
  bayPose(bay: ParkingBay | string) {
    const b = typeof bay === 'string' ? this.bays.get(bay)?.bay : bay;
    if (!b) return null;
    let pose = this.poseCache.get(b.bayId);
    if (!pose) {
      const p = this.localToScene(b.x, b.y);
      pose = { x: p.x, z: p.z, heading: (b.rotation + this.layout.bearing) % 360 };
      this.poseCache.set(b.bayId, pose);
    }
    return pose;
  }
}
