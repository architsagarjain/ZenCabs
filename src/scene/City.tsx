/**
 * 3D basemap of the real Jammu region, built from mapService (OpenStreetMap roads,
 * Google/Microsoft/OSM building footprints via Overture Maps). Purely visual —
 * vehicles are placed by lat/lng, never by this geometry.
 */
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { toScene } from '../core/geo';
import type { MapNetwork } from '../contracts/map';
import { useServices } from '../store/servicesContext';
import { SCENE } from '../config/theme';
import { createBuildingMaterial } from './materials';
import { buildAreas, buildLines, buildRoadOverview, buildRoads, decodeBuildings, treePoints, type BuildingRecord } from './mapGeometry';
import { LAYER_Y } from './registry';

export function City() {
  const { mapService, parkingService } = useServices();
  const net = mapService.network;
  const lot = parkingService.layout;

  const base = useMemo(() => {
    const roads = buildRoads(net.edges, SCENE.road, SCENE.roadMarking, SCENE.bridgeRail);
    const areas = buildAreas(net.areas, SCENE.areas);
    const lines = buildLines(net.lines, { WATER: SCENE.canal, RAIL: SCENE.rail, TAXIWAY: SCENE.taxiway });
    const trees = treePoints(net.areas);
    const overview = buildRoadOverview(net.edges);
    return { roads, areas, lines, trees, overview };
  }, [net]);

  // Building footprints stream in after the roads (1.8 MB binary).
  const [buildings, setBuildings] = useState<BuildingRecord[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(net.buildings.url)
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        if (!alive) return;
        // Clear the footprint of the ZenCabs base lot (+ margin).
        const a = parkingService.localToScene(-8, -24);
        const b = parkingService.localToScene(lot.width + 8, lot.depth + 8);
        const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
        const [z0, z1] = [Math.min(a.z, b.z), Math.max(a.z, b.z)];
        setBuildings(decodeBuildings(buf).filter((r) => r.x < x0 - r.w / 2 || r.x > x1 + r.w / 2 || r.z < z0 - r.d / 2 || r.z > z1 + r.d / 2));
      })
      .catch((e) => console.warn('[city] buildings unavailable', e));
    return () => {
      alive = false;
    };
  }, [net, lot, parkingService]);

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={LAYER_Y.ground} receiveShadow>
        <planeGeometry args={[140000, 140000]} />
        <meshStandardMaterial color={SCENE.ground} roughness={1} />
      </mesh>
      <mesh geometry={base.areas} receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.95} />
      </mesh>
      <mesh geometry={base.lines}>
        <meshStandardMaterial vertexColors roughness={0.6} />
      </mesh>
      {base.roads.tiers.map((g, i) => (
        <mesh key={i} geometry={g} receiveShadow>
          <meshStandardMaterial vertexColors roughness={0.9} metalness={0.02} />
        </mesh>
      ))}
      <lineSegments geometry={base.overview}>
        <lineBasicMaterial color={SCENE.road.TRUNK} transparent opacity={0.85} />
      </lineSegments>
      <mesh geometry={base.roads.markings}>
        <meshBasicMaterial vertexColors />
      </mesh>
      <mesh geometry={base.roads.bridgeRails}>
        <meshStandardMaterial vertexColors side={THREE.DoubleSide} />
      </mesh>
      <Lamps points={base.roads.lamps} />
      <Trees points={base.trees} />
      {buildings && <Buildings items={buildings} />}
      <Landmarks net={net} />
    </group>
  );
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);

function Buildings({ items }: { items: BuildingRecord[] }) {
  const material = useMemo(() => createBuildingMaterial(), []);
  const ref = (mesh: THREE.InstancedMesh | null) => {
    if (!mesh || mesh.userData.count === items.length) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    const palette = SCENE.building.map((h) => new THREE.Color(h));
    const warm = new THREE.Color(SCENE.buildingWarm);
    items.forEach((b, i) => {
      q.setFromAxisAngle(up, b.angle);
      m.compose(new THREE.Vector3(b.x, b.h / 2, b.z), q, new THREE.Vector3(Math.max(2, b.w), b.h, Math.max(2, b.d)));
      mesh.setMatrixAt(i, m);
      const hash = Math.abs(Math.sin(b.x * 12.9898 + b.z * 78.233)) % 1;
      mesh.setColorAt(i, hash > 0.82 ? warm : c.copy(palette[Math.floor(hash * palette.length) % palette.length]));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.userData.count = items.length;
  };
  // Shadows only from the camera-local shadow frustum would still rasterise every instance; skip casting.
  return <instancedMesh args={[unitBox, material, items.length]} ref={ref} receiveShadow />;
}

const poleGeo = new THREE.BoxGeometry(0.3, 8, 0.3).translate(0, 4, 0);
const headGeo = new THREE.SphereGeometry(0.5, 8, 6).translate(0, 8.3, 0);

function Lamps({ points }: { points: { x: number; z: number }[] }) {
  const set = (mesh: THREE.InstancedMesh | null) => {
    if (!mesh || mesh.userData.n === points.length) return;
    const m = new THREE.Matrix4();
    points.forEach((p, i) => mesh.setMatrixAt(i, m.makeTranslation(p.x, 0, p.z)));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.userData.n = points.length;
  };
  return (
    <>
      <instancedMesh args={[poleGeo, undefined, points.length]} ref={set}>
        <meshStandardMaterial color={SCENE.pole} metalness={0.4} roughness={0.5} />
      </instancedMesh>
      <instancedMesh args={[headGeo, undefined, points.length]} ref={set}>
        <meshStandardMaterial color={SCENE.lampHead} emissive={SCENE.lampHead} emissiveIntensity={0.25} />
      </instancedMesh>
    </>
  );
}

const trunkGeo = new THREE.CylinderGeometry(0.35, 0.45, 3, 6).translate(0, 1.5, 0);
const crownGeo = new THREE.IcosahedronGeometry(2.6, 0).translate(0, 5, 0);

function Trees({ points }: { points: { x: number; z: number }[] }) {
  const set = (mesh: THREE.InstancedMesh | null) => {
    if (!mesh || mesh.userData.n === points.length) return;
    const m = new THREE.Matrix4();
    points.forEach((p, i) => {
      const s = 0.8 + ((i * 7919) % 100) / 200;
      mesh.setMatrixAt(i, m.makeScale(s, s, s).setPosition(p.x, 0, p.z));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.userData.n = points.length;
  };
  return (
    <>
      <instancedMesh args={[trunkGeo, undefined, points.length]} ref={set}>
        <meshStandardMaterial color={SCENE.trunk} />
      </instancedMesh>
      <instancedMesh args={[crownGeo, undefined, points.length]} ref={set} castShadow>
        <meshStandardMaterial color={SCENE.tree} roughness={0.9} flatShading />
      </instancedMesh>
    </>
  );
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
  TOWN: '📍',
  BASE: 'Z',
};

function Landmarks({ net }: { net: MapNetwork }) {
  const items = useMemo(() => net.landmarks.filter((l) => l.kind !== 'BASE').map((l) => ({ ...l, p: toScene(l.lat, l.lng) })), [net]);
  // At region scale only towns (plus a single "Jammu" label) are shown, to avoid a pile of overlapping city labels.
  const [far, setFar] = useState(false);
  const farRef = useRef(false);
  useFrame(({ camera }) => {
    const isFar = camera.position.y > 16000;
    if (isFar !== farRef.current) setFar((farRef.current = isFar));
  });
  return (
    <group>
      {far && (
        <Html position={[0, 600, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <div className="landmark-label town city">Jammu</div>
        </Html>
      )}
      {items.filter((l) => !far || l.kind === 'TOWN').map((l) => {
        const town = l.kind === 'TOWN';
        const h = town ? 400 : 120;
        return (
          <group key={l.landmarkId} position={[l.p.x, 0, l.p.z]}>
            <mesh position-y={h / 2}>
              <cylinderGeometry args={[town ? 3 : 0.8, town ? 3 : 0.8, h, 8, 1, true]} />
              <meshBasicMaterial color={SCENE.landmarkBeam} transparent opacity={0.28} depthWrite={false} />
            </mesh>
            <Html position={[0, h + 10, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
              <div className={`landmark-label ${town ? 'town' : ''}`}>
                <span>{LANDMARK_ICON[l.kind] ?? '•'}</span>
                {l.name}
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}
