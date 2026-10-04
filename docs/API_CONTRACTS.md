# ZenCabs Fleet Command Center: API contracts

The frontend talks to the backend **only** through these contracts. In the prototype they are served by the in-browser mock router (`src/mock/mockRouter.ts`). The reference Node server (`server/index.ts`) serves the same contracts over real HTTP and WebSocket.

TypeScript definitions are the source of truth:

| Contract | File |
| --- | --- |
| Domain types (`Vehicle`, `Driver`, `Trip`, …) | `src/contracts/types.ts` |
| REST paths and response types | `src/contracts/api.ts` |
| WebSocket events | `src/contracts/events.ts` |
| Map / geography payload | `src/contracts/map.ts` |

Conventions:

- JSON bodies.
- Timestamps are epoch milliseconds (UTC). Clients format them in IST.
- Coordinates are WGS84 `latitude` / `longitude`. Speed is in km/h. Heading is in degrees (0 = north, clockwise).
- Errors are `{"error": "message"}` with a matching HTTP status: `400` invalid input, `404` unknown entity, `409` illegal state transition, `422` status owned by the dispatch lifecycle.
- Auth (production): `Authorization: Bearer <token>`. `HttpApiClient` already supports a token getter.

## REST

| Method | Path | Returns | Notes |
| --- | --- | --- | --- |
| GET | `/api/vehicles` | `Vehicle[]` | Full fleet snapshot (current state). |
| GET | `/api/vehicles/:id` | `Vehicle` | |
| GET | `/api/vehicles/:id/trips` | `Trip[]` | Today's trips, newest first. |
| GET | `/api/vehicles/:id/locations` | `GPSFix[]` | Recent breadcrumb trail (GPS trail). |
| GET | `/api/drivers` | `Driver[]` | |
| GET | `/api/drivers/:id` | `Driver` | |
| GET | `/api/trips?vehicleId=&status=` | `Trip[]` | |
| GET | `/api/trips/:id` | `Trip` | Includes planned `route` polyline. |
| GET | `/api/bookings` | `Booking[]` | Pending plus the last 2 hours. |
| GET | `/api/parking` | `ParkingBayState[]` | Bay occupancy and entry times. |
| GET | `/api/parking/layout` | `ParkingLotLayout` | Digital twin geometry. Replace with the surveyed lot. |
| GET | `/api/fleet/status` | `FleetStatusSummary` | HUD counters and `serverTime` (clock sync). |
| GET | `/api/fleet/analytics` | `FleetAnalytics` | Revenue, utilisation, zone demand vs supply. |
| GET | `/api/zones` | `Zone[]` | |
| GET | `/api/zones/demand` | `ZoneDemand[]` | |
| GET | `/api/alerts` | `Alert[]` | |
| POST | `/api/alerts/:id/ack` | `Alert` | |
| GET | `/api/gps/latest` | `GPSFix[]` | Latest fix per vehicle (bootstraps `ZenCabsGPSProvider`). |
| POST | `/api/dispatch` | `DispatchResult` | See below. |
| POST | `/api/vehicle/status` | `Vehicle` | Operator override: `AVAILABLE`, `MAINTENANCE` or `OFFLINE`. |
| GET | `/api/map/network` | `MapNetwork` | Prototype only (basemap and routing graph). |

### `POST /api/dispatch`

```jsonc
// request (DispatchRequest)
{
  "pickup":      { "name": "Jammu Airport", "lat": 32.6891, "lng": 74.8374 },
  "destination": { "name": "Raghunath Temple", "lat": 32.7300, "lng": 74.8650 },
  "customerName": "Walk-in customer",
  "vehicleTypePreference": null,   // SEDAN | SUV | EV_SEDAN | HATCHBACK | null
  "vehicleId": "ZEN-014",          // optional: operator forces a vehicle
  "bookingId": "BKG-…",            // optional: dispatch an existing pending booking
  "dryRun": true                   // true = recommendation only, nothing assigned
}
// response (DispatchResult)
{
  "booking": { "bookingId": "BKG-…", "status": "DISPATCHED", … },
  "recommended": { "vehicleId": "ZEN-014", "etaMinutes": 4, "distanceKm": 1.9, "score": 2.1,
                   "reasons": ["1.9 km away · ETA 4 min", "Idle 72 min — fairness boost", "Battery 82%"] },
  "candidates": [ … up to 6, best first … ],
  "trip": { "tripId": "TRP-…", "status": "ASSIGNED", … },
  "assigned": true
}
```

Recommendation scoring (mock engine, `rankCandidates`):

- ETA minutes (road distance ≈ 1.32 × straight line at about 31 km/h, plus 70 s to leave the lot).
- Minus a fairness bonus for vehicles idle more than 20 min.
- Plus penalties for low energy or for re-tasking a returning vehicle.
- Minus a small bonus for drivers rated ≥ 4.8.
- Excluded: drivers not `ON_SHIFT`, EVs below 25 %, ICE vehicles below 12 %, and any vehicle not `AVAILABLE` (or `RETURNING_TO_BASE` and still far from base).

### Vehicle lifecycle

```
AVAILABLE ──dispatch──▶ ASSIGNED ──driver accepts──▶ EN_ROUTE_PICKUP ──arrives──▶ WAITING
    ▲                                                                              │ customer boards
    │                                                                              ▼
    ├────────────── drop-off (stays in field) ◀───────────────────────────── ON_TRIP
    │                                                                              │
    └── parks in bay ◀── RETURNING_TO_BASE ◀── drop-off (low charge / end of cycle) ┘
MAINTENANCE and OFFLINE are operator-set (POST /api/vehicle/status).
```

## WebSocket

`ws(s)://<host>/ws`. Every message is an envelope:

```json
{ "event": "vehicle.status.updated", "data": { … }, "ts": 1791139792248 }
```

| Event | `data` |
| --- | --- |
| `vehicle.location.updated` | `GPSFix` |
| `vehicle.status.updated` | `{ vehicleId, previousStatus, status, vehicle: Vehicle, reason? }` |
| `vehicle.entered.parking` | `{ vehicleId, bayId, session: ParkingSession }` |
| `vehicle.left.parking` | `{ vehicleId, bayId, session: ParkingSession }` |
| `trip.created` | `{ trip: Trip, booking: Booking }` |
| `trip.started` | `{ trip: Trip }` |
| `trip.completed` | `{ trip: Trip }` |
| `driver.assigned` | `{ driverId, vehicleId, tripId }` |
| `alert.created` | `{ alert: Alert }` |
| `alert.resolved` *(supplementary)* | `{ alert: Alert }` |
| `booking.created` / `booking.updated` *(supplementary)* | `{ booking: Booking }` |
| `vehicle.updated` *(supplementary)* | `{ vehicle: Vehicle }`, for non-status changes such as a driver going on a break |

Client behaviour (`WebSocketRealtimeClient`):

- Reconnects with exponential backoff (0.5 s → 30 s).
- Services re-sync full REST snapshots every 15 s, so a missed message heals itself.

## GPS

`GPSProvider` (`src/providers/gps/GPSProvider.ts`) is the only source of positions:

```ts
interface GPSProvider {
  start(): Promise<void>; stop(): void;
  onFix(handler: (fix: GPSFix) => void): Unsubscribe;
  latest(): Promise<GPSFix[]>;               // bootstrap
  history(vehicleId: string): Promise<GPSFix[]>;
}
```

- `MockGPSProvider` (prototype) reads simulated telematics: every 2 s while moving, every 8 s while stationary, with occasional dropouts.
- `ZenCabsGPSProvider` (LIVE) reads `vehicle.location.updated` from the backend and bootstraps from `GET /api/gps/latest`. It also normalises vendor payloads (`lat`/`lon`, ISO timestamps, `course`).

`gpsService` turns discrete fixes into smooth motion. It renders slightly in the past (about 1.2 × the observed fix interval) and interpolates between the two fixes around that time. Real GPS at 5–10 s intervals works without any change.

### Parking detection in production

In the prototype, `vehicle.entered.parking` is emitted when a car arrives in its bay. In production it should come from one of these, written into `parking_sessions.entry_source`:

- a geofence around the lot plus a bay assignment by the driver app or an operator
- bay sensors or ANPR at the gate

The 3D twin snaps parked cars to their bay pose (GPS is not bay-accurate) and switches back to GPS as soon as the car moves.
