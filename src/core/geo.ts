import type { LatLng } from '../contracts/types';

/**
 * Local tangent-plane projection used everywhere in the 3D scene.
 * Scene axes: +x = east, -z = north (three.js convention, y up). 1 unit = 1 meter.
 * Real GPS coordinates and simulated ones go through the exact same projection.
 */
export const GEO_ORIGIN: LatLng = { lat: 32.7185, lng: 74.8580 }; // Jammu, J&K

const R = 6_378_137;
const DEG = Math.PI / 180;
const cosLat0 = Math.cos(GEO_ORIGIN.lat * DEG);

export function toScene(lat: number, lng: number): { x: number; z: number } {
  const x = (lng - GEO_ORIGIN.lng) * DEG * R * cosLat0;
  const north = (lat - GEO_ORIGIN.lat) * DEG * R;
  return { x, z: -north };
}

export function fromScene(x: number, z: number): LatLng {
  const lat = GEO_ORIGIN.lat + -z / R / DEG;
  const lng = GEO_ORIGIN.lng + x / (R * cosLat0) / DEG;
  return { lat, lng };
}

/** Haversine distance in meters. */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing a → b in degrees (0 = north, clockwise). */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const y = Math.sin((b.lng - a.lng) * DEG) * Math.cos(b.lat * DEG);
  const x = Math.cos(a.lat * DEG) * Math.sin(b.lat * DEG) - Math.sin(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.cos((b.lng - a.lng) * DEG);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

/** Heading in degrees → rotation around scene Y so a model facing -z points that way. */
export function headingToYaw(headingDeg: number): number {
  return -headingDeg * DEG;
}

/** Converts a point in a rotated local frame (meters, x east / y north before rotation) to lat/lng. */
export function localToLatLng(origin: LatLng, bearing: number, x: number, y: number): LatLng {
  const o = toScene(origin.lat, origin.lng);
  const b = bearing * DEG;
  const east = x * Math.cos(b) + y * Math.sin(b);
  const north = -x * Math.sin(b) + y * Math.cos(b);
  return fromScene(o.x + east, o.z - north);
}
