import { describe, expect, it } from 'vitest';
import type { Clock } from '../../core/clock';
import { SimulationEngine } from '../SimulationEngine';
import { loadMapDataSync } from '../world/loadMapNode';

const map = loadMapDataSync();
import { createMockRouter } from '../mockRouter';
import { buildWorld } from '../world/jammuMap';
import { toScene } from '../../core/geo';

class ManualClock implements Clock {
  speed = 1;
  constructor(public t: number) {}
  now() {
    return this.t;
  }
  setSpeed() {}
  sync() {}
}

function run(engine: SimulationEngine, clock: ManualClock, ms: number, step = 500) {
  for (let t = 0; t < ms; t += step) {
    clock.t += step;
    engine.tick();
  }
}

describe('Jammu map', () => {
  it('is a real, connected road network with landmarks on it', () => {
    const { network, zones } = buildWorld(map);
    expect(network.nodes.length).toBeGreaterThan(10_000);
    const ids = new Set(network.nodes.map((n) => n.nodeId));
    for (const e of network.edges) expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
    for (const l of network.landmarks) expect(ids.has(l.nodeId)).toBe(true);
    expect(network.edges.some((e) => e.bridge)).toBe(true); // Tawi bridges
    expect(network.edges.some((e) => e.name === 'Residency Road')).toBe(true);
    expect(zones.find((z) => z.name === 'Jammu Airport')).toBeTruthy();
    // The base gate is wired into the routable network.
    expect(network.edges.find((e) => e.from === 'BASE_GATE')?.routable).toBe(true);
  });
});

describe('SimulationEngine', () => {
  it('seeds 40 vehicles with the expected operating mix', () => {
    const clock = new ManualClock(Date.parse('2026-10-04T12:00:00Z'));
    const engine = new SimulationEngine({ clock, map });
    const status = engine.getFleetStatus();
    expect(status.totalFleet).toBe(40);
    expect(status.maintenance).toBe(2);
    expect(status.offline).toBe(2);
    expect(status.onTrip).toBeGreaterThanOrEqual(14);
    expect(status.parkedOverOneHour).toBeGreaterThanOrEqual(4);
    expect(engine.layout.bays.filter((b) => b.kind !== 'SERVICE')).toHaveLength(40);
  });

  it('keeps parking, trips and positions consistent over 3 simulated hours', () => {
    const clock = new ManualClock(Date.parse('2026-10-04T12:00:00Z'));
    const engine = new SimulationEngine({ clock, map, seed: 11 });
    const events: Record<string, number> = {};
    engine.events.on('trip.completed', () => (events.completed = (events.completed ?? 0) + 1));
    engine.events.on('vehicle.entered.parking', () => (events.entered = (events.entered ?? 0) + 1));
    engine.events.on('vehicle.left.parking', () => (events.left = (events.left ?? 0) + 1));
    engine.events.on('trip.created', () => (events.created = (events.created ?? 0) + 1));
    let fixes = 0;
    engine.gpsFeed.on('fix', () => fixes++);

    for (let hour = 0; hour < 3; hour++) {
      run(engine, clock, 3_600_000);
      const vehicles = engine.getVehicles();
      const bays = engine.getParking();
      // No bay holds two vehicles and every parked vehicle is in its bay.
      const occupants = bays.filter((b) => b.vehicleId).map((b) => b.vehicleId);
      expect(new Set(occupants).size).toBe(occupants.length);
      for (const v of vehicles) {
        if (v.parkingBay) expect(bays.find((b) => b.bay.bayId === v.parkingBay)?.vehicleId).toBe(v.vehicleId);
        const p = toScene(v.latitude, v.longitude);
        // Within the Jammu region bbox (~35 × 41 km around the city centre).
        expect(Math.abs(p.x)).toBeLessThan(25_000);
        expect(Math.abs(p.z)).toBeLessThan(25_000);
        if (v.status === 'ON_TRIP') expect(v.currentTripId).toBeTruthy();
      }
      const s = engine.getFleetStatus();
      // The fleet stays busy but not saturated.
      expect(s.byStatus.ON_TRIP + s.byStatus.EN_ROUTE_PICKUP + s.byStatus.WAITING).toBeGreaterThan(6);
    }
    expect(events.completed).toBeGreaterThan(60);
    expect(events.created).toBeGreaterThan(60);
    expect(events.entered).toBeGreaterThan(5);
    expect(events.left).toBeGreaterThan(5);
    expect(fixes).toBeGreaterThan(10_000);
  }, 60_000);

  it('serves the REST contract and dispatches the nearest suitable vehicle', () => {
    const clock = new ManualClock(Date.parse('2026-10-04T12:00:00Z'));
    const engine = new SimulationEngine({ clock, map });
    const handle = createMockRouter(engine);
    const q = new URLSearchParams();
    expect((handle({ method: 'GET', path: '/api/vehicles', query: q }) as unknown[]).length).toBe(40);
    expect(handle({ method: 'GET', path: '/api/vehicles/ZEN-001', query: q })).toHaveProperty('registrationNumber');
    expect((handle({ method: 'GET', path: '/api/parking', query: q }) as unknown[]).length).toBe(42);
    const airport = engine.network.landmarks.find((l) => l.name === 'Jammu Airport')!;
    const railway = engine.network.landmarks.find((l) => l.name.includes('Railway'))!;
    const preview: any = handle({ method: 'POST', path: '/api/dispatch', query: q, body: { pickup: airport, destination: railway, dryRun: true } });
    expect(preview.assigned).toBe(false);
    expect(preview.recommended).toBeTruthy();
    const result: any = handle({ method: 'POST', path: '/api/dispatch', query: q, body: { pickup: airport, destination: railway } });
    expect(result.assigned).toBe(true);
    const v: any = handle({ method: 'GET', path: `/api/vehicles/${result.recommended.vehicleId}`, query: q });
    expect(['ASSIGNED', 'EN_ROUTE_PICKUP']).toContain(v.status);
    // Full lifecycle: the assigned vehicle eventually completes the trip.
    const seen = new Set<string>();
    for (let i = 0; i < 5400 && !seen.has('COMPLETED'); i++) {
      run(engine, clock, 1000);
      const trip: any = handle({ method: 'GET', path: `/api/trips/${result.trip.tripId}`, query: q });
      seen.add(trip.status);
    }
    expect([...seen]).toEqual(expect.arrayContaining(['DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED']));
  }, 60_000);
});
