/**
 * Procedural, deterministic "Jammu-like" city used by the simulation.
 * Fictional geometry, real-world place names, real lat/lng projection.
 *
 * Everything is authored in scene meters (x east, z south) around GEO_ORIGIN and
 * exported as lat/lng so consumers never see the authoring frame.
 */
import { fromScene, toScene } from '../../core/geo';
import type { BlockKind, Landmark, MapBlock, MapEdge, MapNetwork, MapNode, RoadClass } from '../../contracts/map';
import type { Zone } from '../../contracts/types';

export const COLS = [-2200, -1880, -1590, -1300, -1020, -730, -430, -140, 150, 430, 720, 1010, 1300, 1610, 1900, 2200];
export const ROWS = [-1800, -1500, -1210, -930, -640, -350, -60, 230, 520, 810, 1100, 1390, 1680];

export const RIVER_POINTS = [
  [2600, -1300],
  [1700, -820],
  [1000, -560],
  [300, -300],
  [-300, -60],
  [-1000, 260],
  [-1700, 600],
  [-2600, 1000],
] as const;
export const RIVER_WIDTH = 110;
const BRIDGE_COLS = [-1590, -430, 720, 1610];

const ARTERIAL_COLS: Record<number, string> = {
  [-1590]: 'Airport Road',
  [-430]: 'Canal Road',
  [720]: 'Bikram Chowk Road',
  [1610]: 'Rail Head Road',
};
const ARTERIAL_ROWS: Record<number, string> = {
  [-1210]: 'Residency Road',
  [-640]: 'Vir Marg',
  [520]: 'Gandhi Nagar Main Road',
  [1100]: 'Trikuta Nagar Road',
};
const LOCAL_NAMES = ['Gali', 'Lane', 'Mohalla Road', 'Link Road', 'Marg'];

/** Lot placement (scene meters): south-west corner of the ZenCabs base lot. */
export const BASE_LOT_SW = { x: 210, z: 498 };
export const BASE_GATE_X = BASE_LOT_SW.x + 6;

export function distToRiver(x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < RIVER_POINTS.length - 1; i++) {
    best = Math.min(best, distToSegment(x, z, RIVER_POINTS[i][0], RIVER_POINTS[i][1], RIVER_POINTS[i + 1][0], RIVER_POINTS[i + 1][1]));
  }
  return best;
}

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function segmentsIntersect(a: number[], b: number[], c: readonly number[], d: readonly number[]) {
  const o = (p: readonly number[], q: readonly number[], r: readonly number[]) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

function crossesRiver(ax: number, az: number, bx: number, bz: number) {
  for (let i = 0; i < RIVER_POINTS.length - 1; i++) {
    if (segmentsIntersect([ax, az], [bx, bz], RIVER_POINTS[i], RIVER_POINTS[i + 1])) return true;
  }
  return false;
}

interface PlaceDef {
  id: string;
  name: string;
  kind: Landmark['kind'];
  zoneKind: Zone['kind'];
  x: number;
  z: number;
  radius: number;
}

/** Real Jammu place names at fictionalised positions (north of the Tawi = old city). */
export const PLACES: PlaceDef[] = [
  { id: 'airport', name: 'Jammu Airport', kind: 'AIRPORT', zoneKind: 'AIRPORT', x: -1590, z: 1100, radius: 420 },
  { id: 'railway', name: 'Jammu Tawi Railway Station', kind: 'RAIL', zoneKind: 'RAIL', x: 1300, z: 810, radius: 360 },
  { id: 'busstand', name: 'General Bus Stand', kind: 'BUS', zoneKind: 'BUS', x: 720, z: -930, radius: 320 },
  { id: 'raghunath', name: 'Raghunath Temple', kind: 'TEMPLE', zoneKind: 'TEMPLE', x: 150, z: -930, radius: 300 },
  { id: 'gmc', name: 'GMC Hospital', kind: 'HOSPITAL', zoneKind: 'HOSPITAL', x: -430, z: -1210, radius: 300 },
  { id: 'janipur', name: 'Janipur', kind: 'UNIVERSITY', zoneKind: 'RESIDENTIAL', x: -1300, z: -1210, radius: 420 },
  { id: 'gandhinagar', name: 'Gandhi Nagar', kind: 'MALL', zoneKind: 'COMMERCIAL', x: -140, z: 520, radius: 380 },
  { id: 'bahuplaza', name: 'Bahu Plaza', kind: 'MALL', zoneKind: 'COMMERCIAL', x: 1010, z: 230, radius: 340 },
  { id: 'bahufort', name: 'Bahu Fort', kind: 'FORT', zoneKind: 'TEMPLE', x: 1900, z: -60, radius: 320 },
  { id: 'trikuta', name: 'Trikuta Nagar', kind: 'MALL', zoneKind: 'RESIDENTIAL', x: 430, z: 1100, radius: 380 },
  { id: 'channi', name: 'Channi Himmat', kind: 'MALL', zoneKind: 'RESIDENTIAL', x: 1900, z: 1390, radius: 380 },
  { id: 'satwari', name: 'Satwari Chowk', kind: 'MALL', zoneKind: 'COMMERCIAL', x: -730, z: 1100, radius: 360 },
  { id: 'university', name: 'Jammu University', kind: 'UNIVERSITY', zoneKind: 'RESIDENTIAL', x: -1880, z: -350, radius: 380 },
  { id: 'talabtillo', name: 'Talab Tillo', kind: 'MALL', zoneKind: 'RESIDENTIAL', x: -730, z: -1500, radius: 360 },
];

const AIRPORT_CELLS = new Set(['0,9', '1,9', '2,9', '0,10', '1,10', '2,10', '0,11', '1,11', '2,11']);
const PARK_CELLS = new Set(['6,8', '9,4', '3,3', '12,10', '4,11', '13,6']);
const RAIL_CELLS = new Set(['12,8', '13,8', '12,9', '13,9']);
const CAMPUS_CELLS = new Set(['0,5', '1,5', '0,6']);

function cellKind(ci: number, ri: number): BlockKind {
  const key = `${ci},${ri}`;
  if (AIRPORT_CELLS.has(key)) return 'AIRPORT';
  if (RAIL_CELLS.has(key)) return 'RAIL';
  if (CAMPUS_CELLS.has(key)) return 'CAMPUS';
  if (PARK_CELLS.has(key)) return 'PARK';
  if (ci === 8 && ri === 7) return 'BASE';
  const cx = (COLS[ci] + COLS[ci + 1]) / 2;
  const cz = (ROWS[ri] + ROWS[ri + 1]) / 2;
  // Old city north of the river and the commercial core are denser.
  const northOfRiver = cz < -0.42 * cx - 140;
  if (northOfRiver && Math.abs(cx) < 1200 && cz > -1400) return 'DENSE';
  if (Math.hypot(cx - 400, cz - 300) < 700) return 'DENSE';
  return 'URBAN';
}

let cache: { network: MapNetwork; zones: Zone[] } | null = null;

export function buildCity(): { network: MapNetwork; zones: Zone[] } {
  if (cache) return cache;

  const nodes = new Map<string, { id: string; x: number; z: number }>();
  const edges: { a: string; b: string; cls: RoadClass; name: string }[] = [];
  const nid = (c: number, r: number) => `N${c}_${r}`;

  for (let c = 0; c < COLS.length; c++) {
    for (let r = 0; r < ROWS.length; r++) {
      const x = COLS[c];
      const z = ROWS[r];
      if (distToRiver(x, z) < RIVER_WIDTH / 2 + 14) continue;
      nodes.set(nid(c, r), { id: nid(c, r), x, z });
    }
  }

  const roadName = (isCol: boolean, value: number, idx: number) => {
    const art = isCol ? ARTERIAL_COLS[value] : ARTERIAL_ROWS[value];
    if (art) return { cls: 'ARTERIAL' as RoadClass, name: art };
    return { cls: 'LOCAL' as RoadClass, name: `${isCol ? 'Sector' : 'Ward'} ${idx + 1} ${LOCAL_NAMES[idx % LOCAL_NAMES.length]}` };
  };

  // Horizontal edges (along rows)
  for (let r = 0; r < ROWS.length; r++) {
    for (let c = 0; c < COLS.length - 1; c++) {
      const a = nodes.get(nid(c, r));
      const b = nodes.get(nid(c + 1, r));
      if (!a || !b) continue;
      if (crossesRiver(a.x, a.z, b.x, b.z)) continue;
      const { cls, name } = roadName(false, ROWS[r], r);
      edges.push({ a: a.id, b: b.id, cls, name });
    }
  }
  // Vertical edges (along columns), bridges where allowed
  for (let c = 0; c < COLS.length; c++) {
    for (let r = 0; r < ROWS.length - 1; r++) {
      const a = nodes.get(nid(c, r));
      const b = nodes.get(nid(c, r + 1));
      if (!a || !b) continue;
      const { cls, name } = roadName(true, COLS[c], c);
      if (crossesRiver(a.x, a.z, b.x, b.z)) {
        if (BRIDGE_COLS.includes(COLS[c])) edges.push({ a: a.id, b: b.id, cls: 'BRIDGE', name: `${name} Tawi Bridge` });
        continue;
      }
      edges.push({ a: a.id, b: b.id, cls, name });
    }
  }

  // Insert the base gate on Gandhi Nagar Main Road (row z=520) between cols 8 and 9.
  const gateRoad = { id: 'BASE_GATE', x: BASE_GATE_X, z: ROWS[8] };
  nodes.set(gateRoad.id, gateRoad);
  const idx = edges.findIndex((e) => e.a === nid(8, 8) && e.b === nid(9, 8));
  if (idx >= 0) {
    const e = edges[idx];
    edges.splice(idx, 1, { a: e.a, b: gateRoad.id, cls: e.cls, name: e.name }, { a: gateRoad.id, b: e.b, cls: e.cls, name: e.name });
  }

  // Keep only the component reachable from the base gate.
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push(e.b);
    (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push(e.a);
  }
  const seen = new Set<string>([gateRoad.id]);
  const stack = [gateRoad.id];
  while (stack.length) {
    const n = stack.pop()!;
    for (const m of adj.get(n) ?? []) if (!seen.has(m)) (seen.add(m), stack.push(m));
  }
  for (const id of [...nodes.keys()]) if (!seen.has(id)) nodes.delete(id);
  const keptEdges = edges.filter((e) => seen.has(e.a) && seen.has(e.b));

  const mapNodes: MapNode[] = [...nodes.values()].map((n) => ({ nodeId: n.id, ...fromScene(n.x, n.z) }));
  const mapEdges: MapEdge[] = keptEdges.map((e, i) => {
    const a = nodes.get(e.a)!;
    const b = nodes.get(e.b)!;
    return { edgeId: `E${i}`, from: e.a, to: e.b, roadClass: e.cls, name: e.name, lengthM: Math.hypot(a.x - b.x, a.z - b.z) };
  });

  const blocks: MapBlock[] = [];
  for (let c = 0; c < COLS.length - 1; c++) {
    for (let r = 0; r < ROWS.length - 1; r++) {
      blocks.push({
        blockId: `B${c}_${r}`,
        kind: cellKind(c, r),
        sw: fromScene(COLS[c], ROWS[r + 1]),
        ne: fromScene(COLS[c + 1], ROWS[r]),
        seed: c * 131 + r * 977 + 7,
      });
    }
  }

  const nearestNode = (x: number, z: number) => {
    let best = '';
    let bd = Infinity;
    for (const n of nodes.values()) {
      if (n.id === 'BASE_GATE') continue;
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bd) (bd = d), (best = n.id);
    }
    return best;
  };

  const zones: Zone[] = PLACES.map((p) => ({
    zoneId: `Z-${p.id}`,
    name: p.name,
    center: fromScene(p.x, p.z),
    radiusM: p.radius,
    kind: p.zoneKind,
  }));
  zones.push({ zoneId: 'Z-base', name: 'ZenCabs Base', center: fromScene(BASE_LOT_SW.x + 25, BASE_LOT_SW.z - 32), radiusM: 160, kind: 'BASE' });

  const landmarks: Landmark[] = PLACES.map((p) => {
    const nodeId = nearestNode(p.x, p.z);
    const n = nodes.get(nodeId)!;
    return { landmarkId: `L-${p.id}`, name: p.name, kind: p.kind, zoneId: `Z-${p.id}`, nodeId, ...fromScene(n.x, n.z) };
  });
  landmarks.push({ landmarkId: 'L-base', name: 'ZenCabs Base', kind: 'BASE', zoneId: 'Z-base', nodeId: 'BASE_GATE', ...fromScene(gateRoad.x, gateRoad.z) });

  const network: MapNetwork = {
    name: 'Jammu (simulated)',
    nodes: mapNodes,
    edges: mapEdges,
    river: { name: 'Tawi River', widthM: RIVER_WIDTH, points: RIVER_POINTS.map(([x, z]) => fromScene(x, z)) },
    blocks,
    landmarks,
    bounds: { sw: fromScene(COLS[0] - 300, ROWS[ROWS.length - 1] + 300), ne: fromScene(COLS[COLS.length - 1] + 300, ROWS[0] - 300) },
  };
  cache = { network, zones };
  return cache;
}

export function sceneOf(n: { lat: number; lng: number }) {
  return toScene(n.lat, n.lng);
}
