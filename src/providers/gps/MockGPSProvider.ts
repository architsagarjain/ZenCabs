import { Emitter, type Unsubscribe } from '../../core/emitter';
import type { GPSFix } from '../../contracts/types';
import type { GPSProvider } from './GPSProvider';

/** Anything that produces GPS fixes like a telematics feed — the simulation engine in the prototype. */
export interface MockTelematicsFeed {
  gpsFeed: { on(event: 'fix', handler: (fix: GPSFix) => void): Unsubscribe };
  getLatestFixes(): GPSFix[];
  getLocationHistory(vehicleId: string): GPSFix[];
}

/** Prototype GPS provider: reads simulated telematics fixes. */
export class MockGPSProvider implements GPSProvider {
  readonly name = 'MockGPSProvider';
  private bus = new Emitter<{ fix: GPSFix }>();
  private unsub: Unsubscribe | null = null;

  constructor(private feed: MockTelematicsFeed) {}

  async start() {
    this.unsub = this.feed.gpsFeed.on('fix', (fix) => this.bus.emit('fix', { ...fix }));
  }

  stop() {
    this.unsub?.();
    this.unsub = null;
  }

  onFix(handler: (fix: GPSFix) => void) {
    return this.bus.on('fix', handler);
  }

  async latest() {
    return this.feed.getLatestFixes().map((f) => ({ ...f }));
  }

  async history(vehicleId: string) {
    return this.feed.getLocationHistory(vehicleId).map((f) => ({ ...f }));
  }
}
