import { Emitter, type Unsubscribe } from '../../core/emitter';
import { API } from '../../contracts/api';
import type { GPSFix } from '../../contracts/types';
import type { ApiClient } from '../../transport/ApiClient';
import type { RealtimeClient } from '../../transport/RealtimeClient';
import type { GPSProvider } from './GPSProvider';

/**
 * Production GPS provider: positions are relayed by the ZenCabs backend over
 * the realtime channel (`vehicle.location.updated`) and bootstrapped from
 * `GET /api/gps/latest`. If ZenCabs later talks to a GPS vendor directly from
 * the browser, implement another GPSProvider — nothing else changes.
 */
export class ZenCabsGPSProvider implements GPSProvider {
  readonly name = 'ZenCabsGPSProvider';
  private bus = new Emitter<{ fix: GPSFix }>();
  private unsub: Unsubscribe | null = null;

  constructor(
    private api: ApiClient,
    private realtime: RealtimeClient,
  ) {}

  async start() {
    this.unsub = this.realtime.on('vehicle.location.updated', (fix) => this.bus.emit('fix', normalize(fix)));
  }

  stop() {
    this.unsub?.();
    this.unsub = null;
  }

  onFix(handler: (fix: GPSFix) => void) {
    return this.bus.on('fix', handler);
  }

  async latest() {
    return (await this.api.get<GPSFix[]>(API.gpsLatest)).map(normalize);
  }

  async history(vehicleId: string) {
    return (await this.api.get<GPSFix[]>(API.vehicleLocations(vehicleId))).map(normalize);
  }
}

/** Defensive normalisation of vendor payloads (string numbers, ISO timestamps, missing heading). */
function normalize(raw: any): GPSFix {
  return {
    vehicleId: String(raw.vehicleId),
    latitude: Number(raw.latitude ?? raw.lat),
    longitude: Number(raw.longitude ?? raw.lng ?? raw.lon),
    speed: Number(raw.speed ?? 0),
    heading: Number(raw.heading ?? raw.course ?? 0),
    accuracy: Number(raw.accuracy ?? 10),
    timestamp: typeof raw.timestamp === 'string' ? Date.parse(raw.timestamp) : Number(raw.timestamp),
    source: raw.source ?? 'ZENCABS',
  };
}
