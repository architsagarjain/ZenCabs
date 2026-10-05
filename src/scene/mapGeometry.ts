/**
 * Turns the real-map payload (roads, water, land use, rail, buildings) into a
 * handful of merged three.js geometries. Built once, off the render loop.
 */
import * as THREE from 'three';
import { toScene } from '../core/geo';
import type { MapArea, MapEdge, MapLine, RoadClass } from '../contracts/map';

type XZ = { x: number; z: number };

export const ROAD_WIDTH: Record<RoadClass, number> = {
  TRUNK: 16,
  PRIMARY: 13,
  SECONDARY: 11,
  TERTIARY: 9,
  RESIDENTIAL: 6,
  SERVICE: 4.5,
  ACCESS: 5,
};

export const ROAD_TIER: Record<RoadClass, 0 | 1 | 2> = {
  TRUNK: 2,
  PRIMARY: 2,
  SECONDARY: 2,
  TERTIARY: 1,
  RESIDENTIAL: 0,
  SERVICE: 0,
  ACCESS: 0,
};

export function coordsToScene(coords: number[]): XZ[] {
  const out: XZ[] = [];
  for (let i = 0; i < coords.length; i += 2) out.push(toScene(coords[i + 1], coords[i]));
  return out;
}

/** Growable typed buffers for one merged mesh. */
class MeshBuilder {
  pos: number[] = [];
  col: number[] = [];
  idx: number[] = [];

  vertex(x: number, y: number, z: number, c: THREE.Color) {
    this.pos.push(x, y, z);
    this.col.push(c.r, c.g, c.b);
    return this.pos.length / 3 - 1;
  }

  build(withColor = true) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    if (withColor) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** Flat ribbon along a polyline (mitred joins, optional end extension to cover junctions). */
function ribbon(b: MeshBuilder, pts: XZ[], width: number, y: number, c: THREE.Color, extend = 0) {
  if (pts.length < 2) return;
  const p = pts.slice();
  if (extend > 0) {
    const d0 = norm(p[1].x - p[0].x, p[1].z - p[0].z);
    const n = p.length - 1;
    const d1 = norm(p[n].x - p[n - 1].x, p[n].z - p[n - 1].z);
    p[0] = { x: p[0].x - d0.x * extend, z: p[0].z - d0.z * extend };
    p[n] = { x: p[n].x + d1.x * extend, z: p[n].z + d1.z * extend };
  }
  const half = width / 2;
  const base = b.pos.length / 3;
  for (let i = 0; i < p.length; i++) {
    const a = p[Math.max(0, i - 1)];
    const c2 = p[Math.min(p.length - 1, i + 1)];
    const dPrev = i > 0 ? norm(p[i].x - a.x, p[i].z - a.z) : null;
    const dNext = i < p.length - 1 ? norm(c2.x - p[i].x, c2.z - p[i].z) : null;
    const d = dPrev && dNext ? norm(dPrev.x + dNext.x, dPrev.z + dNext.z) : (dPrev ?? dNext)!;
    let nx = -d.z;
    let nz = d.x;
    let scale = 1;
    if (dPrev && dNext) {
      const cos = Math.max(0.35, -dPrev.z * nx + dPrev.x * nz); // dot(perp(dPrev), n)
      scale = Math.min(2.5, 1 / cos);
    }
    nx *= half * scale;
    nz *= half * scale;
    b.vertex(p[i].x + nx, y, p[i].z + nz, c);
    b.vertex(p[i].x - nx, y, p[i].z - nz, c);
  }
  for (let i = 0; i < p.length - 1; i++) {
    const v = base + i * 2;
    b.idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
  }
}

function norm(x: number, z: number) {
  const l = Math.hypot(x, z) || 1;
  return { x: x / l, z: z / l };
}

export interface RoadMeshes {
  tiers: THREE.BufferGeometry[]; // minor, mid, major
  markings: THREE.BufferGeometry;
  bridgeRails: THREE.BufferGeometry;
  lamps: XZ[];
}

export function buildRoads(edges: MapEdge[], colors: Record<RoadClass, string>, marking: string, rail: string): RoadMeshes {
  const tiers = [new MeshBuilder(), new MeshBuilder(), new MeshBuilder()];
  const marks = new MeshBuilder();
  const rails = new MeshBuilder();
  const markColor = new THREE.Color(marking);
  const railColor = new THREE.Color(rail);
  const tierY = [0.1, 0.14, 0.18];
  const lamps: XZ[] = [];
  const colorCache = new Map<string, THREE.Color>();
  for (const e of edges) {
    const pts = coordsToScene(e.coords);
    const w = ROAD_WIDTH[e.roadClass];
    const tier = ROAD_TIER[e.roadClass];
    let c = colorCache.get(e.roadClass);
    if (!c) colorCache.set(e.roadClass, (c = new THREE.Color(colors[e.roadClass])));
    ribbon(tiers[tier], pts, w, tierY[tier], c, w / 2);
    if (tier === 2) dashes(marks, pts, 0.22, markColor);
    if (e.bridge) {
      for (const side of [-1, 1]) ribbonOffset(rails, pts, (w / 2 + 0.5) * side, 0.5, 1.1, railColor);
    }
    if (e.roadClass === 'TRUNK' || e.roadClass === 'PRIMARY') lampPositions(pts, w / 2 + 2, lamps);
  }
  return { tiers: tiers.map((t) => t.build()), markings: marks.build(), bridgeRails: rails.build(), lamps };
}

/** Dashed centre line along a polyline. */
function dashes(b: MeshBuilder, pts: XZ[], y: number, c: THREE.Color) {
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const d = pts[i + 1];
    const len = Math.hypot(d.x - a.x, d.z - a.z);
    const u = norm(d.x - a.x, d.z - a.z);
    for (let s = carry; s < len; s += 14) {
      const e = Math.min(len, s + 5);
      ribbon(b, [{ x: a.x + u.x * s, z: a.z + u.z * s }, { x: a.x + u.x * e, z: a.z + u.z * e }], 0.4, y, c);
      carry = s + 14 - len;
    }
  }
}

/** Low wall offset to one side of a polyline (bridge parapets). */
function ribbonOffset(b: MeshBuilder, pts: XZ[], off: number, y0: number, h: number, c: THREE.Color) {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const d = pts[i + 1];
    const u = norm(d.x - a.x, d.z - a.z);
    const nx = -u.z * off;
    const nz = u.x * off;
    const v = b.pos.length / 3;
    b.vertex(a.x + nx, y0, a.z + nz, c);
    b.vertex(d.x + nx, y0, d.z + nz, c);
    b.vertex(a.x + nx, y0 + h, a.z + nz, c);
    b.vertex(d.x + nx, y0 + h, d.z + nz, c);
    b.idx.push(v, v + 1, v + 2, v + 2, v + 1, v + 3, v, v + 2, v + 1, v + 2, v + 3, v + 1);
  }
}

function lampPositions(pts: XZ[], off: number, out: XZ[]) {
  let next = 20;
  let walked = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const d = pts[i + 1];
    const len = Math.hypot(d.x - a.x, d.z - a.z);
    const u = norm(d.x - a.x, d.z - a.z);
    while (next <= walked + len) {
      const t = next - walked;
      const side = out.length % 2 ? 1 : -1;
      out.push({ x: a.x + u.x * t - u.z * off * side, z: a.z + u.z * t + u.x * off * side });
      next += 45;
    }
    walked += len;
  }
}

/** Filled polygons (water bodies, parks, land use), one merged mesh with vertex colours. */
export function buildAreas(areas: MapArea[], colors: Record<MapArea['kind'], string>): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const order: MapArea['kind'][] = ['INDUSTRIAL', 'INSTITUTION', 'MILITARY', 'PARK', 'WATER'];
  for (const kind of order) {
    const c = new THREE.Color(colors[kind]);
    const y = kind === 'WATER' ? 0.06 : 0.02 + order.indexOf(kind) * 0.005;
    for (const a of areas) {
      if (a.kind !== kind) continue;
      const pts = coordsToScene(a.ring);
      if (pts.length < 3) continue;
      const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.z)));
      const g = new THREE.ShapeGeometry(shape);
      g.rotateX(-Math.PI / 2);
      g.translate(0, y, 0);
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) c.toArray(col, i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.deleteAttribute('uv');
      parts.push(g.index ? g.toNonIndexed() : g);
    }
  }
  return mergeFlat(parts);
}

export function buildLines(lines: MapLine[], colors: Record<MapLine['kind'], string>): THREE.BufferGeometry {
  const b = new MeshBuilder();
  for (const l of lines) {
    const y = l.kind === 'WATER' ? 0.07 : l.kind === 'RAIL' ? 0.22 : 0.09;
    ribbon(b, coordsToScene(l.coords), l.widthM, y, new THREE.Color(colors[l.kind]), l.kind === 'WATER' ? l.widthM / 2 : 0);
  }
  return b.build();
}

function mergeFlat(parts: THREE.BufferGeometry[]) {
  let total = 0;
  for (const p of parts) total += p.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array as Float32Array, o * 3);
    col.set(p.attributes.color.array as Float32Array, o * 3);
    o += p.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Random points inside park polygons (for trees). */
export function treePoints(areas: MapArea[], spacing = 22, max = 6000): XZ[] {
  const out: XZ[] = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (const a of areas) {
    if (a.kind !== 'PARK') continue;
    const pts = coordsToScene(a.ring);
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const p of pts) (x0 = Math.min(x0, p.x)), (x1 = Math.max(x1, p.x)), (z0 = Math.min(z0, p.z)), (z1 = Math.max(z1, p.z));
    const n = Math.min(400, Math.floor(((x1 - x0) * (z1 - z0)) / (spacing * spacing)));
    for (let i = 0; i < n && out.length < max; i++) {
      const p = { x: x0 + rand() * (x1 - x0), z: z0 + rand() * (z1 - z0) };
      if (pointInPolygon(p, pts)) out.push(p);
    }
  }
  return out;
}

function pointInPolygon(p: XZ, poly: XZ[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export interface BuildingRecord {
  x: number;
  z: number;
  w: number;
  d: number;
  angle: number;
  h: number;
}

/** Decodes public/maps/jammu-buildings.bin (Int16 × 6 per building; local metres, y north). */
export function decodeBuildings(buf: ArrayBuffer): BuildingRecord[] {
  const v = new Int16Array(buf);
  const out: BuildingRecord[] = [];
  for (let i = 0; i + 5 < v.length; i += 6) {
    // file uses x east / y north; scene z is south
    out.push({ x: v[i] / 2, z: -v[i + 1] / 2, w: v[i + 2] / 10, d: v[i + 3] / 10, angle: v[i + 4] / 10000, h: v[i + 5] / 10 });
  }
  return out;
}

/** 1-px polylines for major roads so the network stays visible at region scale. */
export function buildRoadOverview(edges: MapEdge[]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const e of edges) {
    if (ROAD_TIER[e.roadClass] < 2) continue;
    const pts = coordsToScene(e.coords);
    for (let i = 0; i < pts.length - 1; i++) pos.push(pts[i].x, 0.3, pts[i].z, pts[i + 1].x, 0.3, pts[i + 1].z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}
