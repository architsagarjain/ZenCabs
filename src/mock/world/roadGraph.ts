/**
 * Routing over the mock road network (scene meters). Used only by the simulation.
 */
import { toScene } from '../../core/geo';
import type { MapNetwork, RoadClass } from '../../contracts/map';

export interface GraphNode {
  id: string;
  x: number;
  z: number;
}

export const CLASS_SPEED_MPS: Record<RoadClass, number> = {
  ARTERIAL: 13.5,
  BRIDGE: 12,
  LOCAL: 9,
  ACCESS: 4,
};

export class RoadGraph {
  nodes = new Map<string, GraphNode>();
  adj = new Map<string, { to: string; len: number; cls: RoadClass; name: string }[]>();
  nodeList: GraphNode[] = [];

  constructor(net: MapNetwork) {
    for (const n of net.nodes) {
      const p = toScene(n.lat, n.lng);
      const node = { id: n.nodeId, x: p.x, z: p.z };
      this.nodes.set(n.nodeId, node);
      this.nodeList.push(node);
      this.adj.set(n.nodeId, []);
    }
    for (const e of net.edges) {
      this.adj.get(e.from)!.push({ to: e.to, len: e.lengthM, cls: e.roadClass, name: e.name });
      this.adj.get(e.to)!.push({ to: e.from, len: e.lengthM, cls: e.roadClass, name: e.name });
    }
  }

  edge(a: string, b: string) {
    return this.adj.get(a)?.find((e) => e.to === b);
  }

  nearest(x: number, z: number, exclude?: (id: string) => boolean): GraphNode {
    let best = this.nodeList[0];
    let bd = Infinity;
    for (const n of this.nodeList) {
      if (exclude?.(n.id)) continue;
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) (bd = d), (best = n);
    }
    return best;
  }

  nodesWithin(x: number, z: number, r: number): GraphNode[] {
    return this.nodeList.filter((n) => n.id !== 'BASE_GATE' && Math.hypot(n.x - x, n.z - z) <= r);
  }

  /** Dijkstra on travel time. Returns node ids including both endpoints. */
  route(from: string, to: string): string[] {
    if (from === to) return [from];
    const dist = new Map<string, number>([[from, 0]]);
    const prev = new Map<string, string>();
    const heap: [number, string][] = [[0, from]];
    const done = new Set<string>();
    while (heap.length) {
      const [d, u] = heapPop(heap);
      if (done.has(u)) continue;
      done.add(u);
      if (u === to) break;
      for (const e of this.adj.get(u) ?? []) {
        const nd = d + e.len / CLASS_SPEED_MPS[e.cls];
        if (nd < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, nd);
          prev.set(e.to, u);
          heapPush(heap, [nd, e.to]);
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
