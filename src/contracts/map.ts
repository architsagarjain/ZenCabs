/**
 * Map / geography payload (GET /api/map/network).
 *
 * Built from real data for Jammu and neighbouring towns: OpenStreetMap roads +
 * Google / Microsoft / OSM building footprints, packaged by Overture Maps
 * (see scripts/build_jammu_map.py). The simulation drives on this graph and the
 * 3D scene renders it. Vehicles are positioned purely by lat/lng, so the fleet
 * layer does not depend on it.
 *
 * Polylines use flat GeoJSON-order arrays: [lng, lat, lng, lat, …].
 */
import type { LatLng } from './types';

export type RoadClass = 'TRUNK' | 'PRIMARY' | 'SECONDARY' | 'TERTIARY' | 'RESIDENTIAL' | 'SERVICE' | 'ACCESS';

export interface MapNode extends LatLng {
  nodeId: string;
}

export interface MapEdge {
  edgeId: string;
  from: string;
  to: string;
  roadClass: RoadClass;
  name: string;
  lengthM: number;
  /** Full polyline from `from` to `to`, flat [lng, lat, …]. */
  coords: number[];
  bridge: boolean;
  /** Part of the main connected network (used for routing). */
  routable: boolean;
}

export type AreaKind = 'WATER' | 'PARK' | 'MILITARY' | 'INSTITUTION' | 'INDUSTRIAL';
export type LineKind = 'WATER' | 'RAIL' | 'TAXIWAY';

export interface MapArea {
  kind: AreaKind;
  ring: number[];
}

export interface MapLine {
  kind: LineKind;
  widthM: number;
  name: string;
  coords: number[];
}

export interface Landmark extends LatLng {
  landmarkId: string;
  name: string;
  kind: 'AIRPORT' | 'RAIL' | 'BUS' | 'TEMPLE' | 'HOSPITAL' | 'MALL' | 'FORT' | 'UNIVERSITY' | 'TOWN' | 'BASE';
  zoneId: string | null;
  nodeId: string;
}

export interface MapNetwork {
  name: string;
  attribution: string;
  nodes: MapNode[];
  edges: MapEdge[];
  areas: MapArea[];
  lines: MapLine[];
  landmarks: Landmark[];
  bounds: { sw: LatLng; ne: LatLng };
  /** Binary building footprints (see scripts/build_jammu_map.py for the record format). */
  buildings: { url: string; count: number };
}
