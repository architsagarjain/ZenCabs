/**
 * Fleet layer. Each vehicle is positioned ONLY from gpsService samples (lat/lng → scene),
 * or snapped to its bay pose from parkingService while parked — the same code path
 * serves simulated and real GPS.
 */
import { Html, useCursor } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { memo, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { formatDuration, IDLE_COLORS, parkingIdleLevel, shortId, STATUS_COLORS, STATUS_LABEL } from '../core/format';
import { headingToYaw, toScene } from '../core/geo';
import { matchesFilter, useFleetStore } from '../store/fleetStore';
import { useServices } from '../store/servicesContext';
import { carGeometry } from './carGeometry';
import { sharedMaterials } from './materials';
import { BRAND, SCENE } from '../config/theme';
import { FRAME_PRIORITY, LAYER_Y, renderedHeadings, renderedPoses } from './registry';

export function Vehicles() {
  const ids = useFleetStore((s) => s.vehicles.map((v) => v.vehicleId).join(','));
  return (
    <group>
      {ids
        .split(',')
        .filter(Boolean)
        .map((id) => (
          <VehicleObject key={id} id={id} />
        ))}
    </group>
  );
}

const ringGeo = new THREE.RingGeometry(2.7, 3.2, 40);
ringGeo.rotateX(-Math.PI / 2);
const selRingGeo = new THREE.RingGeometry(3.6, 4.1, 48);
selRingGeo.rotateX(-Math.PI / 2);
const beamGeo = new THREE.CylinderGeometry(0.35, 0.35, 70, 10, 1, true);
beamGeo.translate(0, 35, 0);
const hitGeo = new THREE.BoxGeometry(4.5, 3, 6.5);
hitGeo.translate(0, 1.5, 0);
const hitMat = new THREE.MeshBasicMaterial({ visible: false });
const beaconGeo = new THREE.OctahedronGeometry(1, 0);
const stemGeo = new THREE.CylinderGeometry(0.06, 0.06, 1, 4, 1, true);
stemGeo.translate(0, 0.5, 0);

const VehicleObject = memo(function VehicleObject({ id }: { id: string }) {
  const { gpsService, parkingService, clock } = useServices();
  const v = useFleetStore((s) => s.vehicleMap[id]);
  const selected = useFleetStore((s) => s.selectedVehicleId === id);
  const hovered = useFleetStore((s) => s.hoveredVehicleId === id);
  const dimmed = useFleetStore((s) => {
    const veh = s.vehicleMap[id];
    if (s.view === 'OPERATIONS' && s.filter === 'ALL') return false;
    return !!veh && s.filter !== 'ALL' && !matchesFilter(veh, s.filter, s.now);
  });
  const showLabels = useFleetStore((s) => s.showLabels);
  const select = useFleetStore((s) => s.select);
  const hover = useFleetStore((s) => s.hover);
  const now = useFleetStore((s) => s.now);
  const [pointer, setPointer] = useState(false);
  useCursor(pointer);

  const group = useRef<THREE.Group>(null);
  const scaled = useRef<THREE.Group>(null);
  const selRing = useRef<THREE.Mesh>(null);
  const beacon = useRef<THREE.Mesh>(null);
  const stem = useRef<THREE.Mesh>(null);
  const vRef = useRef(v);
  vRef.current = v;
  const st = useRef({ init: false, x: 0, z: 0, yaw: 0 });

  const geo = useMemo(() => carGeometry(v.vehicleType, v.fuelKind === 'ELECTRIC'), [v.vehicleType, v.fuelKind]);
  const statusColor = STATUS_COLORS[v.status];
  const signMat = useMemo(() => new THREE.MeshBasicMaterial(), []);
  const beaconMat = useMemo(() => new THREE.MeshBasicMaterial({ depthTest: false, transparent: true }), []);
  const stemMat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false }), []);
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false }), []);
  const parkedMs = v.parkingEntryTime ? now - v.parkingEntryTime : null;
  const idleLevel = v.parkingBay && v.status === 'AVAILABLE' ? parkingIdleLevel(parkedMs) : null;

  signMat.color.set(dimmed ? '#CBD5E1' : statusColor).multiplyScalar(dimmed ? 1 : 1.25);
  ringMat.color.set(idleLevel && idleLevel !== 'NORMAL' ? IDLE_COLORS[idleLevel] : statusColor);
  // In a bay the bay floor already shows the idle state; keep the ring off so bays stay readable.
  ringMat.opacity = dimmed || v.parkingBay ? 0.0 : 0.85;
  beaconMat.color.set(dimmed ? '#CBD5E1' : statusColor);
  beaconMat.opacity = dimmed ? 0.35 : 1;
  stemMat.color.set(statusColor);

  useFrame((state, dt) => {
    const veh = vRef.current;
    if (!group.current || !veh) return;
    const t = clock.now();
    const sample = gpsService.sample(id, t);
    const bay = veh.parkingBay ? parkingService.bayPose(veh.parkingBay) : null;
    let tx: number;
    let tz: number;
    let heading: number;
    if (bay && (!sample || sample.speed < 2)) {
      tx = bay.x;
      tz = bay.z;
      heading = bay.heading;
    } else if (sample) {
      tx = sample.x;
      tz = sample.z;
      heading = sample.heading;
    } else {
      const p = toScene(veh.latitude, veh.longitude);
      tx = p.x;
      tz = p.z;
      heading = veh.heading;
    }
    const s = st.current;
    const targetYaw = headingToYaw(heading);
    if (!s.init || Math.hypot(tx - s.x, tz - s.z) > 250) {
      s.x = tx;
      s.z = tz;
      s.yaw = targetYaw;
      s.init = true;
    } else {
      const k = 1 - Math.exp(-dt * 10);
      s.x += (tx - s.x) * k;
      s.z += (tz - s.z) * k;
      let dy = targetYaw - s.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      s.yaw += dy * (1 - Math.exp(-dt * 6));
    }
    group.current.position.set(s.x, LAYER_Y.car, s.z);
    group.current.rotation.y = s.yaw;
    const d = state.camera.position.distanceTo(group.current.position);
    const scale = THREE.MathUtils.clamp(d / 170, 1, veh.parkingBay ? 2.4 : 9);
    scaled.current!.scale.setScalar(scale);
    // Map-pin style beacon so vehicles stay visible above buildings when zoomed out.
    if (beacon.current && stem.current) {
      const far = d > 260;
      beacon.current.visible = stem.current.visible = far;
      if (far) {
        const h = THREE.MathUtils.clamp(d / 22, 14, 120);
        const r = THREE.MathUtils.clamp(d / 170, 1.5, 22) * (selected ? 1.6 : 1);
        beacon.current.position.y = h;
        beacon.current.scale.set(r, r * 1.4, r);
        beacon.current.rotation.y = state.clock.elapsedTime * 1.5;
        stem.current.scale.set(Math.max(1, r * 0.6), h, Math.max(1, r * 0.6));
      }
    }
    if (selRing.current) {
      const p = 1 + 0.15 * Math.sin(state.clock.elapsedTime * 5);
      selRing.current.scale.setScalar(p);
    }
    let pose = renderedPoses.get(id);
    if (!pose) renderedPoses.set(id, (pose = new THREE.Vector3()));
    pose.set(s.x, 0, s.z);
    renderedHeadings.set(id, s.yaw);
  }, FRAME_PRIORITY.vehicles);

  if (!v) return null;
  const labelVisible = selected || hovered || (showLabels && !dimmed);

  return (
    <group
      ref={group}
      onClick={(e) => {
        e.stopPropagation();
        select(id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setPointer(true);
        hover(id);
      }}
      onPointerOut={() => {
        setPointer(false);
        hover(null);
      }}
    >
      <mesh ref={beacon} geometry={beaconGeo} material={beaconMat} renderOrder={10} visible={false} />
      <mesh ref={stem} geometry={stemGeo} material={stemMat} visible={false} />
      <group ref={scaled}>
        <mesh geometry={geo.body} material={sharedMaterials.carBody} castShadow receiveShadow />
        <mesh geometry={geo.lights} material={sharedMaterials.carLights} />
        <mesh geometry={geo.sign} material={signMat} />
        <mesh geometry={ringGeo} material={ringMat} position-y={0.08} />
        <mesh geometry={hitGeo} material={hitMat} />
        {selected && (
          <>
            <mesh ref={selRing} geometry={selRingGeo} position-y={0.1}>
              <meshBasicMaterial color={SCENE.selection} transparent opacity={0.95} depthWrite={false} />
            </mesh>
            <mesh geometry={beamGeo}>
              <meshBasicMaterial color={SCENE.selection} transparent opacity={0.3} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
          </>
        )}
        {(hovered || selected) && !selected && (
          <mesh geometry={selRingGeo} position-y={0.1}>
            <meshBasicMaterial color={BRAND.ink} transparent opacity={0.45} depthWrite={false} />
          </mesh>
        )}
      </group>
      {labelVisible && (
        <Html position={[0, 6, 0]} center zIndexRange={[40, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`veh-label ${selected ? 'sel' : ''}`} style={{ borderColor: statusColor }}>
            <b>{shortId(id)}</b>
            <span style={{ color: statusColor }}>{STATUS_LABEL[v.status]}</span>
            {v.parkingBay && v.status === 'AVAILABLE' && <span>· {formatDuration(parkedMs)}</span>}
            {v.speed > 0 && !v.parkingBay && <span>· {Math.round(v.speed)} km/h</span>}
          </div>
        </Html>
      )}
    </group>
  );
});
