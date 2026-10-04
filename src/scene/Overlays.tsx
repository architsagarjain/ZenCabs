import { Html, Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { toScene } from '../core/geo';
import type { GPSFix, Trip } from '../contracts/types';
import { SCENE } from '../config/theme';
import { useFleetStore } from '../store/fleetStore';
import { useServices } from '../store/servicesContext';

/** Planned route + pickup/drop pins + GPS breadcrumb trail for the selected vehicle. */
export function RouteOverlay() {
  const { bookingService, gpsService } = useServices();
  const id = useFleetStore((s) => s.selectedVehicleId);
  const v = useFleetStore((s) => (id ? s.vehicleMap[id] : undefined));
  const showRoute = useFleetStore((s) => s.showRoute);
  const showTrails = useFleetStore((s) => s.showTrails);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [trail, setTrail] = useState<GPSFix[]>([]);
  const tripId = v?.currentTripId ?? null;
  const status = v?.status;

  useEffect(() => {
    let alive = true;
    if (!tripId) return setTrip(null);
    bookingService.fetchTrip(tripId).then((t) => alive && setTrip(t)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [tripId, status, bookingService]);

  useEffect(() => {
    if (!id || (!showTrails && !showRoute)) return setTrail([]);
    let alive = true;
    const load = () => gpsService.history(id).then((h) => alive && setTrail(h.slice(-180)));
    load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id, showTrails, showRoute, gpsService]);

  const routePts = useMemo(() => (trip?.route ?? []).map((p) => toScene(p.lat, p.lng)).map((p) => new THREE.Vector3(p.x, 1.2, p.z)), [trip]);
  const trailPts = useMemo(() => trail.map((f) => toScene(f.latitude, f.longitude)).map((p) => new THREE.Vector3(p.x, 0.9, p.z)), [trail]);
  if (!id || !v) return null;
  const toPickup = v.status === 'ASSIGNED' || v.status === 'EN_ROUTE_PICKUP';
  const routeColor = toPickup ? SCENE.routeToPickup : SCENE.routeTrip;
  const pickup = trip && toScene(trip.pickup.lat, trip.pickup.lng);
  const dest = trip && toScene(trip.destination.lat, trip.destination.lng);

  return (
    <group>
      {showRoute && routePts.length > 1 && (status === 'EN_ROUTE_PICKUP' || status === 'ON_TRIP') && (
        <Line points={routePts} color={routeColor} lineWidth={4} dashed={toPickup} dashSize={8} gapSize={5} transparent opacity={0.9} />
      )}
      {(showTrails || showRoute) && trailPts.length > 1 && <Line points={trailPts} color={SCENE.trail} lineWidth={2.5} transparent opacity={0.7} />}
      {showRoute && trip && pickup && (toPickup || status === 'WAITING') && <Pin x={pickup.x} z={pickup.z} color={SCENE.pickupPin} label={`Pickup · ${trip.pickup.name}`} />}
      {showRoute && trip && dest && v.currentTripId && <Pin x={dest.x} z={dest.z} color={SCENE.dropPin} label={`Drop · ${trip.destination.name}`} />}
    </group>
  );
}

function Pin({ x, z, color, label }: { x: number; z: number; color: string; label: string }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock, camera }) => {
    if (!ref.current) return;
    const d = camera.position.distanceTo(new THREE.Vector3(x, 0, z));
    ref.current.scale.setScalar(THREE.MathUtils.clamp(d / 220, 1, 10));
    ref.current.position.y = 0.5 + Math.sin(clock.elapsedTime * 3) * 0.3;
  });
  const c = useMemo(() => new THREE.Color(color), [color]);
  return (
    <group position={[x, 0, z]}>
      <group ref={ref}>
        <mesh position-y={4.5}>
          <sphereGeometry args={[1.1, 16, 12]} />
          <meshBasicMaterial color={c} />
        </mesh>
        <mesh position-y={2}>
          <coneGeometry args={[0.8, 3.5, 12]} />
          <meshBasicMaterial color={c} />
        </mesh>
      </group>
      <mesh rotation-x={-Math.PI / 2} position-y={0.4}>
        <ringGeometry args={[6, 7.5, 40]} />
        <meshBasicMaterial color={c} transparent opacity={0.6} depthWrite={false} />
      </mesh>
      <Html position={[0, 14, 0]} center zIndexRange={[35, 0]} style={{ pointerEvents: 'none' }}>
        <div className="pin-label" style={{ borderColor: color }}>
          {label}
        </div>
      </Html>
    </group>
  );
}

/** Pulsing markers for ride requests that have not been assigned yet. */
export function PendingRequests() {
  const bookings = useFleetStore((s) => s.bookings);
  const pending = bookings.filter((b) => b.status === 'PENDING').slice(0, 40);
  return (
    <group>
      {pending.map((b) => (
        <RequestMarker key={b.bookingId} lat={b.pickup.lat} lng={b.pickup.lng} />
      ))}
    </group>
  );
}

const reqColor = new THREE.Color(SCENE.request);
function RequestMarker({ lat, lng }: { lat: number; lng: number }) {
  const p = useMemo(() => toScene(lat, lng), [lat, lng]);
  const ring = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock, camera }) => {
    const t = (clock.elapsedTime * 0.8) % 1;
    const d = camera.position.distanceTo(new THREE.Vector3(p.x, 0, p.z));
    const base = THREE.MathUtils.clamp(d / 260, 1, 8);
    ring.current?.scale.setScalar(base * (1 + t * 2.5));
    if (mat.current) mat.current.opacity = 0.9 * (1 - t);
  });
  return (
    <group position={[p.x, 0.6, p.z]}>
      <mesh ref={ring} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[3, 4, 32]} />
        <meshBasicMaterial ref={mat} color={reqColor} transparent depthWrite={false} />
      </mesh>
      <mesh position-y={1.5}>
        <sphereGeometry args={[1.4, 12, 10]} />
        <meshBasicMaterial color={reqColor} />
      </mesh>
    </group>
  );
}

/** Operations overlay: zone demand vs supply discs and demand columns. */
export function ZonesOverlay() {
  const { analyticsService, mapService } = useServices();
  useFleetStore((s) => s.analyticsVersion);
  const zones = analyticsService.zoneDemand();
  return (
    <group>
      {zones.map((z) => {
        const zone = mapService.zone(z.zoneId);
        if (!zone) return null;
        const c = toScene(zone.center.lat, zone.center.lng);
        const demand = z.pendingRequests + z.forecastNext30 / 3;
        const ratio = demand > 0 ? z.supply / demand : 2;
        const color = ratio >= 1 ? SCENE.zoneOk : ratio >= 0.5 ? SCENE.zoneTight : SCENE.zoneShort;
        const h = 30 + z.forecastNext30 * 14;
        return (
          <group key={z.zoneId} position={[c.x, 0, c.z]}>
            <mesh rotation-x={-Math.PI / 2} position-y={0.5}>
              <circleGeometry args={[zone.radiusM, 64]} />
              <meshBasicMaterial color={color} transparent opacity={0.14} depthWrite={false} />
            </mesh>
            <mesh rotation-x={-Math.PI / 2} position-y={0.55}>
              <ringGeometry args={[zone.radiusM - 6, zone.radiusM, 96]} />
              <meshBasicMaterial color={color} transparent opacity={0.7} depthWrite={false} />
            </mesh>
            <mesh position-y={h / 2}>
              <cylinderGeometry args={[14, 14, h, 24]} />
              <meshBasicMaterial color={color} transparent opacity={0.35} depthWrite={false} />
            </mesh>
            <Html position={[0, h + 30, 0]} center zIndexRange={[25, 0]} style={{ pointerEvents: 'none' }}>
              <div className="zone-label" style={{ borderColor: color }}>
                <b>{zone.name}</b>
                <span>
                  Demand {z.pendingRequests} now · {z.forecastNext30} next 30m
                </span>
                <span style={{ color }}>
                  Supply {z.supply}
                  {z.gap > 0 ? ` · short ${z.gap}` : ''}
                </span>
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}
