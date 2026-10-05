/**
 * Real Jammu road network for the simulation (prototype "demo on the real map").
 *
 * Source: public/maps/jammu-map.json, produced by scripts/build_jammu_map.py from
 * Overture Maps (OpenStreetMap roads, Google / Microsoft / OSM buildings).
 * Data © OpenStreetMap contributors (ODbL) and the other listed providers.
 */
import { fromScene, toScene } from '../../core/geo';
import type { Landmark, MapArea, MapEdge, MapLine, MapNetwork, MapNode, RoadClass } from '../../contracts/map';
import type { LatLng, Zone } from '../../contracts/types';

/** Shape of public/maps/jammu-map.json (compact on-disk format). */
export interface RawMapData {
  name: string;
  attribution: string;
  origin: [number, number];
  bbox: [number, number, number, number];
  nodes: number[];
  names: string[];
  edges: [number, number, RoadClass, number, number, number[]][];
  areas: { kind: MapArea['kind']; ring: number[] }[];
  lines: { kind: MapLine['kind']; width: number; name: string; pts: number[] }[];
  landmarks: { id: string; name: string; kind: Landmark['kind']; lat: number; lng: number; radius: number; demand: number }[];
  buildings: { url: string; count: number };
}

export const MAP_DATA_URL = '/maps/jammu-map.json';

/** Browser loader (the Node server and tests use loadMapDataFromFile). */
export async function fetchMapData(url = MAP_DATA_URL): Promise<RawMapData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load map data from ${url} (${res.status})`);
  return res.json();
}

export interface World {
  network: MapNetwork;
  zones: Zone[];
  /** Zone demand weights (relative ride-request rate). */
  demand: Record<string, number>;
  /** South-west corner of the ZenCabs base lot, scene metres. */
  lotSW: { x: number; z: number };
  /** Road node the base gate connects to. */
  baseRoadNode: string;
}

/** Where to look for the base lot. Replace with the real depot address when known. */
export const BASE_ANCHOR: LatLng = { lat: 32.7035, lng: 74.8615 }; // Gandhi Nagar
const LOT_W = 50;
const LOT_D = 64;

const ZONE_KIND: Record<Landmark['kind'], Zone['kind']> = {
  AIRPORT: 'AIRPORT',
  RAIL: 'RAIL',
  BUS: 'BUS',
  TEMPLE: 'TEMPLE',
  FORT: 'TEMPLE',
  HOSPITAL: 'HOSPITAL',
  MALL: 'COMMERCIAL',
  UNIVERSITY: 'RESIDENTIAL',
  TOWN: 'RESIDENTIAL',
  BASE: 'BASE',
};

const cache = new WeakMap<RawMapData, World>();

export function buildWorld(raw: RawMapData): World {
  const hit = cache.get(raw);
  if (hit) return hit;

  const nodeCount = raw.nodes.length / 2;
  const nodes: MapNode[] = [];
  const scene: { x: number; z: number }[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const lng = raw.nodes[i * 2];
    const lat = raw.nodes[i * 2 + 1];
    nodes.push({ nodeId: `N${i}`, lat, lng });
    scene.push(toScene(lat, lng));
  }

  const edges: MapEdge[] = raw.edges.map(([a, b, cls, nameIdx, flags, interior], i) => {
    const coords = [raw.nodes[a * 2], raw.nodes[a * 2 + 1], ...interior, raw.nodes[b * 2], raw.nodes[b * 2 + 1]];
    return {
      edgeId: `E${i}`,
      from: `N${a}`,
      to: `N${b}`,
      roadClass: cls,
      name: raw.names[nameIdx] ?? '',
      lengthM: polylineLength(coords),
      coords,
      bridge: (flags & 1) === 1,
      routable: (flags & 2) === 2,
    };
  });

  // ── Base lot: nearest spot beside a real street near the anchor with no roads/water inside.
  const anchor = toScene(BASE_ANCHOR.lat, BASE_ANCHOR.lng);
  const nearby = edges.filter((e) => {
    const p = toScene(e.coords[1], e.coords[0]);
    return Math.hypot(p.x - anchor.x, p.z - anchor.z) < 2500;
  });
  const nearbyScene = nearby.map((e) => toScenePts(e.coords));
  const water = raw.areas.filter((a) => a.kind === 'WATER').map((a) => toScenePts(a.ring));
  const candidates = new Map<number, number>(); // node index → distance
  for (const e of nearby) {
    if (!e.routable || (e.roadClass !== 'TERTIARY' && e.roadClass !== 'SECONDARY' && e.roadClass !== 'RESIDENTIAL')) continue;
    for (const id of [e.from, e.to]) {
      const idx = Number(id.slice(1));
      const p = scene[idx];
      candidates.set(idx, Math.hypot(p.x - anchor.x, p.z - anchor.z));
    }
  }
  let baseIdx = -1;
  for (const [idx] of [...candidates].sort((a, b) => a[1] - b[1])) {
    const p = scene[idx];
    const rect = { x0: p.x - 10, x1: p.x + LOT_W - 2, z0: p.z - (LOT_D + 20), z1: p.z - 9 };
    if (nearbyScene.some((pts) => polylineHitsRect(pts, rect))) continue;
    if (water.some((pts) => pts.some((q) => q.x > rect.x0 - 20 && q.x < rect.x1 + 20 && q.z > rect.z0 - 20 && q.z < rect.z1 + 20))) continue;
    baseIdx = idx;
    break;
  }
  if (baseIdx < 0) baseIdx = [...candidates].sort((a, b) => a[1] - b[1])[0][0];
  const road = scene[baseIdx];
  const lotSW = { x: road.x - 6, z: road.z - 16 };
  const gate = { x: road.x, z: road.z - 12 };
  const gateLL = fromScene(gate.x, gate.z);
  nodes.push({ nodeId: 'BASE_GATE', lat: gateLL.lat, lng: gateLL.lng });
  edges.push({
    edgeId: 'E-base',
    from: 'BASE_GATE',
    to: `N${baseIdx}`,
    roadClass: 'ACCESS',
    name: 'ZenCabs Base access',
    lengthM: 12,
    coords: [gateLL.lng, gateLL.lat, raw.nodes[baseIdx * 2], raw.nodes[baseIdx * 2 + 1]],
    bridge: false,
    routable: true,
  });

  // ── Zones + landmarks (snapped to the nearest routable node).
  const routableNodes = new Set<number>();
  for (const e of edges) {
    if (!e.routable || e.from === 'BASE_GATE') continue;
    routableNodes.add(Number(e.from.slice(1)));
    routableNodes.add(Number(e.to.slice(1)));
  }
  const nearestNode = (lat: number, lng: number) => {
    const p = toScene(lat, lng);
    let best = -1;
    let bd = Infinity;
    for (const i of routableNodes) {
      const d = (scene[i].x - p.x) ** 2 + (scene[i].z - p.z) ** 2;
      if (d < bd) (bd = d), (best = i);
    }
    return best;
  };

  const zones: Zone[] = raw.landmarks.map((l) => ({
    zoneId: `Z-${l.id}`,
    name: l.name,
    center: { lat: l.lat, lng: l.lng },
    radiusM: l.radius,
    kind: ZONE_KIND[l.kind],
  }));
  const lotCenter = fromScene(lotSW.x + LOT_W / 2, lotSW.z - LOT_D / 2);
  zones.push({ zoneId: 'Z-base', name: 'ZenCabs Base', center: lotCenter, radiusM: 160, kind: 'BASE' });
  const demand = Object.fromEntries(raw.landmarks.map((l) => [`Z-${l.id}`, l.demand]));

  const landmarks: Landmark[] = raw.landmarks.map((l) => {
    const idx = nearestNode(l.lat, l.lng);
    return { landmarkId: `L-${l.id}`, name: l.name, kind: l.kind, zoneId: `Z-${l.id}`, nodeId: `N${idx}`, lat: raw.nodes[idx * 2 + 1], lng: raw.nodes[idx * 2] };
  });
  landmarks.push({ landmarkId: 'L-base', name: 'ZenCabs Base', kind: 'BASE', zoneId: 'Z-base', nodeId: 'BASE_GATE', ...gateLL });

  const [w, s, e, n] = raw.bbox;
  const network: MapNetwork = {
    name: raw.name,
    attribution: raw.attribution,
    nodes,
    edges,
    areas: raw.areas.map((a) => ({ kind: a.kind, ring: a.ring })),
    lines: raw.lines.map((l) => ({ kind: l.kind, widthM: l.width, name: l.name, coords: l.pts })),
    landmarks,
    bounds: { sw: { lat: s, lng: w }, ne: { lat: n, lng: e } },
    buildings: raw.buildings,
  };
  const world: World = { network, zones, demand, lotSW, baseRoadNode: `N${baseIdx}` };
  cache.set(raw, world);
  return world;
}

function toScenePts(coords: number[]) {
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < coords.length; i += 2) out.push(toScene(coords[i + 1], coords[i]));
  return out;
}

function polylineLength(coords: number[]) {
  const pts = toScenePts(coords);
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return s;
}

function polylineHitsRect(pts: { x: number; z: number }[], r: { x0: number; x1: number; z0: number; z1: number }) {
  const inside = (p: { x: number; z: number }) => p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1;
  for (let i = 0; i < pts.length; i++) {
    if (inside(pts[i])) return true;
    if (i > 0) {
      // sample the segment so long straight roads crossing the rect are caught
      const a = pts[i - 1];
      const b = pts[i];
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 4);
      for (let k = 1; k < steps; k++) if (inside({ x: a.x + ((b.x - a.x) * k) / steps, z: a.z + ((b.z - a.z) * k) / steps })) return true;
    }
  }
  return false;
}
