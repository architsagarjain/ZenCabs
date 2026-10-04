import { CameraControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { toScene } from '../core/geo';
import { useFleetStore, type CameraPreset } from '../store/fleetStore';
import { useServices } from '../store/servicesContext';
import { FRAME_PRIORITY, renderedPoses } from './registry';

/** Smooth camera: presets, fly-to-vehicle, and follow mode. */
export function CameraRig() {
  const ref = useRef<CameraControls>(null);
  const { parkingService } = useServices();
  const request = useFleetStore((s) => s.cameraRequest);
  const flyUntil = useRef(0);
  const { camera } = useThree();
  const lot = parkingService.layout;
  const lotCenter = parkingService.localToScene(lot.width / 2, lot.depth / 2);

  const presets: Record<CameraPreset, [number, number, number, number, number, number]> = {
    CITY: [1500, 2300, 3100, 0, 0, 150],
    OVERVIEW: [lotCenter.x + 250, 330, lotCenter.z + 470, lotCenter.x - 40, 0, lotCenter.z - 120],
    BASE: [lotCenter.x + 48, 62, lotCenter.z + 78, lotCenter.x, 0, lotCenter.z],
  };

  // Intro: start wide over the city, then glide down towards the base.
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.setLookAt(...presets.CITY, false);
    const t = setTimeout(() => c.setLookAt(...presets.OVERVIEW, true), 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const c = ref.current;
    if (!c || !request) return;
    if (request.kind === 'preset' && request.preset) {
      useFleetStore.setState({ following: false });
      c.setLookAt(...presets[request.preset], true);
    } else if (request.kind === 'vehicle' && request.vehicleId) {
      let p = renderedPoses.get(request.vehicleId);
      if (!p) {
        const v = useFleetStore.getState().vehicleMap[request.vehicleId];
        if (!v) return;
        const s = toScene(v.latitude, v.longitude);
        p = new THREE.Vector3(s.x, 0, s.z);
      }
      const target = new THREE.Vector3();
      c.getTarget(target);
      const az = Math.atan2(camera.position.x - target.x, camera.position.z - target.z);
      const dist = 42;
      c.setLookAt(p.x + Math.sin(az) * dist, 30, p.z + Math.cos(az) * dist, p.x, 0, p.z, true);
      flyUntil.current = performance.now() + 700;
      useFleetStore.setState({ following: true });
    } else if (request.kind === 'point' && request.point) {
      const { x, z, distance = 600 } = request.point;
      c.setLookAt(x + distance * 0.45, distance * 0.8, z + distance * 0.75, x, 0, z, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  // Tight follow: our own exponential chase (≈0.12 s time constant) on top of the already
  // smoothed vehicle pose, so fast cars at high sim speeds stay centred instead of lagging
  // behind camera-controls' longer transition smoothing.
  const tgt = useRef(new THREE.Vector3());
  useFrame((_, dt) => {
    const c = ref.current;
    if (!c) return;
    const { following, selectedVehicleId } = useFleetStore.getState();
    if (following && selectedVehicleId && performance.now() > flyUntil.current) {
      const p = renderedPoses.get(selectedVehicleId);
      if (!p) return;
      c.getTarget(tgt.current);
      const k = 1 - Math.exp(-Math.min(dt, 1) * 8);
      c.moveTo(tgt.current.x + (p.x - tgt.current.x) * k, 0, tgt.current.z + (p.z - tgt.current.z) * k, false);
    }
  }, FRAME_PRIORITY.cameraFollow);

  return (
    <CameraControls
      ref={ref}
      makeDefault
      minDistance={8}
      maxDistance={6500}
      maxPolarAngle={Math.PI * 0.47}
      smoothTime={0.55}
      draggingSmoothTime={0.12}
      dollyToCursor
    />
  );
}

/** Keeps the moon-light shadow frustum centred on whatever the camera looks at. */
export function ShadowFollower({ light }: { light: React.RefObject<THREE.DirectionalLight | null> }) {
  const controls = useThree((s) => s.controls) as unknown as CameraControls | null;
  const tmp = new THREE.Vector3();
  useFrame(() => {
    const l = light.current;
    if (!l || !controls) return;
    controls.getTarget(tmp);
    l.position.set(tmp.x - 220, 420, tmp.z + 160);
    l.target.position.copy(tmp);
    l.target.updateMatrixWorld();
  });
  return null;
}
