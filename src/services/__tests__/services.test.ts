import { describe, expect, it } from 'vitest';
import type { Clock } from '../../core/clock';
import { Emitter } from '../../core/emitter';
import { formatDuration, parkingIdleLevel } from '../../core/format';
import { fromScene, toScene } from '../../core/geo';
import type { GPSFix } from '../../contracts/types';
import type { GPSProvider } from '../../providers/gps/GPSProvider';
import { GpsService } from '../gpsService';
import { SimulationEngine } from '../../mock/SimulationEngine';
import { loadMapDataSync } from '../../mock/world/loadMapNode';

const map = loadMapDataSync();

class ManualClock implements Clock {
  speed = 1;
  constructor(public t: number) {}
  now() {
    return this.t;
  }
  setSpeed() {}
  sync() {}
}

class FakeProvider implements GPSProvider {
  name = 'fake';
  bus = new Emitter<{ fix: GPSFix }>();
  async start() {}
  stop() {}
  onFix(h: (f: GPSFix) => void) {
    return this.bus.on('fix', h);
  }
  async latest() {
    return [];
  }
  async history() {
    return [];
  }
  push(vehicleId: string, x: number, z: number, t: number, heading = 90) {
    const ll = fromScene(x, z);
    this.bus.emit('fix', { vehicleId, latitude: ll.lat, longitude: ll.lng, speed: 36, heading, accuracy: 5, timestamp: t, source: 'MOCK' });
  }
}

describe('geo projection', () => {
  it('round-trips scene metres through lat/lng', () => {
    const ll = fromScene(1234.5, -987.6);
    const p = toScene(ll.lat, ll.lng);
    expect(p.x).toBeCloseTo(1234.5, 3);
    expect(p.z).toBeCloseTo(-987.6, 3);
  });
});

describe('parking idle levels', () => {
  it('maps durations to the operational thresholds', () => {
    expect(parkingIdleLevel(18 * 60_000)).toBe('NORMAL');
    expect(parkingIdleLevel(45 * 60_000)).toBe('ATTENTION');
    expect(parkingIdleLevel(102 * 60_000)).toBe('WARNING');
    expect(parkingIdleLevel(256 * 60_000)).toBe('CRITICAL');
    expect(formatDuration(18 * 60_000)).toBe('18 min');
    expect(formatDuration((60 + 42) * 60_000)).toBe('1 hr 42 min');
    expect(formatDuration((4 * 60 + 16) * 60_000)).toBe('4 hr 16 min');
  });
});

describe('gpsService interpolation', () => {
  it('renders smoothly between fixes, slightly in the past', async () => {
    const clock = new ManualClock(100_000);
    const provider = new FakeProvider();
    const gps = new GpsService(provider, clock);
    await gps.init();
    for (let i = 0; i < 10; i++) provider.push('ZEN-001', i * 20, 0, 100_000 + i * 2000);
    clock.t = 100_000 + 9 * 2000; // newest fix just arrived
    const delay = gps.renderDelay;
    expect(delay).toBeGreaterThan(2000);
    const s = gps.sample('ZEN-001')!;
    // Expected position: linear between fixes at (now - delay).
    expect(s.x).toBeCloseTo(((clock.t - delay - 100_000) / 2000) * 20, 1);
    expect(s.z).toBeCloseTo(0, 3);
    // Out-of-order fixes are ignored.
    provider.push('ZEN-001', 9999, 9999, 100_000);
    expect(gps.latest('ZEN-001')!.timestamp).toBe(100_000 + 18_000);
  });
});

describe('telemetry behaviour', () => {
  it('offline vehicles never report GPS', () => {
    const clock = new ManualClock(Date.parse('2026-10-04T12:00:00Z'));
    const engine = new SimulationEngine({ clock, map });
    const offline = engine.getVehicles().filter((v) => v.status === 'OFFLINE').map((v) => v.vehicleId);
    expect(offline).toHaveLength(2);
    const seen = new Set<string>();
    engine.gpsFeed.on('fix', (f) => seen.add(f.vehicleId));
    for (let i = 0; i < 600; i++) {
      clock.t += 500;
      engine.tick();
    }
    for (const id of offline) expect(seen.has(id)).toBe(false);
    expect(seen.size).toBeGreaterThan(30);
  });
});
