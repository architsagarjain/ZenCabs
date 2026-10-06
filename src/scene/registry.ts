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

/**
 * useFrame ordering (lower runs first; all negative so R3F keeps auto-rendering):
 * vehicle poses → camera follow → drei CameraControls.update (-1) → render.
 * Without this the follow camera aims at last frame's position.
 */
export const FRAME_PRIORITY = { vehicles: -3, cameraFollow: -2 } as const;

/** Imperative camera handle for DOM controls (zoom buttons, compass, double-click zoom). */
export interface CameraApi {
  zoomBy(factor: number): void;
  resetNorth(): void;
  zoomToPoint(x: number, z: number): void;
  distance(): number;
}
export const cameraApi: { current: CameraApi | null } = { current: null };
