/**
 * Routing over the real Jammu road network (scene metres). Used only by the simulation.
 */
import { toScene } from '../../core/geo';
import type { MapNetwork, RoadClass } from '../../contracts/map';

export interface GraphNode {
  id: string;
  x: number;
  z: number;
}

export interface GraphEdge {
  to: string;
  len: number;
  cls: RoadClass;
  name: string;
  /** Polyline oriented from this node to `to`, scene metres. */
  pts: { x: number; z: number }[];
}

/** Typical free-flow speeds in Jammu traffic, m/s. */
export const CLASS_SPEED_MPS: Record<RoadClass, number> = {
  TRUNK: 16,
  PRIMARY: 13,
  SECONDARY: 11.5,
  TERTIARY: 10,
  RESIDENTIAL: 7.5,
  SERVICE: 5,
  ACCESS: 4,
};

const MAJOR: RoadClass[] = ['TRUNK', 'PRIMARY', 'SECONDARY'];
const CELL = 250;

export class RoadGraph {
  nodes = new Map<string, GraphNode>();
  adj = new Map<string, GraphEdge[]>();
  nodeList: GraphNode[] = [];
  /** Junctions of major roads — where the simulation may stop at a signal. */
  signalNodes = new Set<string>();
  private grid = new Map<string, GraphNode[]>();

  constructor(net: MapNetwork) {
    const used = new Set<string>();
    for (const e of net.edges) {
      if (!e.routable) continue;
      used.add(e.from);
      used.add(e.to);
    }
    for (const n of net.nodes) {
      if (!used.has(n.nodeId)) continue;
      const p = toScene(n.lat, n.lng);
      const node = { id: n.nodeId, x: p.x, z: p.z };
      this.nodes.set(n.nodeId, node);
      this.nodeList.push(node);
      this.adj.set(n.nodeId, []);
      const key = cellKey(p.x, p.z);
      (this.grid.get(key) ?? this.grid.set(key, []).get(key)!).push(node);
    }
    for (const e of net.edges) {
      if (!e.routable) continue;
      const pts: { x: number; z: number }[] = [];
      for (let i = 0; i < e.coords.length; i += 2) pts.push(toScene(e.coords[i + 1], e.coords[i]));
      this.adj.get(e.from)!.push({ to: e.to, len: e.lengthM, cls: e.roadClass, name: e.name, pts });
      this.adj.get(e.to)!.push({ to: e.from, len: e.lengthM, cls: e.roadClass, name: e.name, pts: [...pts].reverse() });
    }
    for (const [id, list] of this.adj) {
      if (list.length >= 3 && list.filter((e) => MAJOR.includes(e.cls)).length >= 2) this.signalNodes.add(id);
    }
  }

  /** Cheapest edge between two adjacent nodes. */
  edge(a: string, b: string) {
    let best: GraphEdge | undefined;
    for (const e of this.adj.get(a) ?? []) if (e.to === b && (!best || e.len < best.len)) best = e;
    return best;
  }

  nearest(x: number, z: number, exclude?: (id: string) => boolean): GraphNode {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    let best: GraphNode | null = null;
    let bd = Infinity;
    for (let r = 0; r < 200 && (!best || (r - 1) * CELL < Math.sqrt(bd)); r++) {
      for (let i = -r; i <= r; i++) {
        for (let j = -r; j <= r; j++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
          for (const n of this.grid.get(`${cx + i},${cz + j}`) ?? []) {
            if (exclude?.(n.id)) continue;
            const d = (n.x - x) ** 2 + (n.z - z) ** 2;
            if (d < bd) (bd = d), (best = n);
          }
        }
      }
    }
    return best ?? this.nodeList[0];
  }

  nodesWithin(x: number, z: number, r: number): GraphNode[] {
    const out: GraphNode[] = [];
    const span = Math.ceil(r / CELL);
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    for (let i = -span; i <= span; i++) {
      for (let j = -span; j <= span; j++) {
        for (const n of this.grid.get(`${cx + i},${cz + j}`) ?? []) {
          if (n.id !== 'BASE_GATE' && Math.hypot(n.x - x, n.z - z) <= r) out.push(n);
        }
      }
    }
    return out;
  }

  /** Dijkstra on travel time. Returns node ids including both endpoints. */
  route(from: string, to: string): string[] {
    if (from === to) return [from];
    const dist = new Map<string, number>([[from, 0]]);
    const prev = new Map<string, string>();
    const heap: [number, string][] = [[0, from]];
    const done = new Set<string>();
    const goal = this.nodes.get(to);
    while (heap.length) {
      const [, u] = heapPop(heap);
      if (done.has(u)) continue;
      done.add(u);
      if (u === to) break;
      const du = dist.get(u)!;
      for (const e of this.adj.get(u) ?? []) {
        const nd = du + e.len / CLASS_SPEED_MPS[e.cls];
        if (nd < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, nd);
          prev.set(e.to, u);
          // A*: admissible heuristic = straight-line distance at the top speed.
          const n = this.nodes.get(e.to)!;
          const h = goal ? Math.hypot(n.x - goal.x, n.z - goal.z) / CLASS_SPEED_MPS.TRUNK : 0;
          heapPush(heap, [nd + h, e.to]);
        }
      }
    }
    if (!prev.has(to)) return [from];
    const path = [to];
    let cur = to;
    while (cur !== from) {
      cur = prev.get(cur)!;
      path.push(cur);
    }
    return path.reverse();
  }
}

function cellKey(x: number, z: number) {
  return `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
}

function heapPush(h: [number, string][], item: [number, string]) {
  h.push(item);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p][0] <= h[i][0]) break;
    [h[p], h[i]] = [h[i], h[p]];
    i = p;
  }
}

function heapPop(h: [number, string][]): [number, string] {
  const top = h[0];
  const last = h.pop()!;
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < h.length && h[l][0] < h[m][0]) m = l;
      if (r < h.length && h[r][0] < h[m][0]) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]];
      i = m;
    }
  }
  return top;
}
