import { CameraControls } from '@react-three/drei';
import CameraControlsImpl from 'camera-controls';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { toScene } from '../core/geo';
import { useFleetStore, type CameraPreset } from '../store/fleetStore';
import { useServices } from '../store/servicesContext';
import { cameraApi, FRAME_PRIORITY, renderedPoses } from './registry';

/**
 * Map-style camera:
 *   mouse  — left-drag pans along the ground, right-drag rotates/tilts, wheel zooms toward the cursor
 *   touch  — one finger pans, two fingers pinch-zoom + rotate/tilt
 * Tilt flattens as you zoom out (top-down at region scale), panning is bounded to the
 * Jammu region, and panning while following a vehicle hands control back to the user.
 */
export function CameraRig() {
  const ref = useRef<CameraControls>(null);
  const { parkingService, mapService } = useServices();
  const request = useFleetStore((s) => s.cameraRequest);
  const flyUntil = useRef(0);
  const userDrag = useRef<{ active: boolean; start: THREE.Vector3 }>({ active: false, start: new THREE.Vector3() });
  const { camera } = useThree();
  const lot = parkingService.layout;
  const lotCenter = parkingService.localToScene(lot.width / 2, lot.depth / 2);

  const presets: Record<CameraPreset, [number, number, number, number, number, number]> = {
    // Jammu + Nagrota, Akhnoor, R.S. Pura, Bari Brahmana, Vijaypur
    REGION: [4000, 36000, 22000, 1500, 0, 3500],
    // Jammu city core (old city, Gandhi Nagar, airport, railway station)
    CITY: [2200, 7800, 6200, 600, 0, 400],
    OVERVIEW: [lotCenter.x + 250, 330, lotCenter.z + 470, lotCenter.x - 40, 0, lotCenter.z - 120],
    BASE: [lotCenter.x + 48, 62, lotCenter.z + 78, lotCenter.x, 0, lotCenter.z],
  };

  // Controls configuration (map conventions) + bounds + imperative API for DOM buttons.
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const A = CameraControlsImpl.ACTION;
    // SCREEN_PAN (camera-controls v3) slides the target along the ground, like a map;
    // TRUCK would lift it vertically on up/down drags.
    c.mouseButtons.left = A.SCREEN_PAN;
    c.mouseButtons.middle = A.DOLLY;
    c.mouseButtons.right = A.ROTATE;
    c.mouseButtons.wheel = A.DOLLY;
    c.touches.one = A.TOUCH_SCREEN_PAN;
    c.touches.two = A.TOUCH_DOLLY_ROTATE;
    c.touches.three = A.TOUCH_ROTATE;
    c.dollySpeed = 0.9;
    c.azimuthRotateSpeed = 0.6;
    c.polarRotateSpeed = 0.6;
    const b = mapService.network.bounds;
    const sw = toScene(b.sw.lat, b.sw.lng);
    const ne = toScene(b.ne.lat, b.ne.lng);
    c.setBoundary(new THREE.Box3(new THREE.Vector3(Math.min(sw.x, ne.x), -1, Math.min(sw.z, ne.z)), new THREE.Vector3(Math.max(sw.x, ne.x), 1, Math.max(sw.z, ne.z))));
    c.boundaryFriction = 0.15;

    const onStart = () => {
      userDrag.current.active = true;
      c.getTarget(userDrag.current.start);
    };
    const onEnd = () => {
      userDrag.current.active = false;
      const t = new THREE.Vector3();
      c.getTarget(t);
      // A real pan (not just zoom/rotate) stops following the selected vehicle.
      if (useFleetStore.getState().following && t.distanceTo(userDrag.current.start) > 3) useFleetStore.setState({ following: false });
    };
    c.addEventListener('controlstart', onStart);
    c.addEventListener('controlend', onEnd);

    cameraApi.current = {
      zoomBy: (f) => void c.dollyTo(THREE.MathUtils.clamp(c.distance * f, c.minDistance, c.maxDistance), true),
      resetNorth: () => void c.rotateTo(0, Math.min(c.polarAngle, Math.PI * 0.3), true),
      zoomToPoint: (x, z) => {
        useFleetStore.setState({ following: false });
        void c.moveTo(x, 0, z, true);
        void c.dollyTo(Math.max(c.minDistance, c.distance * 0.45), true);
      },
      distance: () => c.distance,
    };
    return () => {
      c.removeEventListener('controlstart', onStart);
      c.removeEventListener('controlend', onEnd);
      cameraApi.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Intro: start over the city, then glide down towards the base.
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
      const dist = 70;
      c.setLookAt(p.x + Math.sin(az) * dist * 0.75, dist * 0.65, p.z + Math.cos(az) * dist * 0.75, p.x, 0, p.z, true);
      flyUntil.current = performance.now() + 700;
      useFleetStore.setState({ following: true });
    } else if (request.kind === 'point' && request.point) {
      const { x, z, distance = 600 } = request.point;
      c.setLookAt(x + distance * 0.35, distance * 0.85, z + distance * 0.55, x, 0, z, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  // Tight follow + distance-adaptive tilt.
  const tgt = useRef(new THREE.Vector3());
  useFrame((_, dt) => {
    const c = ref.current;
    if (!c) return;
    // Up close you can tilt to the horizon; from far away the view flattens toward top-down.
    const t = THREE.MathUtils.clamp((Math.log10(c.distance) - Math.log10(1500)) / (Math.log10(30000) - Math.log10(1500)), 0, 1);
    c.maxPolarAngle = THREE.MathUtils.lerp(Math.PI * 0.44, Math.PI * 0.2, t);
    const { following, selectedVehicleId } = useFleetStore.getState();
    c.dollyToCursor = !following;
    if (following && selectedVehicleId && !userDrag.current.active && performance.now() > flyUntil.current) {
      const p = renderedPoses.get(selectedVehicleId);
      if (!p) return;
      c.getTarget(tgt.current);
      const k = 1 - Math.exp(-Math.min(dt, 1) * 8);
      c.moveTo(tgt.current.x + (p.x - tgt.current.x) * k, 0, tgt.current.z + (p.z - tgt.current.z) * k, false);
    }
  }, FRAME_PRIORITY.cameraFollow);

  return <CameraControls ref={ref} makeDefault minDistance={20} maxDistance={60000} smoothTime={0.28} draggingSmoothTime={0.06} />;
}

/** Double-click / double-tap on the map zooms in on that spot. */
export function DoubleClickZoom() {
  const { gl, camera } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    const ray = new THREE.Raycaster();
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    const onDbl = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      if (ray.ray.intersectPlane(ground, hit)) cameraApi.current?.zoomToPoint(hit.x, hit.z);
    };
    el.addEventListener('dblclick', onDbl);
    return () => el.removeEventListener('dblclick', onDbl);
  }, [gl, camera]);
  return null;
}

/** Haze that scales with zoom: crisp up close, still readable from 40 km up. */
export function DynamicFog() {
  const fog = useThree((s) => s.scene.fog) as THREE.Fog | null;
  const controls = useThree((s) => s.controls) as unknown as CameraControls | null;
  const camera = useThree((s) => s.camera);
  const t = new THREE.Vector3();
  useFrame(() => {
    if (!fog || !controls) return;
    controls.getTarget(t);
    const d = camera.position.distanceTo(t);
    fog.near = Math.max(2500, d * 1.1);
    fog.far = Math.max(12000, d * 3.2);
  });
  return null;
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
