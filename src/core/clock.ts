/**
 * Operational clock. Everything time-based (parking durations, "last GPS 4 sec ago",
 * GPS interpolation) reads `clock.now()` instead of Date.now().
 *
 * - MOCK mode: a simulation clock that can run faster than real time.
 * - LIVE mode: wall clock corrected by the server time offset.
 */
export interface Clock {
  now(): number;
  readonly speed: number;
  setSpeed(speed: number): void;
  /** Align with an authoritative server timestamp (LIVE mode). */
  sync(serverTime: number): void;
}

export class SimClock implements Clock {
  private base: number;
  private realBase: number;
  speed: number;
  private paused = false;

  constructor(start = Date.now(), speed = 1) {
    this.base = start;
    this.realBase = SimClock.real();
    this.speed = speed;
  }

  private static real(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  now(): number {
    if (this.paused) return Math.floor(this.base);
    return Math.floor(this.base + (SimClock.real() - this.realBase) * this.speed);
  }

  setSpeed(speed: number) {
    this.base = this.now();
    this.realBase = SimClock.real();
    this.speed = speed;
    this.paused = speed === 0;
  }

  sync(serverTime: number) {
    this.base = serverTime;
    this.realBase = SimClock.real();
  }
}

export class WallClock implements Clock {
  private offset = 0;
  readonly speed = 1;
  now() {
    return Date.now() + this.offset;
  }
  setSpeed() {
    /* real time cannot be accelerated */
  }
  sync(serverTime: number) {
    this.offset = serverTime - Date.now();
  }
}
