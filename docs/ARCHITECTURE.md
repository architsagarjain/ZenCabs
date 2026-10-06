# Architecture

## Goal

Build a polished Fleet Command Center demonstration now, using simulated data. Later, switch to real ZenCabs data **without rewriting the frontend**.

The rule that makes this possible: **the UI and 3D scene never touch mock data**. They read from services, and services read from transports. Only the transport changes between modes.

```
                 ┌──────────────────────── DATA_MODE = "MOCK" ────────────────────────┐
                 │  SimulationEngine (src/mock)                                       │
                 │    ├─ mockRouter ───────────▶ MockApiClient        (REST contract) │
                 │    ├─ events ───────────────▶ MockRealtimeClient   (WS contract)   │
                 │    └─ gpsFeed ──────────────▶ MockGPSProvider      (GPSProvider)   │
                 └────────────────────────────────────────────────────────────────────┘
                 ┌──────────────────────── DATA_MODE = "LIVE" ────────────────────────┐
                 │  ZenCabs backend           ─▶ HttpApiClient        (REST contract) │
                 │                            ─▶ WebSocketRealtime    (WS contract)   │
                 │  GPS relay / vendor        ─▶ ZenCabsGPSProvider   (GPSProvider)   │
                 └────────────────────────────────────────────────────────────────────┘
                                                   │
                                                   ▼
   services/  vehicleService · driverService · gpsService · bookingService · dispatchService
              parkingService · analyticsService · alertService · mapService
                                                   │
                         ┌─────────────────────────┴──────────────────────────┐
                         ▼                                                    ▼
          store/fleetStore (zustand, 4 Hz snapshots)          high-frequency reads in useFrame
                         │                                    (gpsService.sample, parkingService.bayPose)
                         ▼                                                    │
               ui/ (pages, drawer, dialogs)   ◀──────────────────▶  scene/ (three.js, R3F)
```

`src/services/index.ts` (`createServices`) is the **only** file that branches on `DATA_MODE`.

## Directory map

| Path | Responsibility |
| --- | --- |
| `src/config/dataConfig.ts` | `DATA_MODE`, endpoints, operational thresholds (parking idle levels, low revenue, …). |
| `src/config/theme.ts` | ZenCabs brand tokens (colours, gradient, fonts) and the daylight 3D palette. Every UI and scene colour comes from here. |
| `src/contracts/` | Domain types, REST paths, WebSocket events and map payload, shared by every layer and the server. |
| `src/core/` | Geo projection (lat/lng ↔ scene metres), clocks, emitter, formatting. |
| `src/transport/` | `ApiClient` (HTTP / mock) and `RealtimeClient` (WebSocket / mock). |
| `src/providers/gps/` | `GPSProvider` interface, `MockGPSProvider`, `ZenCabsGPSProvider`. |
| `src/services/` | Business-facing services consumed by the UI. |
| `src/store/` | UI state and throttled service snapshots. |
| `src/scene/` | 3D city, parking-lot digital twin, vehicles, overlays and camera. |
| `src/ui/` | DOM UI: app shell (sidebar, header, bottom nav), dashboard (KPIs, map card, action center, feed, trends), fleet/drivers/insights pages, vehicle drawer, command palette and dialogs. Responsive at 768 / 1024 / 1440 px. |
| `src/mock/` | Simulation engine, seed data, real-map loader (`world/jammuMap.ts`), parking layout and mock REST router. **UI never imports this.** |
| `scripts/` | Fetch + build the real Jammu map from Overture Maps (OpenStreetMap roads, building footprints). |
| `public/maps/` | Built map files: road graph JSON and building footprints binary. |
| `server/` | Reference backend serving the same contracts (proves LIVE mode works). |
| `db/schema.sql` | Production PostgreSQL schema. |

## Key design decisions

**Positions come only from GPS fixes.** Vehicles in the 3D scene are positioned from `gpsService.sample(vehicleId, now)`. That function interpolates lat/lng fixes projected with `core/geo.ts`. The simulation emits fixes the way a telematics unit would: every 2 s while moving, every 8 s while parked, with noise and occasional dropouts. Nothing else in the scene knows the simulation exists.

**Parked cars snap to their bay.** GPS is not accurate enough to show which bay a car is in. While a vehicle has a `parkingBay` and isn't moving, it renders at `parkingService.bayPose(bay)`. As soon as it moves, GPS takes over. The same logic works for real data.

**One clock abstraction.** Timers such as "Parked for 1 hr 42 min" and "Last GPS 4 sec ago", and the GPS interpolation, all read `clock.now()`:

- MOCK: `SimClock`, which supports 1×/3×/10×/20× time acceleration.
- LIVE: `WallClock`, synced from `serverTime`.

**Realtime plus snapshots.** Services apply realtime events immediately and also re-sync REST snapshots every 15 s. Older snapshots never overwrite fresher GPS positions (`lastGpsUpdate` guard).

**Render-rate isolation.** GPS fixes and 3D motion never go through React state. The store receives throttled snapshots (≤ 4 Hz). Per-frame work reads services directly inside `useFrame`.

**Visibility at every zoom level:**

- Cars scale up with camera distance.
- Far away, each car shows a status-coloured beacon that renders above buildings.
- Close up, the lot shows per-bay timers and idle colours.

## Going live: checklist

1. Implement the REST endpoints in `docs/API_CONTRACTS.md` against `db/schema.sql`. `server/index.ts` shows every route and its payload.
2. Publish the WebSocket envelopes listed in `src/contracts/events.ts`.
3. Choose the GPS path:
   - **Backend relays positions** → `ZenCabsGPSProvider` works as-is.
   - **Browser reads a vendor directly** → add `VendorGPSProvider implements GPSProvider` and select it in `createServices`.
4. Replace the parking layout. Serve the surveyed lot as `ParkingLotLayout` from `GET /api/parking/layout`: bays with local x/y/rotation, aisles, gate, and `origin` + `bearing` to place it on the map.
5. Basemap. `mapService` loads the real Jammu network (OpenStreetMap via Overture) from `/api/map/network` plus `public/maps/jammu-buildings.bin`. In production this can stay as a static asset, or move to vector tiles if the area grows.
6. Run with `VITE_DATA_MODE=LIVE VITE_API_BASE_URL=… VITE_WS_URL=…`.

No component in `src/ui` or `src/scene` needs to change.

## Simulation model (prototype only)

`src/mock/SimulationEngine.ts`:

- **City.** The real road network of Jammu and neighbouring towns from OpenStreetMap (via Overture Maps):
  - ~30,000 junctions and ~37,000 road links with real names and road classes (trunk to residential)
  - real Tawi bridges, the Ranbir Canal, parks and rail lines
  - 22 real places as demand zones, from Jammu Airport and Jammu Tawi Railway Station to Nagrota, Akhnoor, R.S. Pura, Bari Brahmana and Vijaypur
- **Driving.** Left-hand lanes along the real road geometry, with A* routing weighted by road-class speed (about 25 km/h average in city traffic). Cars slow on bends and may stop at junctions of major roads (signals). Inside the lot, cars follow the aisles and reverse out of bays.
- **Trips.** Mostly 1–4.5 km within the city, plus about 5% outstation rides to the neighbouring towns.
- **Demand.** Poisson ride requests per zone with drifting surges and airport "flight arrival" bursts. Requests auto-dispatch to the best-ranked vehicle after a short search window.
- **Lifecycle.** Driver acceptance delay, then drive to pickup, then a wait (occasionally long, which raises an alert), then the trip.
- **After a trip.** The car stays in the field, or returns to base when charge is low, by chance, or when idle too long.
- **Operational noise:**
  - GPS dropouts → `GPS_STALE`
  - speeding → `OVERSPEED`
  - drivers taking breaks
  - EV charging in EV bays
- **Seeded state at start:**
  - 2 vehicles in maintenance (service bays)
  - 2 offline: 1 parked for 5 hours, 1 stranded in the field
  - 11 parked for between 6 min and 4 hr 16 min
  - 16 on trips, 3 en route, 1 waiting, 2 returning, 3 idle in the field
