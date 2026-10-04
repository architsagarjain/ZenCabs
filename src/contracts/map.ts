/**
 * Map / geography payload (GET /api/map/network).
 *
 * In the prototype this describes a fictional Jammu-like city that the
 * simulation drives on and the 3D scene renders. In production it can be
 * replaced by OSM/Mapbox-derived data; vehicles are positioned purely by
 * lat/lng so the fleet layer does not depend on it.
 */
import type { LatLng } from './types';

export type RoadClass = 'ARTERIAL' | 'LOCAL' | 'BRIDGE' | 'ACCESS';

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
}

export type BlockKind = 'URBAN' | 'DENSE' | 'PARK' | 'AIRPORT' | 'BASE' | 'RAIL' | 'CAMPUS';

export interface MapBlock {
  blockId: string;
  kind: BlockKind;
  /** Rectangle corners (south-west, north-east). */
  sw: LatLng;
  ne: LatLng;
  seed: number;
}

export interface Landmark extends LatLng {
  landmarkId: string;
  name: string;
  kind: 'AIRPORT' | 'RAIL' | 'BUS' | 'TEMPLE' | 'HOSPITAL' | 'MALL' | 'FORT' | 'UNIVERSITY' | 'BASE';
  zoneId: string | null;
  nodeId: string;
}

export interface MapNetwork {
  name: string;
  nodes: MapNode[];
  edges: MapEdge[];
  river: { name: string; widthM: number; points: LatLng[] };
  blocks: MapBlock[];
  landmarks: Landmark[];
  bounds: { sw: LatLng; ne: LatLng };
}
