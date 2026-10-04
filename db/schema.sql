-- ============================================================================
-- ZenCabs Fleet Command Center — production database schema (PostgreSQL 15+)
--
-- Not used by the prototype (which runs on the in-browser simulation), but the
-- frontend contracts in src/contracts/*.ts map 1:1 onto these tables, so the
-- REST/WebSocket layer can be implemented as straightforward queries.
--
-- PostGIS is optional: if it is installed, the block at the end adds geography
-- columns + GiST indexes for spatial queries (nearest vehicle, zone membership).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;      -- gen_random_uuid() (built in on PG13+, harmless)

-- ───────────────────────────── enums
CREATE TYPE vehicle_status     AS ENUM ('AVAILABLE','ASSIGNED','EN_ROUTE_PICKUP','WAITING','ON_TRIP','RETURNING_TO_BASE','MAINTENANCE','OFFLINE');
CREATE TYPE vehicle_type       AS ENUM ('SEDAN','SUV','EV_SEDAN','HATCHBACK');
CREATE TYPE fuel_kind          AS ENUM ('PETROL','DIESEL','CNG','ELECTRIC');
CREATE TYPE maintenance_state  AS ENUM ('OK','DUE_SOON','OVERDUE','IN_SERVICE');
CREATE TYPE driver_shift_state AS ENUM ('ON_SHIFT','ON_BREAK','OFF_SHIFT');
CREATE TYPE trip_status        AS ENUM ('REQUESTED','ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS','COMPLETED','CANCELLED');
CREATE TYPE booking_status     AS ENUM ('PENDING','DISPATCHED','FULFILLED','CANCELLED','UNSERVED');
CREATE TYPE booking_channel    AS ENUM ('APP','CALL_CENTER','WALK_IN','CORPORATE');
CREATE TYPE bay_kind           AS ENUM ('STANDARD','EV_CHARGING','SERVICE');
CREATE TYPE alert_severity     AS ENUM ('INFO','WARNING','CRITICAL');
CREATE TYPE alert_type         AS ENUM ('EXCESSIVE_IDLE','GPS_STALE','LOW_BATTERY','LOW_FUEL','MAINTENANCE_DUE','OVERSPEED','LONG_WAIT_AT_PICKUP','UNSERVED_DEMAND','VEHICLE_OFFLINE');

-- ───────────────────────────── reference: zones and parking facilities
CREATE TABLE zones (
    zone_id      TEXT PRIMARY KEY,                      -- 'Z-airport'
    name         TEXT NOT NULL,
    kind         TEXT NOT NULL,                         -- AIRPORT | RAIL | MARKET | ...
    center_lat   DOUBLE PRECISION NOT NULL,
    center_lng   DOUBLE PRECISION NOT NULL,
    radius_m     INTEGER NOT NULL
);

CREATE TABLE parking_lots (
    lot_id       TEXT PRIMARY KEY,                      -- 'LOT-JMU-01'
    name         TEXT NOT NULL,
    origin_lat   DOUBLE PRECISION NOT NULL,             -- local frame origin (SW corner)
    origin_lng   DOUBLE PRECISION NOT NULL,
    bearing_deg  REAL NOT NULL DEFAULT 0,               -- rotation of local frame vs north
    width_m      REAL NOT NULL,
    depth_m      REAL NOT NULL,
    layout_json  JSONB NOT NULL DEFAULT '{}'::jsonb     -- aisles, gate, buildings (ParkingLotLayout)
);

CREATE TABLE parking_bays (
    bay_id       TEXT NOT NULL,                         -- 'A01'
    lot_id       TEXT NOT NULL REFERENCES parking_lots(lot_id) ON DELETE CASCADE,
    row_label    TEXT NOT NULL,
    local_x_m    REAL NOT NULL,
    local_y_m    REAL NOT NULL,
    rotation_deg REAL NOT NULL,
    width_m      REAL NOT NULL,
    length_m     REAL NOT NULL,
    kind         bay_kind NOT NULL DEFAULT 'STANDARD',
    active       BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (lot_id, bay_id)
);

-- ───────────────────────────── core entities
CREATE TABLE drivers (
    driver_id        TEXT PRIMARY KEY,                  -- 'DRV-114'
    full_name        TEXT NOT NULL,
    phone            TEXT NOT NULL UNIQUE,
    photo_url        TEXT,
    license_number   TEXT NOT NULL UNIQUE,
    rating           NUMERIC(3,2) CHECK (rating BETWEEN 0 AND 5),
    languages        TEXT[] NOT NULL DEFAULT '{}',
    joined_on        DATE NOT NULL,
    active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE vehicles (
    vehicle_id           TEXT PRIMARY KEY,              -- 'ZEN-014'
    registration_number  TEXT NOT NULL UNIQUE,          -- 'JK02AB1234'
    vehicle_type         vehicle_type NOT NULL,
    vehicle_model        TEXT NOT NULL,
    fuel_kind            fuel_kind NOT NULL,
    home_lot_id          TEXT REFERENCES parking_lots(lot_id),
    gps_device_id        TEXT UNIQUE,                   -- telematics unit / GPS vendor id
    odometer_km          INTEGER NOT NULL DEFAULT 0,
    maintenance_status   maintenance_state NOT NULL DEFAULT 'OK',
    -- Denormalised "current state" for fast fleet snapshots (GET /api/vehicles).
    -- History lives in vehicle_status_history / vehicle_locations.
    status               vehicle_status NOT NULL DEFAULT 'OFFLINE',
    current_driver_id    TEXT REFERENCES drivers(driver_id),
    current_trip_id      UUID,                          -- FK added after trips
    last_lat             DOUBLE PRECISION,
    last_lng             DOUBLE PRECISION,
    last_speed_kmh       REAL,
    last_heading_deg     REAL,
    last_gps_at          TIMESTAMPTZ,
    battery_pct          REAL CHECK (battery_pct BETWEEN 0 AND 100),
    fuel_pct             REAL CHECK (fuel_pct BETWEEN 0 AND 100),
    status_changed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX vehicles_status_idx ON vehicles(status);

CREATE TABLE driver_shifts (
    shift_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id        TEXT NOT NULL REFERENCES drivers(driver_id),
    vehicle_id       TEXT REFERENCES vehicles(vehicle_id),
    state            driver_shift_state NOT NULL DEFAULT 'ON_SHIFT',
    started_at       TIMESTAMPTZ NOT NULL,
    ended_at         TIMESTAMPTZ,
    break_minutes    INTEGER NOT NULL DEFAULT 0,
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);
-- At most one open shift per driver.
CREATE UNIQUE INDEX driver_shifts_open_uniq ON driver_shifts(driver_id) WHERE ended_at IS NULL;
CREATE INDEX driver_shifts_vehicle_idx ON driver_shifts(vehicle_id, started_at DESC);

-- ───────────────────────────── demand and trips
CREATE TABLE bookings (
    booking_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    channel                 booking_channel NOT NULL,
    customer_name           TEXT NOT NULL,
    customer_phone          TEXT,
    pickup_name             TEXT NOT NULL,
    pickup_lat              DOUBLE PRECISION NOT NULL,
    pickup_lng              DOUBLE PRECISION NOT NULL,
    pickup_zone_id          TEXT REFERENCES zones(zone_id),
    destination_name        TEXT NOT NULL,
    destination_lat         DOUBLE PRECISION NOT NULL,
    destination_lng         DOUBLE PRECISION NOT NULL,
    destination_zone_id     TEXT REFERENCES zones(zone_id),
    vehicle_type_preference vehicle_type,
    estimated_fare          NUMERIC(10,2),
    status                  booking_status NOT NULL DEFAULT 'PENDING',
    scheduled_for           TIMESTAMPTZ                -- NULL = ride now
);
CREATE INDEX bookings_pending_idx ON bookings(created_at) WHERE status = 'PENDING';
CREATE INDEX bookings_zone_time_idx ON bookings(pickup_zone_id, created_at DESC);

CREATE TABLE trips (
    trip_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id          UUID NOT NULL UNIQUE REFERENCES bookings(booking_id),
    vehicle_id          TEXT NOT NULL REFERENCES vehicles(vehicle_id),
    driver_id           TEXT NOT NULL REFERENCES drivers(driver_id),
    shift_id            UUID REFERENCES driver_shifts(shift_id),
    status              trip_status NOT NULL DEFAULT 'ASSIGNED',
    assigned_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    pickup_arrival_at   TIMESTAMPTZ,
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    cancelled_at        TIMESTAMPTZ,
    estimated_end_at    TIMESTAMPTZ,
    distance_km         NUMERIC(8,2),
    fare                NUMERIC(10,2),
    route_polyline      TEXT,                           -- encoded polyline of the planned route
    dispatch_score      REAL,                           -- recommendation score at assignment
    dispatch_reasons    TEXT[]
);
CREATE INDEX trips_vehicle_time_idx ON trips(vehicle_id, assigned_at DESC);
CREATE INDEX trips_active_idx ON trips(status) WHERE status NOT IN ('COMPLETED','CANCELLED');
-- A vehicle can only have one active trip at a time.
CREATE UNIQUE INDEX trips_one_active_per_vehicle ON trips(vehicle_id) WHERE status NOT IN ('COMPLETED','CANCELLED');

ALTER TABLE vehicles
    ADD CONSTRAINT vehicles_current_trip_fk FOREIGN KEY (current_trip_id) REFERENCES trips(trip_id);

-- ───────────────────────────── telemetry (high volume)
-- Partition monthly in production (PARTITION BY RANGE (recorded_at)); TimescaleDB also fits.
CREATE TABLE vehicle_locations (
    vehicle_id    TEXT NOT NULL REFERENCES vehicles(vehicle_id),
    recorded_at   TIMESTAMPTZ NOT NULL,                 -- device timestamp
    received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    lat           DOUBLE PRECISION NOT NULL,
    lng           DOUBLE PRECISION NOT NULL,
    speed_kmh     REAL,
    heading_deg   REAL,
    accuracy_m    REAL,
    source        TEXT NOT NULL DEFAULT 'VENDOR',       -- MOCK | ZENCABS | VENDOR
    trip_id       UUID REFERENCES trips(trip_id),
    PRIMARY KEY (vehicle_id, recorded_at)
);
CREATE INDEX vehicle_locations_time_idx ON vehicle_locations(recorded_at DESC);

CREATE TABLE vehicle_status_history (
    id             BIGSERIAL PRIMARY KEY,
    vehicle_id     TEXT NOT NULL REFERENCES vehicles(vehicle_id),
    from_status    vehicle_status,
    to_status      vehicle_status NOT NULL,
    changed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    trip_id        UUID REFERENCES trips(trip_id),
    changed_by     TEXT,                                -- 'system' | operator id | driver app
    reason         TEXT
);
CREATE INDEX vehicle_status_history_idx ON vehicle_status_history(vehicle_id, changed_at DESC);

-- ───────────────────────────── parking
CREATE TABLE parking_sessions (
    session_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id   TEXT NOT NULL REFERENCES vehicles(vehicle_id),
    lot_id       TEXT NOT NULL,
    bay_id       TEXT NOT NULL,
    entry_time   TIMESTAMPTZ NOT NULL,
    exit_time    TIMESTAMPTZ,
    entry_source TEXT NOT NULL DEFAULT 'GEOFENCE',      -- GEOFENCE | BAY_SENSOR | OPERATOR | DRIVER_APP
    FOREIGN KEY (lot_id, bay_id) REFERENCES parking_bays(lot_id, bay_id),
    CHECK (exit_time IS NULL OR exit_time >= entry_time)
);
-- One open session per vehicle, and one vehicle per bay.
CREATE UNIQUE INDEX parking_sessions_open_vehicle ON parking_sessions(vehicle_id) WHERE exit_time IS NULL;
CREATE UNIQUE INDEX parking_sessions_open_bay ON parking_sessions(lot_id, bay_id) WHERE exit_time IS NULL;
CREATE INDEX parking_sessions_entry_idx ON parking_sessions(entry_time DESC);

-- ───────────────────────────── maintenance
CREATE TABLE maintenance_records (
    record_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id     TEXT NOT NULL REFERENCES vehicles(vehicle_id),
    kind           TEXT NOT NULL,                       -- SERVICE | REPAIR | TYRES | INSPECTION | CHARGER
    description    TEXT,
    opened_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at      TIMESTAMPTZ,
    odometer_km    INTEGER,
    cost_inr       NUMERIC(10,2),
    vendor         TEXT,
    next_due_km    INTEGER,
    next_due_date  DATE
);
CREATE INDEX maintenance_records_vehicle_idx ON maintenance_records(vehicle_id, opened_at DESC);

-- ───────────────────────────── alerts and event log
CREATE TABLE alerts (
    alert_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type             alert_type NOT NULL,
    severity         alert_severity NOT NULL,
    vehicle_id       TEXT REFERENCES vehicles(vehicle_id),
    zone_id          TEXT REFERENCES zones(zone_id),
    message          TEXT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_at  TIMESTAMPTZ,
    acknowledged_by  TEXT,
    resolved_at      TIMESTAMPTZ,
    dedupe_key       TEXT NOT NULL                       -- e.g. 'GPS_STALE:ZEN-014'
);
-- Only one open alert per dedupe key.
CREATE UNIQUE INDEX alerts_open_dedupe ON alerts(dedupe_key) WHERE resolved_at IS NULL;
CREATE INDEX alerts_open_idx ON alerts(created_at DESC) WHERE resolved_at IS NULL;

-- Append-only log of every realtime event emitted (audit + replay for the WebSocket feed).
CREATE TABLE fleet_events (
    event_id     BIGSERIAL PRIMARY KEY,
    event_type   TEXT NOT NULL,                         -- 'vehicle.status.updated', 'trip.created', ...
    vehicle_id   TEXT REFERENCES vehicles(vehicle_id),
    trip_id      UUID REFERENCES trips(trip_id),
    driver_id    TEXT REFERENCES drivers(driver_id),
    payload      JSONB NOT NULL,
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX fleet_events_time_idx ON fleet_events(occurred_at DESC);
CREATE INDEX fleet_events_vehicle_idx ON fleet_events(vehicle_id, occurred_at DESC);

-- ───────────────────────────── read models used by the API
-- GET /api/parking  (ParkingBayState[])
CREATE VIEW v_parking_state AS
SELECT b.lot_id, b.bay_id, b.kind, s.vehicle_id, s.entry_time,
       EXTRACT(EPOCH FROM (now() - s.entry_time)) * 1000 AS parking_duration_ms
FROM parking_bays b
LEFT JOIN parking_sessions s ON s.lot_id = b.lot_id AND s.bay_id = b.bay_id AND s.exit_time IS NULL;

-- GET /api/vehicles (Vehicle[]) — today's aggregates joined onto current state.
CREATE VIEW v_vehicle_today AS
SELECT v.*,
       d.full_name AS driver_name, d.phone AS driver_phone, d.photo_url AS driver_photo,
       ps.bay_id AS parking_bay, ps.entry_time AS parking_entry_time,
       COALESCE(t.trips_today, 0)    AS trips_today,
       COALESCE(t.revenue_today, 0)  AS revenue_today,
       COALESCE(t.distance_today, 0) AS distance_today
FROM vehicles v
LEFT JOIN drivers d ON d.driver_id = v.current_driver_id
LEFT JOIN parking_sessions ps ON ps.vehicle_id = v.vehicle_id AND ps.exit_time IS NULL
LEFT JOIN LATERAL (
    SELECT COUNT(*) AS trips_today, SUM(fare) AS revenue_today, SUM(distance_km) AS distance_today
    FROM trips
    WHERE trips.vehicle_id = v.vehicle_id
      AND trips.status = 'COMPLETED'
      AND trips.completed_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'
) t ON TRUE;

-- ───────────────────────────── optional PostGIS enrichment
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'postgis') THEN
        CREATE EXTENSION IF NOT EXISTS postgis;
        ALTER TABLE zones ADD COLUMN IF NOT EXISTS geom geography(Polygon, 4326);
        ALTER TABLE vehicle_locations ADD COLUMN IF NOT EXISTS geom geography(Point, 4326)
            GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) STORED;
        CREATE INDEX IF NOT EXISTS vehicle_locations_geom_idx ON vehicle_locations USING GIST (geom);
        CREATE INDEX IF NOT EXISTS vehicles_last_pos_idx ON vehicles
            USING GIST ((ST_SetSRID(ST_MakePoint(last_lng, last_lat), 4326)::geography));
    END IF;
END $$;
