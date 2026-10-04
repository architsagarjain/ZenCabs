/**
 * Digital twin of the ZenCabs base parking facility, generated entirely from
 * parkingService.layout (ParkingLotLayout). Swap the layout for the surveyed
 * real lot and this component renders it without code changes.
 */
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { formatDuration, IDLE_COLORS, parkingIdleLevel, shortId } from '../core/format';
import { toScene } from '../core/geo';
import type { ParkingBay } from '../contracts/types';
import { useFleetStore } from '../store/fleetStore';
import { useServices } from '../store/servicesContext';
import { LAYER_Y } from './registry';

const DEG = Math.PI / 180;

function textTexture(text: string, opts: { w?: number; h?: number; color?: string; bg?: string; font?: string } = {}) {
  const w = opts.w ?? 128;
  const h = opts.h ?? 64;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  if (opts.bg) {
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.fillStyle = opts.color ?? '#e2e8f0';
  ctx.font = opts.font ?? `700 ${Math.floor(h * 0.6)}px Inter, Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Lot-local (x east, y north) → group space (x, -y). */
const L = (x: number, y: number, h = 0): [number, number, number] => [x, h, -y];

export function ParkingLotTwin() {
  const { parkingService } = useServices();
  const layout = parkingService.layout;
  const origin = useMemo(() => toScene(layout.origin.lat, layout.origin.lng), [layout]);
  const centerScene = useMemo(() => parkingService.localToScene(layout.width / 2, layout.depth / 2), [layout, parkingService]);

  const [near, setNear] = useState(false);
  useFrame(({ camera }) => {
    const d = camera.position.distanceTo(new THREE.Vector3(centerScene.x, 0, centerScene.z));
    if (d < 260 !== near) setNear(d < 260);
  });

  const lines = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    const add = (x: number, y: number, w: number, d: number) => {
      const g = new THREE.PlaneGeometry(w, d);
      g.rotateX(-Math.PI / 2);
      g.translate(x, LAYER_Y.lotLine, -y);
      parts.push(g);
    };
    for (const b of layout.bays) {
      const dir = b.rotation === 0 ? 1 : -1; // nose direction in local y
      add(b.x - b.width / 2, b.y, 0.12, b.length);
      add(b.x + b.width / 2, b.y, 0.12, b.length);
      add(b.x, b.y + (dir * b.length) / 2, b.width, 0.12);
    }
    // spine centre dashes
    for (let y = 0; y < layout.depth - 8; y += 4) add(6, y, 0.15, 2);
    const geo = new THREE.BufferGeometry();
    return parts.length ? mergeAll(parts) : geo;
  }, [layout]);

  const signTex = useMemo(() => textTexture('ZENCABS', { w: 512, h: 128, color: '#5eead4', bg: '#0b1320', font: '800 84px Inter, Arial' }), []);
  const baseTex = useMemo(() => textTexture('BASE · JAMMU', { w: 512, h: 96, color: '#e2e8f0', font: '700 52px Inter, Arial' }), []);

  return (
    <group position={[origin.x, 0, origin.z]} rotation-y={-layout.bearing * DEG}>
      {/* slab + apron to the street */}
      <mesh position={L(layout.width / 2, layout.depth / 2, LAYER_Y.lot - 0.1)} receiveShadow>
        <boxGeometry args={[layout.width + 4, 0.2, layout.depth + 4]} />
        <meshStandardMaterial color="#202a38" roughness={0.92} />
      </mesh>
      <mesh position={L(layout.gate.x, -11, LAYER_Y.lot - 0.1)} receiveShadow>
        <boxGeometry args={[9, 0.2, 22]} />
        <meshStandardMaterial color="#202a38" roughness={0.92} />
      </mesh>
      <mesh geometry={lines}>
        <meshBasicMaterial color={new THREE.Color('#dbe4f0').multiplyScalar(0.85)} toneMapped={false} />
      </mesh>

      {layout.bays.map((b) => (
        <Bay key={b.bayId} bay={b} showTimer={near} />
      ))}

      <Fence width={layout.width} depth={layout.depth} gateX={layout.gate.x} />
      <Gate x={layout.gate.x} />

      {layout.buildings.map((bd) =>
        bd.id === 'workshop' ? (
          <group key={bd.id} position={L(bd.x, bd.y)}>
            {[
              [-bd.w / 2, -bd.d / 2],
              [bd.w / 2, -bd.d / 2],
              [-bd.w / 2, bd.d / 2],
              [bd.w / 2, bd.d / 2],
            ].map(([x, z], i) => (
              <mesh key={i} position={[x, bd.h / 2, z]} castShadow>
                <boxGeometry args={[0.3, bd.h, 0.3]} />
                <meshStandardMaterial color="#64748b" />
              </mesh>
            ))}
            <mesh position={[0, bd.h, 0]} castShadow>
              <boxGeometry args={[bd.w + 1, 0.25, bd.d + 1]} />
              <meshStandardMaterial color="#f59e0b" transparent opacity={0.55} />
            </mesh>
            <Html position={[0, bd.h + 1.5, 0]} center distanceFactor={60} style={{ pointerEvents: 'none' }}>
              <div className="lot-tag service">SERVICE BAY</div>
            </Html>
          </group>
        ) : (
          <group key={bd.id} position={L(bd.x, bd.y)}>
            <mesh position-y={bd.h / 2} castShadow receiveShadow>
              <boxGeometry args={[bd.w, bd.h, bd.d]} />
              <meshStandardMaterial color="#1e293b" roughness={0.6} metalness={0.2} />
            </mesh>
            <mesh position={[0, bd.h * 0.55, -bd.d / 2 - 0.01]} rotation-y={Math.PI}>
              <planeGeometry args={[bd.w * 0.9, bd.h * 0.35]} />
              <meshBasicMaterial color={new THREE.Color('#7dd3fc').multiplyScalar(1.4)} toneMapped={false} transparent opacity={0.7} />
            </mesh>
            <mesh position={[0, bd.h + 0.02, 0]} rotation-x={-Math.PI / 2}>
              <planeGeometry args={[bd.w * 0.95, bd.d * 0.5]} />
              <meshBasicMaterial map={signTex} toneMapped={false} />
            </mesh>
          </group>
        ),
      )}
      <mesh position={L(30, 18.6, LAYER_Y.lotLine + 0.01)} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[16, 3]} />
        <meshBasicMaterial map={baseTex} transparent toneMapped={false} opacity={0.75} />
      </mesh>

      {/* lamp posts */}
      {[
        [2, 2],
        [2, layout.depth - 2],
        [layout.width - 2, layout.depth - 2],
        [layout.width - 2, 20],
        [layout.width / 2, layout.depth - 2],
        [2, 32],
      ].map(([x, y], i) => (
        <group key={i} position={L(x, y)}>
          <mesh position-y={4.5}>
            <boxGeometry args={[0.25, 9, 0.25]} />
            <meshStandardMaterial color="#475569" />
          </mesh>
          <mesh position-y={9.1}>
            <boxGeometry args={[1.6, 0.25, 0.6]} />
            <meshBasicMaterial color={new THREE.Color('#e0f2fe').multiplyScalar(3)} toneMapped={false} />
          </mesh>
        </group>
      ))}
      <pointLight position={L(layout.width / 2, layout.depth / 2, 18)} intensity={900} distance={90} decay={2} color="#cfe8ff" />
      <Html position={L(layout.width / 2, layout.depth + 4, 14)} center style={{ pointerEvents: 'none' }} zIndexRange={[20, 0]}>
        <BaseBadge />
      </Html>
    </group>
  );
}

function mergeAll(parts: THREE.BufferGeometry[]) {
  // Local merge to avoid importing BufferGeometryUtils twice in this file.
  const positions: number[] = [];
  for (const p of parts) {
    const g = p.index ? p.toNonIndexed() : p;
    positions.push(...(g.attributes.position.array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return out;
}

function BaseBadge() {
  const bays = useFleetStore((s) => s.bays);
  const std = bays.filter((b) => b.bay.kind !== 'SERVICE');
  const used = std.filter((b) => b.vehicleId).length;
  return (
    <div className="base-badge">
      <b>ZenCabs Base</b>
      <span>
        {used}/{std.length} bays occupied
      </span>
    </div>
  );
}

function Bay({ bay, showTimer }: { bay: ParkingBay; showTimer: boolean }) {
  const state = useFleetStore((s) => s.bays.find((b) => b.bay.bayId === bay.bayId));
  const now = useFleetStore((s) => s.now);
  const vehicle = useFleetStore((s) => (state?.vehicleId ? s.vehicleMap[state.vehicleId] : undefined));
  const select = useFleetStore((s) => s.select);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const occupied = !!state?.vehicleId;
  const duration = occupied && state?.entryTime ? now - state.entryTime : null;
  const level = parkingIdleLevel(duration);
  const color = bay.kind === 'SERVICE' ? '#f59e0b' : occupied ? IDLE_COLORS[level] : bay.kind === 'EV_CHARGING' ? '#22c55e' : '#334155';
  const labelTex = useMemo(() => textTexture(bay.bayId, { color: '#94a3b8' }), [bay.bayId]);
  const nose = bay.rotation === 0 ? 1 : -1;
  const parkedVehicleCounts = vehicle && vehicle.status !== 'MAINTENANCE' && vehicle.status !== 'OFFLINE';

  useFrame(({ clock }) => {
    if (!matRef.current) return;
    const base = occupied ? 0.28 : state?.reservedFor ? 0.22 : 0.08;
    matRef.current.opacity = occupied && level === 'CRITICAL' && parkedVehicleCounts ? 0.22 + 0.25 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 4)) : base;
  });

  return (
    <group>
      <mesh position={L(bay.x, bay.y, LAYER_Y.lot + 0.03)} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[bay.width - 0.25, bay.length - 0.2]} />
        <meshBasicMaterial ref={matRef} color={state?.reservedFor && !occupied ? '#2dd4bf' : color} transparent opacity={0.1} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh position={L(bay.x, bay.y - (nose * bay.length) / 2 - 0.9, LAYER_Y.lotLine + 0.02)} rotation-x={-Math.PI / 2} rotation-z={0}>
        <planeGeometry args={[1.8, 0.9]} />
        <meshBasicMaterial map={labelTex} transparent toneMapped={false} />
      </mesh>
      {bay.kind === 'EV_CHARGING' && (
        <group position={L(bay.x + bay.width / 2 - 0.3, bay.y + (nose * bay.length) / 2 + 0.4)}>
          <mesh position-y={0.8}>
            <boxGeometry args={[0.4, 1.6, 0.3]} />
            <meshStandardMaterial color="#e2e8f0" />
          </mesh>
          <mesh position-y={1.35}>
            <boxGeometry args={[0.42, 0.18, 0.32]} />
            <meshBasicMaterial color={occupied ? new THREE.Color('#22c55e').multiplyScalar(3) : new THREE.Color('#38bdf8').multiplyScalar(2)} toneMapped={false} />
          </mesh>
        </group>
      )}
      {showTimer && occupied && vehicle && (
        <Html position={L(bay.x, bay.y, 3.2)} center distanceFactor={55} zIndexRange={[30, 0]}>
          <div
            className={`bay-timer lvl-${level.toLowerCase()}`}
            onClick={(e) => {
              e.stopPropagation();
              select(vehicle.vehicleId);
            }}
          >
            <b>{shortId(vehicle.vehicleId)}</b>
            <span>{vehicle.status === 'MAINTENANCE' ? 'In service' : vehicle.status === 'OFFLINE' ? 'Offline' : formatDuration(duration)}</span>
          </div>
        </Html>
      )}
    </group>
  );
}

function Fence({ width, depth, gateX }: { width: number; depth: number; gateX: number }) {
  const segs: [number, number, number, number][] = [
    [-1.5, -1.5, -1.5, depth + 1.5],
    [-1.5, depth + 1.5, width + 1.5, depth + 1.5],
    [width + 1.5, depth + 1.5, width + 1.5, -1.5],
    [width + 1.5, -1.5, gateX + 5, -1.5],
    [gateX - 5, -1.5, -1.5, -1.5],
  ];
  return (
    <group>
      {segs.map(([x0, y0, x1, y1], i) => {
        const len = Math.hypot(x1 - x0, y1 - y0);
        const ang = Math.atan2(x1 - x0, -(y1 - y0));
        return (
          <mesh key={i} position={L((x0 + x1) / 2, (y0 + y1) / 2, 0.9)} rotation-y={ang}>
            <boxGeometry args={[0.15, 1.8, len]} />
            <meshStandardMaterial color="#64748b" transparent opacity={0.55} metalness={0.6} roughness={0.3} />
          </mesh>
        );
      })}
    </group>
  );
}

function Gate({ x }: { x: number }) {
  return (
    <group position={L(x, -2)}>
      <mesh position={[-5.5, 1.3, 0]} castShadow>
        <boxGeometry args={[2.4, 2.6, 2.4]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
      <mesh position={[-4.2, 1, 0]}>
        <boxGeometry args={[0.3, 1.2, 0.3]} />
        <meshStandardMaterial color="#e2e8f0" />
      </mesh>
      <mesh position={[-0.2, 1.5, 0]}>
        <boxGeometry args={[8, 0.14, 0.14]} />
        <meshStandardMaterial color="#ef4444" emissive="#7f1d1d" />
      </mesh>
      <mesh position={[-5.5, 2.75, 0]}>
        <boxGeometry args={[2.6, 0.12, 2.6]} />
        <meshBasicMaterial color={new THREE.Color('#5eead4').multiplyScalar(2.5)} toneMapped={false} />
      </mesh>
    </group>
  );
}
