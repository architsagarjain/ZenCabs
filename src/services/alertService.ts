import { API } from '../contracts/api';
import type { Alert } from '../contracts/types';
import type { ApiClient } from '../transport/ApiClient';
import type { RealtimeClient } from '../transport/RealtimeClient';
import { Emitter } from '../core/emitter';
import { ObservableService } from './base';

export class AlertService extends ObservableService {
  private alerts = new Map<string, Alert>();
  private created = new Emitter<{ alert: Alert }>();

  constructor(
    private api: ApiClient,
    private realtime: RealtimeClient,
  ) {
    super();
  }

  async init() {
    const list = await this.api.get<Alert[]>(API.alerts);
    this.alerts = new Map(list.map((a) => [a.alertId, a]));
    this.notify();
    this.realtime.on('alert.created', ({ alert }) => {
      this.alerts.set(alert.alertId, alert);
      this.created.emit('alert', alert);
      this.notify();
    });
    this.realtime.on('alert.resolved', ({ alert }) => {
      this.alerts.set(alert.alertId, alert);
      this.notify();
    });
  }

  onAlert(handler: (a: Alert) => void) {
    return this.created.on('alert', handler);
  }

  getAll() {
    return [...this.alerts.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  active() {
    return this.getAll().filter((a) => !a.resolvedAt);
  }

  forVehicle(vehicleId: string) {
    return this.active().filter((a) => a.vehicleId === vehicleId);
  }

  async acknowledge(alertId: string) {
    const a = await this.api.post<Alert>(API.alertAck(alertId), {});
    this.alerts.set(a.alertId, a);
    this.notify();
  }
}
