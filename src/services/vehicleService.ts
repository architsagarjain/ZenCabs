import type { Clock } from '../core/clock';
import { API } from '../contracts/api';
import type { Vehicle, VehicleStatus } from '../contracts/types';
import type { ApiClient } from '../transport/ApiClient';
import type { RealtimeClient } from '../transport/RealtimeClient';
import { ObservableService } from './base';
import type { GpsService } from './gpsService';

/** Fleet roster + live vehicle state (status from realtime events, position from gpsService). */
export class VehicleService extends ObservableService {
  private vehicles = new Map<string, Vehicle>();
  /** Client-observed time of the last status change (for "idle for …" displays). */
  private statusSince = new Map<string, number>();

  constructor(
    private api: ApiClient,
    private realtime: RealtimeClient,
    private gps: GpsService,
    private clock: Clock,
  ) {
    super();
  }

  async init() {
    await this.refresh();
    this.realtime.on('vehicle.status.updated', ({ vehicle }) => this.upsert(vehicle));
    this.realtime.on('vehicle.updated', ({ vehicle }) => this.upsert(vehicle));
    this.realtime.on('vehicle.entered.parking', ({ vehicleId, bayId, session }) =>
      this.patch(vehicleId, { parkingBay: bayId, parkingEntryTime: session.entryTime }),
    );
    this.realtime.on('vehicle.left.parking', ({ vehicleId }) => this.patch(vehicleId, { parkingBay: null, parkingEntryTime: null, parkingDuration: null }));
    this.realtime.on('trip.completed', ({ trip }) => this.refreshOne(trip.vehicleId));
    this.gps.onFix((fix) => {
      const v = this.vehicles.get(fix.vehicleId);
      if (!v || fix.timestamp < v.lastGpsUpdate) return;
      v.latitude = fix.latitude;
      v.longitude = fix.longitude;
      v.speed = fix.speed;
      v.heading = fix.heading;
      v.lastGpsUpdate = fix.timestamp;
      this.notify();
    });
  }

  async refresh() {
    const list = await this.api.get<Vehicle[]>(API.vehicles);
    for (const v of list) this.upsert(v, false);
    this.notify();
  }

  async refreshOne(vehicleId: string) {
    this.upsert(await this.api.get<Vehicle>(API.vehicle(vehicleId)));
  }

  private upsert(v: Vehicle, notify = true) {
    const cur = this.vehicles.get(v.vehicleId);
    if (!cur || cur.status !== v.status) this.statusSince.set(v.vehicleId, cur ? this.clock.now() : v.parkingEntryTime ?? this.clock.now());
    // Never let an older snapshot overwrite a fresher GPS position.
    if (cur && cur.lastGpsUpdate > v.lastGpsUpdate) {
      v = { ...v, latitude: cur.latitude, longitude: cur.longitude, speed: cur.speed, heading: cur.heading, lastGpsUpdate: cur.lastGpsUpdate };
    }
    this.vehicles.set(v.vehicleId, v);
    if (notify) this.notify();
  }

  private patch(vehicleId: string, p: Partial<Vehicle>) {
    const cur = this.vehicles.get(vehicleId);
    if (!cur) return;
    this.vehicles.set(vehicleId, { ...cur, ...p });
    this.notify();
  }

  getAll(): Vehicle[] {
    return [...this.vehicles.values()];
  }

  get(vehicleId: string): Vehicle | undefined {
    return this.vehicles.get(vehicleId);
  }

  parkingDuration(v: Vehicle): number | null {
    return v.parkingEntryTime ? this.clock.now() - v.parkingEntryTime : null;
  }

  statusAge(vehicleId: string): number {
    return this.clock.now() - (this.statusSince.get(vehicleId) ?? this.clock.now());
  }

  gpsAge(v: Vehicle): number {
    return this.clock.now() - v.lastGpsUpdate;
  }

  async setStatus(vehicleId: string, status: VehicleStatus, reason?: string) {
    const v = await this.api.post<Vehicle>(API.vehicleStatus, { vehicleId, status, reason });
    this.upsert(v);
    return v;
  }
}
