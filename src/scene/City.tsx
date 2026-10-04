/**
 * Procedural 3D basemap built from mapService (roads, river, blocks, landmarks).
 * Purely visual — vehicles are placed by lat/lng, never by this geometry.
 */
import { Html } from '@react-three/drei';
import { useMemo } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toScene } from '../core/geo';
import { rng } from '../core/random';
import type { MapBlock, MapNetwork } from '../contracts/map';
import { useServices } from '../store/servicesContext';
import { SCENE } from '../config/theme';
import { createBuildingMaterial } from './materials';
import { LAYER_Y } from './registry';

const ROAD_W = { ARTERIAL: 17, BRIDGE: 17, LOCAL: 10.5, ACCESS: 6 } as const;
const ROAD_COLOR = SCENE.road;

type XZ = { x: number; z: number };

function colored(g: THREE.BufferGeometry, color: string | THREE.Color) {
  const c = new THREE.Color(color);
  const geo = g.index ? g.toNonIndexed() : g;
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(arr, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Flat quad along a segment, at height y. */
function strip(a: XZ, b: XZ, width: number, y: number, extend = 0) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) + extend * 2;
  const g = new THREE.PlaneGeometry(width, len);
  g.rotateX(-Math.PI / 2);
  g.rotateY(Math.atan2(dx, dz));
  g.translate((a.x + b.x) / 2, y, (a.z + b.z) / 2);
  return g;
}

function blockRect(b: MapBlock) {
  const sw = toScene(b.sw.lat, b.sw.lng);
  const ne = toScene(b.ne.lat, b.ne.lng);
  return { x0: sw.x, x1: ne.x, z0: ne.z, z1: sw.z };
}

function distToPolyline(p: XZ, pts: XZ[]) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz)));
  }
  return best;
}

export function City() {
  const { mapService, parkingService } = useServices();
  const net = mapService.network;
  const lot = parkingService.layout;
  const built = useMemo(() => buildCity(net, lot && parkingService.localToScene(lot.width / 2, lot.depth / 2)), [net, lot, parkingService]);

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={LAYER_Y.ground} receiveShadow>
        <planeGeometry args={[16000, 16000]} />
        <meshStandardMaterial color={SCENE.ground} roughness={1} />
      </mesh>
      <mesh geometry={built.blocks} receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.95} />
      </mesh>
      <mesh geometry={built.river}>
        <meshStandardMaterial color={SCENE.river} roughness={0.25} metalness={0.15} emissive={SCENE.riverDeep} emissiveIntensity={0.12} />
      </mesh>
      <mesh geometry={built.roads} receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.88} metalness={0.05} />
      </mesh>
      <mesh geometry={built.markings}>
        <meshBasicMaterial vertexColors />
      </mesh>
      <mesh geometry={built.rails}>
        <meshStandardMaterial color={SCENE.rail} metalness={0.6} roughness={0.4} />
      </mesh>
      <instancedMesh args={[built.buildingGeo, built.buildingMat, built.buildings.length]} ref={(m) => applyInstances(m, built.buildings)} castShadow receiveShadow />
      <instancedMesh args={[built.trunkGeo, undefined, built.trees.length]} ref={(m) => applyInstances(m, built.trees.map((t) => ({ ...t, h: t.h * 0.35, w: 0.5, d: 0.5 })))}>
        <meshStandardMaterial color={SCENE.trunk} />
      </instancedMesh>
      <instancedMesh args={[built.crownGeo, undefined, built.trees.length]} ref={(m) => applyInstances(m, built.trees, true)} castShadow>
        <meshStandardMaterial color={SCENE.tree} roughness={0.9} />
      </instancedMesh>
      <instancedMesh args={[built.poleGeo, undefined, built.lamps.length]} ref={(m) => applyInstances(m, built.lamps.map((l) => ({ ...l, y: 0, w: 0.35, d: 0.35, h: 8 })))}>
        <meshStandardMaterial color={SCENE.pole} metalness={0.4} roughness={0.5} />
      </instancedMesh>
      <instancedMesh args={[built.lampGeo, undefined, built.lamps.length]} ref={(m) => applyInstances(m, built.lamps.map((l) => ({ ...l, y: 8, w: 1, d: 1, h: 1 })))}>
        <meshStandardMaterial color={SCENE.lampHead} emissive={SCENE.lampHead} emissiveIntensity={0.25} />
      </instancedMesh>
      <instancedMesh args={[built.lampGeo, undefined, built.runwayLights.length]} ref={(m) => applyInstances(m, built.runwayLights)}>
        <meshBasicMaterial color={SCENE.runwayLight} />
      </instancedMesh>
      <Landmarks net={net} />
    </group>
  );
}

interface Inst {
  x: number;
  y?: number;
  z: number;
  w: number;
  d: number;
  h: number;
  rot?: number;
  color?: THREE.Color;
}

function applyInstances(mesh: THREE.InstancedMesh | null, items: Inst[], sphereLike = false) {
  if (!mesh || mesh.userData.applied === items.length) return;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  items.forEach((it, i) => {
    q.setFromAxisAngle(up, it.rot ?? 0);
    const y = (it.y ?? 0) + (sphereLike ? it.h * 0.55 : it.h / 2);
    m.compose(new THREE.Vector3(it.x, y, it.z), q, new THREE.Vector3(it.w, sphereLike ? it.h * 0.7 : it.h, it.d));
    mesh.setMatrixAt(i, m);
    if (it.color) mesh.setColorAt(i, it.color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.userData.applied = items.length;
}

function buildCity(net: MapNetwork, lotCenter: XZ | null) {
  const nodes = new Map(net.nodes.map((n) => [n.nodeId, toScene(n.lat, n.lng)]));
  const river = net.river.points.map((p) => toScene(p.lat, p.lng));

  // Roads + markings + bridge rails
  const roadParts: THREE.BufferGeometry[] = [];
  const markParts: THREE.BufferGeometry[] = [];
  for (const e of net.edges) {
    const a = nodes.get(e.from)!;
    const b = nodes.get(e.to)!;
    const w = ROAD_W[e.roadClass];
    roadParts.push(colored(strip(a, b, w, LAYER_Y.road, w / 2), ROAD_COLOR[e.roadClass]));
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const ux = (b.x - a.x) / len;
    const uz = (b.z - a.z) / len;
    if (e.roadClass === 'ARTERIAL' || e.roadClass === 'BRIDGE') {
      for (let s = w; s < len - w; s += 12) {
        const p = { x: a.x + ux * s, z: a.z + uz * s };
        const q = { x: a.x + ux * (s + 5), z: a.z + uz * (s + 5) };
        markParts.push(colored(strip(p, q, 0.5, LAYER_Y.marking), SCENE.roadMarking));
      }
    }
    if (e.roadClass === 'BRIDGE') {
      const nx = -uz;
      const nz = ux;
      for (const side of [-1, 1]) {
        const o = (w / 2 + 0.4) * side;
        const g = new THREE.BoxGeometry(0.5, 1.1, len);
        g.rotateY(Math.atan2(ux, uz));
        g.translate((a.x + b.x) / 2 + nx * o, 0.6, (a.z + b.z) / 2 + nz * o);
        roadParts.push(colored(g, SCENE.bridgeRail));
      }
    }
  }

  // River ribbon, extended past the map edges.
  const riverParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < river.length - 1; i++) riverParts.push(strip(river[i], river[i + 1], net.river.widthM, 0.06, net.river.widthM / 2));

  // Blocks, buildings, parks
  const blockParts: THREE.BufferGeometry[] = [];
  const buildings: Inst[] = [];
  const trees: Inst[] = [];
  const rails: THREE.BufferGeometry[] = [];
  const runwayLights: Inst[] = [];
  const blockColor: Record<MapBlock['kind'], string> = SCENE.blocks;
  const airportRects: ReturnType<typeof blockRect>[] = [];

  for (const b of net.blocks) {
    const r = blockRect(b);
    const inset = 9;
    const x0 = r.x0 + inset;
    const x1 = r.x1 - inset;
    const z0 = r.z0 + inset;
    const z1 = r.z1 - inset;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const rand = rng(b.seed);
    const wet = (x: number, z: number, m: number) => distToPolyline({ x, z }, river) < net.river.widthM / 2 + m;

    if (b.kind !== 'AIRPORT') {
      const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
      g.rotateX(-Math.PI / 2);
      g.translate(cx, LAYER_Y.block, cz);
      blockParts.push(colored(g, blockColor[b.kind]));
    } else airportRects.push(r);

    if (b.kind === 'PARK' || b.kind === 'CAMPUS') {
      const n = b.kind === 'PARK' ? 46 : 22;
      for (let i = 0; i < n; i++) {
        const x = x0 + 10 + rand() * (x1 - x0 - 20);
        const z = z0 + 10 + rand() * (z1 - z0 - 20);
        if (wet(x, z, 10)) continue;
        const h = 7 + rand() * 7;
        trees.push({ x, z, w: 4 + rand() * 3, d: 4 + rand() * 3, h });
      }
    }
    if (b.kind === 'CAMPUS') {
      for (let i = 0; i < 4; i++) {
        const x = x0 + 40 + (i % 2) * (x1 - x0 - 120);
        const z = z0 + 40 + Math.floor(i / 2) * (z1 - z0 - 110);
        if (wet(x + 30, z + 25, 20)) continue;
        buildings.push({ x: x + 35, z: z + 30, w: 70, d: 45, h: 14 + rand() * 6, color: new THREE.Color(SCENE.buildingWarm) });
      }
    }
    if (b.kind === 'RAIL') {
      for (let k = 0; k < 6; k++) {
        const z = cz - 40 + k * 16;
        for (const off of [-0.75, 0.75]) {
          const g = new THREE.BoxGeometry(x1 - x0, 0.25, 0.18);
          g.translate(cx, 0.25, z + off);
          rails.push(g);
        }
      }
      buildings.push({ x: cx, z: z0 + 30, w: Math.min(220, x1 - x0 - 20), d: 26, h: 11, color: new THREE.Color(SCENE.buildingWarm) });
    }
    if (b.kind === 'URBAN' || b.kind === 'DENSE' || b.kind === 'BASE') {
      const dense = b.kind === 'DENSE';
      const lotSize = dense ? 42 : 58;
      const nx = Math.max(1, Math.floor((x1 - x0) / lotSize));
      const nz = Math.max(1, Math.floor((z1 - z0) / lotSize));
      const sx = (x1 - x0) / nx;
      const sz = (z1 - z0) / nz;
      const towerZone = Math.hypot(cx - 300, cz - 350) < 900 || Math.hypot(cx + 140, cz - 520) < 500;
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < nz; j++) {
          if (rand() < (dense ? 0.12 : 0.3)) continue;
          const lx = x0 + sx * (i + 0.5);
          const lz = z0 + sz * (j + 0.5);
          if (wet(lx, lz, 30)) continue;
          if (lotCenter && Math.abs(lx - lotCenter.x) < 70 && Math.abs(lz - lotCenter.z) < 70) continue;
          const margin = dense ? 5 + rand() * 5 : 9 + rand() * 10;
          const w = Math.max(10, sx - margin * 2);
          const d = Math.max(10, sz - margin * 2);
          // Jammu is mostly low-rise: 2–5 floors, a few commercial towers.
          let h = dense ? 8 + rand() * 12 : 6 + rand() * 9;
          if (towerZone && rand() < 0.07) h = 28 + rand() * 30;
          const shade = 0.75 + rand() * 0.5;
          const base = new THREE.Color(SCENE.building[Math.floor(rand() * SCENE.building.length)]).multiplyScalar(0.94 + shade * 0.05);
          if (rand() < 0.18) base.set(SCENE.buildingWarm);
          buildings.push({ x: lx, z: lz, w, d, h, color: base });
        }
      }
    }
  }

  // Airport: runway, apron, terminal, tower, edge lights.
  if (airportRects.length) {
    const x0 = Math.min(...airportRects.map((r) => r.x0));
    const x1 = Math.max(...airportRects.map((r) => r.x1));
    const z0 = Math.min(...airportRects.map((r) => r.z0));
    const z1 = Math.max(...airportRects.map((r) => r.z1));
    const g = new THREE.PlaneGeometry(x1 - x0 - 10, z1 - z0 - 10);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, LAYER_Y.block, (z0 + z1) / 2);
    blockParts.push(colored(g, SCENE.blocks.AIRPORT));
    const rz = (z0 + z1) / 2 + 60;
    const rx0 = x0 + 60;
    const rx1 = x1 - 60;
    blockParts.push(colored(strip({ x: rx0, z: rz }, { x: rx1, z: rz }, 46, LAYER_Y.road), SCENE.runway));
    blockParts.push(colored(strip({ x: rx0 + 100, z: rz - 110 }, { x: rx1 - 100, z: rz - 110 }, 22, LAYER_Y.road), SCENE.road.ARTERIAL));
    for (let x = rx0 + 30; x < rx1 - 30; x += 40) markParts.push(colored(strip({ x, z: rz }, { x: x + 20, z: rz }, 1, LAYER_Y.marking), SCENE.roadMarking));
    for (let x = rx0; x <= rx1; x += 30) {
      runwayLights.push({ x, z: rz - 24, w: 0.9, d: 0.9, h: 0.9, y: 0.3 });
      runwayLights.push({ x, z: rz + 24, w: 0.9, d: 0.9, h: 0.9, y: 0.3 });
    }
    blockParts.push(colored(strip({ x: x0 + 200, z: z0 + 70 }, { x: x1 - 200, z: z0 + 70 }, 70, LAYER_Y.road), SCENE.road.LOCAL));
    buildings.push({ x: (x0 + x1) / 2, z: z0 + 30, w: 260, d: 40, h: 16, color: new THREE.Color('#FFFFFF') });
    buildings.push({ x: x1 - 160, z: z0 + 34, w: 12, d: 12, h: 42, color: new THREE.Color('#E6F7FC') });
  }

  // Street lights along arterials.
  const lamps: Inst[] = [];
  for (const e of net.edges) {
    if (e.roadClass !== 'ARTERIAL' && e.roadClass !== 'BRIDGE') continue;
    const a = nodes.get(e.from)!;
    const b = nodes.get(e.to)!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const ux = (b.x - a.x) / len;
    const uz = (b.z - a.z) / len;
    for (let s = 25; s < len - 15; s += 55) {
      for (const side of [-1, 1]) {
        lamps.push({ x: a.x + ux * s - uz * 10 * side, z: a.z + uz * s + ux * 10 * side, w: 1, d: 1, h: 1 });
      }
    }
  }

  const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
  return {
    roads: mergeGeometries(roadParts)!,
    markings: mergeGeometries(markParts)!,
    river: mergeGeometries(riverParts)!,
    blocks: mergeGeometries(blockParts)!,
    rails: rails.length ? mergeGeometries(rails)! : new THREE.BufferGeometry(),
    buildings,
    buildingGeo,
    buildingMat: createBuildingMaterial(),
    trees,
    trunkGeo: new THREE.CylinderGeometry(0.5, 0.6, 1, 6),
    crownGeo: new THREE.IcosahedronGeometry(0.5, 0),
    lamps,
    poleGeo: new THREE.BoxGeometry(1, 1, 1),
    lampGeo: new THREE.SphereGeometry(0.5, 8, 6),
    runwayLights,
  };
}

const LANDMARK_ICON: Record<string, string> = {
  AIRPORT: '✈',
  RAIL: '🚆',
  BUS: '🚌',
  TEMPLE: '🛕',
  HOSPITAL: '✚',
  MALL: '◆',
  FORT: '🏰',
  UNIVERSITY: '🎓',
  BASE: 'Z',
};

function Landmarks({ net }: { net: MapNetwork }) {
  const items = useMemo(() => net.landmarks.filter((l) => l.kind !== 'BASE').map((l) => ({ ...l, p: toScene(l.lat, l.lng) })), [net]);
  const temple = items.find((l) => l.kind === 'TEMPLE');
  return (
    <group>
      {items.map((l) => (
        <group key={l.landmarkId} position={[l.p.x, 0, l.p.z]}>
          <mesh position-y={60}>
            <cylinderGeometry args={[0.8, 0.8, 120, 8, 1, true]} />
            <meshBasicMaterial color={SCENE.landmarkBeam} transparent opacity={0.28} depthWrite={false} />
          </mesh>
          <Html position={[0, 130, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
            <div className="landmark-label">
              <span>{LANDMARK_ICON[l.kind] ?? '•'}</span>
              {l.name}
            </div>
          </Html>
        </group>
      ))}
      {temple && (
        <group position={[temple.p.x + 40, 0, temple.p.z - 40]}>
          <mesh position-y={6} castShadow>
            <boxGeometry args={[30, 12, 30]} />
            <meshStandardMaterial color="#F3E7D3" />
          </mesh>
          <mesh position-y={26} castShadow>
            <coneGeometry args={[10, 28, 8]} />
            <meshStandardMaterial color="#D9A62E" metalness={0.7} roughness={0.3} />
          </mesh>
        </group>
      )}
    </group>
  );
}
