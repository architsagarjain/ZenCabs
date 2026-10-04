import type { Clock } from '../core/clock';
import { Emitter, type Unsubscribe } from '../core/emitter';
import { toScene } from '../core/geo';
import type { GPSFix } from '../contracts/types';
import type { GPSProvider } from '../providers/gps/GPSProvider';

interface TrackPoint {
  t: number;
  x: number;
  z: number;
  heading: number;
  speed: number;
}

export interface SampledPose {
  x: number;
  z: number;
  heading: number;
  speed: number;
  /** Age of the newest fix at render time. */
  age: number;
}

/**
 * GPS service: owns per-vehicle fix buffers and turns discrete fixes into
 * smooth motion via entity interpolation (render slightly in the past and
 * interpolate between the two fixes that bracket render time).
 * Works identically for simulated and real fixes.
 */
export class GpsService {
  private tracks = new Map<string, TrackPoint[]>();
  private latestFix = new Map<string, GPSFix>();
  private intervalEma = 2000;
  private bus = new Emitter<{ fix: GPSFix }>();

  constructor(
    private provider: GPSProvider,
    private clock: Clock,
  ) {}

  get providerName() {
    return this.provider.name;
  }

  async init() {
    this.provider.onFix((fix) => this.ingest(fix));
    await this.provider.start();
    for (const fix of await this.provider.latest()) this.ingest(fix);
  }

  onFix(handler: (fix: GPSFix) => void): Unsubscribe {
    return this.bus.on('fix', handler);
  }

  private ingest(fix: GPSFix) {
    if (!isFinite(fix.latitude) || !isFinite(fix.longitude)) return;
    const prev = this.latestFix.get(fix.vehicleId);
    if (prev && fix.timestamp <= prev.timestamp) return; // out of order
    const p = toScene(fix.latitude, fix.longitude);
    let track = this.tracks.get(fix.vehicleId);
    if (!track) this.tracks.set(fix.vehicleId, (track = []));
    const last = track[track.length - 1];
    if (last && fix.speed > 0 && last.speed > 0) {
      const dt = fix.timestamp - last.t;
      if (dt > 0 && dt < 20_000) this.intervalEma = this.intervalEma * 0.95 + dt * 0.05;
    }
    track.push({ t: fix.timestamp, x: p.x, z: p.z, heading: fix.heading, speed: fix.speed });
    if (track.length > 24) track.splice(0, track.length - 24);
    this.latestFix.set(fix.vehicleId, fix);
    this.bus.emit('fix', fix);
  }

  /** How far behind "now" the scene renders positions, ms. */
  get renderDelay() {
    return Math.min(12_000, Math.max(400, this.intervalEma * 1.2));
  }

  latest(vehicleId: string): GPSFix | undefined {
    return this.latestFix.get(vehicleId);
  }

  /** Smoothed pose for rendering at the current clock time. */
  sample(vehicleId: string, now = this.clock.now()): SampledPose | null {
    const track = this.tracks.get(vehicleId);
    if (!track || !track.length) return null;
    const t = now - this.renderDelay;
    const newest = track[track.length - 1];
    if (t >= newest.t || track.length === 1) {
      return { x: newest.x, z: newest.z, heading: newest.heading, speed: newest.t > t - 4000 ? newest.speed : 0, age: now - newest.t };
    }
    let i = track.length - 2;
    while (i > 0 && track[i].t > t) i--;
    const a = track[i];
    const b = track[i + 1];
    if (t <= a.t) return { x: a.x, z: a.z, heading: a.heading, speed: a.speed, age: now - newest.t };
    const k = (t - a.t) / (b.t - a.t || 1);
    return {
      x: a.x + (b.x - a.x) * k,
      z: a.z + (b.z - a.z) * k,
      heading: lerpAngle(a.heading, b.heading, k),
      speed: a.speed + (b.speed - a.speed) * k,
      age: now - newest.t,
    };
  }

  history(vehicleId: string): Promise<GPSFix[]> {
    return this.provider.history(vehicleId);
  }
}

export function lerpAngle(a: number, b: number, t: number) {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}
