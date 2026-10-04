import { API } from '../contracts/api';
import type { MapNetwork } from '../contracts/map';
import type { Zone } from '../contracts/types';
import type { ApiClient } from '../transport/ApiClient';
import { toScene } from '../core/geo';

/**
 * City geography for the 3D basemap and place pickers. In production this can
 * be sourced from OSM / Mapbox vector tiles instead of /api/map/network.
 */
export class MapService {
  network!: MapNetwork;
  zones: Zone[] = [];

  constructor(private api: ApiClient) {}

  async init() {
    [this.network, this.zones] = await Promise.all([this.api.get<MapNetwork>(API.mapNetwork), this.api.get<Zone[]>(API.zones)]);
  }

  zone(zoneId: string | null | undefined) {
    return this.zones.find((z) => z.zoneId === zoneId);
  }

  /** Named pickup/drop points operators can choose from. */
  places() {
    return this.network.landmarks.map((l) => ({ name: l.name, lat: l.lat, lng: l.lng, zoneId: l.zoneId ?? undefined }));
  }

  zoneOf(lat: number, lng: number): Zone | undefined {
    const p = toScene(lat, lng);
    let best: Zone | undefined;
    let bd = Infinity;
    for (const z of this.zones) {
      const c = toScene(z.center.lat, z.center.lng);
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d < z.radiusM && d < bd) (bd = d), (best = z);
    }
    return best;
  }
}
