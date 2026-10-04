import { API } from '../contracts/api';
import type { Booking, Trip } from '../contracts/types';
import type { ApiClient } from '../transport/ApiClient';
import type { RealtimeClient } from '../transport/RealtimeClient';
import { ObservableService } from './base';

/** Bookings (ride requests) and trips. */
export class BookingService extends ObservableService {
  private bookings = new Map<string, Booking>();
  private trips = new Map<string, Trip>();

  constructor(
    private api: ApiClient,
    private realtime: RealtimeClient,
  ) {
    super();
  }

  async init() {
    await this.refresh();
    const upsertTrip = ({ trip }: { trip: Trip }) => {
      this.trips.set(trip.tripId, trip);
      this.notify();
    };
    this.realtime.on('trip.created', ({ trip, booking }) => {
      this.bookings.set(booking.bookingId, booking);
      upsertTrip({ trip });
    });
    this.realtime.on('trip.started', upsertTrip);
    this.realtime.on('trip.completed', upsertTrip);
    const upsertBooking = ({ booking }: { booking: Booking }) => {
      this.bookings.set(booking.bookingId, booking);
      this.notify();
    };
    this.realtime.on('booking.created', upsertBooking);
    this.realtime.on('booking.updated', upsertBooking);
  }

  async refresh() {
    const [bookings, trips] = await Promise.all([this.api.get<Booking[]>(API.bookings), this.api.get<Trip[]>(API.trips)]);
    this.bookings = new Map(bookings.map((b) => [b.bookingId, b]));
    this.trips = new Map(trips.map((t) => [t.tripId, t]));
    this.notify();
  }

  getBookings() {
    return [...this.bookings.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  pendingBookings() {
    return this.getBookings().filter((b) => b.status === 'PENDING');
  }

  getTrips() {
    return [...this.trips.values()].sort((a, b) => b.assignedAt - a.assignedAt);
  }

  getTrip(tripId: string | null | undefined) {
    return tripId ? this.trips.get(tripId) : undefined;
  }

  /** Fresh trip with its planned route (route is updated as the trip progresses). */
  async fetchTrip(tripId: string) {
    const t = await this.api.get<Trip>(API.trip(tripId));
    this.trips.set(t.tripId, t);
    this.notify();
    return t;
  }

  tripsForVehicle(vehicleId: string) {
    return this.api.get<Trip[]>(API.vehicleTrips(vehicleId));
  }
}
