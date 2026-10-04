import type { Clock } from '../core/clock';
import { API } from '../contracts/api';
import type { DispatchRequest, DispatchResult } from '../contracts/types';
import type { ApiClient } from '../transport/ApiClient';
import type { RealtimeClient } from '../transport/RealtimeClient';
import { ObservableService } from './base';

export interface DispatchActivity {
  id: string;
  at: number;
  kind: 'REQUEST' | 'ASSIGNED' | 'STARTED' | 'COMPLETED' | 'STATUS' | 'PARKING';
  vehicleId: string | null;
  text: string;
}

/** Dispatch: recommendation + assignment, and the live dispatch activity log. */
export class DispatchService extends ObservableService {
  private log: DispatchActivity[] = [];
  private n = 0;

  constructor(
    private api: ApiClient,
    private realtime: RealtimeClient,
    private clock: Clock,
  ) {
    super();
  }

  async init() {
    const push = (kind: DispatchActivity['kind'], vehicleId: string | null, text: string, at = this.clock.now()) => {
      this.log.unshift({ id: `a${this.n++}`, at, kind, vehicleId, text });
      if (this.log.length > 150) this.log.length = 150;
      this.notify();
    };
    this.realtime.on('booking.created', ({ booking }) => push('REQUEST', null, `Ride request at ${booking.pickup.name} → ${booking.destination.name}`, booking.createdAt));
    this.realtime.on('trip.created', ({ trip, booking }) => push('ASSIGNED', trip.vehicleId, `${label(trip.vehicleId)} assigned to ${booking.customerName} at ${booking.pickup.name}`));
    this.realtime.on('trip.started', ({ trip }) => push('STARTED', trip.vehicleId, `${label(trip.vehicleId)} started trip to ${trip.destination.name}`));
    this.realtime.on('trip.completed', ({ trip }) => push('COMPLETED', trip.vehicleId, `${label(trip.vehicleId)} completed trip · ₹${trip.fare}`));
    this.realtime.on('vehicle.entered.parking', ({ vehicleId, bayId }) => push('PARKING', vehicleId, `${label(vehicleId)} parked in bay ${bayId}`));
    this.realtime.on('vehicle.left.parking', ({ vehicleId, bayId }) => push('PARKING', vehicleId, `${label(vehicleId)} left bay ${bayId}`));
    this.realtime.on('vehicle.status.updated', ({ vehicleId, status, reason }) => {
      if (status === 'RETURNING_TO_BASE' || status === 'WAITING') push('STATUS', vehicleId, `${label(vehicleId)} ${reason ?? status}`);
    });
  }

  activity() {
    return this.log;
  }

  /** Ask the backend which vehicle it would assign, without assigning. */
  recommend(req: DispatchRequest) {
    return this.api.post<DispatchResult>(API.dispatch, { ...req, dryRun: true });
  }

  dispatch(req: DispatchRequest) {
    return this.api.post<DispatchResult>(API.dispatch, { ...req, dryRun: false });
  }
}

function label(id: string) {
  return id.replace('-', ' ');
}
