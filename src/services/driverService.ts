import { API } from '../contracts/api';
import type { Driver } from '../contracts/types';
import type { ApiClient } from '../transport/ApiClient';
import type { RealtimeClient } from '../transport/RealtimeClient';
import { ObservableService } from './base';

export class DriverService extends ObservableService {
  private drivers = new Map<string, Driver>();

  constructor(
    private api: ApiClient,
    private realtime: RealtimeClient,
  ) {
    super();
  }

  async init() {
    await this.refresh();
    this.realtime.on('driver.assigned', ({ driverId }) => this.refreshOne(driverId));
    this.realtime.on('trip.completed', ({ trip }) => this.refreshOne(trip.driverId));
    this.realtime.on('vehicle.updated', ({ vehicle }) => vehicle.driverId && this.refreshOne(vehicle.driverId));
    this.realtime.on('vehicle.status.updated', ({ vehicle }) => vehicle.driverId && this.refreshOne(vehicle.driverId));
  }

  async refresh() {
    const list = await this.api.get<Driver[]>(API.drivers);
    this.drivers = new Map(list.map((d) => [d.driverId, d]));
    this.notify();
  }

  async refreshOne(driverId: string) {
    try {
      const d = await this.api.get<Driver>(API.driver(driverId));
      this.drivers.set(d.driverId, d);
      this.notify();
    } catch {
      /* transient */
    }
  }

  getAll() {
    return [...this.drivers.values()];
  }

  get(driverId: string | null | undefined) {
    return driverId ? this.drivers.get(driverId) : undefined;
  }

  /** Telephony hook: today a tel: link; later a click-to-call integration. */
  callUri(driver: Driver) {
    return `tel:${driver.phone.replace(/\s+/g, '')}`;
  }
}
