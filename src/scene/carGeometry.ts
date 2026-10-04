import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { VehicleType } from '../contracts/types';

interface Dims {
  L: number;
  W: number;
  H: number;
  cabinL: number;
  cabinOffset: number;
  bodyH: number;
}

const DIMS: Record<VehicleType, Dims> = {
  SEDAN: { L: 4.3, W: 1.75, H: 1.5, cabinL: 2.2, cabinOffset: 0.15, bodyH: 0.72 },
  EV_SEDAN: { L: 4.05, W: 1.8, H: 1.58, cabinL: 2.2, cabinOffset: 0.05, bodyH: 0.78 },
  SUV: { L: 4.7, W: 1.86, H: 1.82, cabinL: 3.0, cabinOffset: 0.35, bodyH: 0.88 },
  HATCHBACK: { L: 3.7, W: 1.66, H: 1.62, cabinL: 2.15, cabinOffset: 0.35, bodyH: 0.74 },
};

export function carDims(t: VehicleType) {
  return DIMS[t];
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.Color) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y, z);
  const n = g.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) color.toArray(colors, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function wheel(x: number, z: number, r: number, color: THREE.Color) {
  const g = new THREE.CylinderGeometry(r, r, 0.24, 14).toNonIndexed();
  g.rotateZ(Math.PI / 2);
  g.translate(x, r, z);
  const n = g.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) color.toArray(colors, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

const cache = new Map<string, { body: THREE.BufferGeometry; lights: THREE.BufferGeometry; sign: THREE.BufferGeometry }>();

/**
 * Low-poly ZenCabs car, built procedurally (no external assets).
 * Faces -Z (north at heading 0). Origin at ground level, centre of the car.
 */
export function carGeometry(type: VehicleType, isEV: boolean) {
  const key = `${type}:${isEV}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const d = DIMS[type];
  const white = new THREE.Color('#eef2f6');
  const glass = new THREE.Color('#14202e');
  const tyre = new THREE.Color('#111418');
  const stripe = new THREE.Color(isEV ? '#22c55e' : '#14b8a6');
  const bumper = new THREE.Color('#2a3340');
  const r = 0.32;
  const clearance = 0.18;
  const bodyY = clearance + d.bodyH / 2 + 0.1;
  const cabinH = d.H - (clearance + d.bodyH + 0.1);
  const parts = [
    box(d.W, d.bodyH, d.L, 0, bodyY, 0, white),
    box(d.W - 0.12, cabinH, d.cabinL, 0, clearance + d.bodyH + 0.1 + cabinH / 2, d.cabinOffset, glass),
    box(d.W - 0.2, 0.06, d.cabinL - 0.3, 0, d.H + 0.0, d.cabinOffset, white),
    box(d.W + 0.02, 0.12, d.L * 0.92, 0, bodyY + 0.05, 0, stripe),
    box(d.W + 0.04, 0.22, 0.18, 0, clearance + 0.22, -d.L / 2 + 0.05, bumper),
    box(d.W + 0.04, 0.22, 0.18, 0, clearance + 0.22, d.L / 2 - 0.05, bumper),
    wheel(-d.W / 2 + 0.08, -d.L / 2 + 0.85, r, tyre),
    wheel(d.W / 2 - 0.08, -d.L / 2 + 0.85, r, tyre),
    wheel(-d.W / 2 + 0.08, d.L / 2 - 0.85, r, tyre),
    wheel(d.W / 2 - 0.08, d.L / 2 - 0.85, r, tyre),
  ];
  const body = mergeGeometries(parts)!;
  body.computeVertexNormals();

  const head = new THREE.Color('#fff7d6').multiplyScalar(3);
  const tail = new THREE.Color('#ff2a2a').multiplyScalar(2.2);
  const lights = mergeGeometries([
    box(0.36, 0.12, 0.06, -d.W / 2 + 0.3, bodyY + 0.12, -d.L / 2 - 0.01, head),
    box(0.36, 0.12, 0.06, d.W / 2 - 0.3, bodyY + 0.12, -d.L / 2 - 0.01, head),
    box(0.4, 0.1, 0.06, -d.W / 2 + 0.3, bodyY + 0.14, d.L / 2 + 0.01, tail),
    box(0.4, 0.1, 0.06, d.W / 2 - 0.3, bodyY + 0.14, d.L / 2 + 0.01, tail),
  ])!;

  const sign = new THREE.BoxGeometry(0.75, 0.22, 0.32);
  sign.translate(0, d.H + 0.14, d.cabinOffset);
  const out = { body, lights, sign };
  cache.set(key, out);
  return out;
}
