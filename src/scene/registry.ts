import * as THREE from 'three';

/**
 * Per-frame rendered vehicle poses, shared between vehicle objects and the
 * camera rig (kept outside React state — updated 60x per second).
 */
export const renderedPoses = new Map<string, THREE.Vector3>();
export const renderedHeadings = new Map<string, number>();

export const LAYER_Y = {
  ground: -0.6,
  block: 0,
  road: 0.12,
  marking: 0.2,
  lot: 0.24,
  lotLine: 0.3,
  car: 0.24,
};
