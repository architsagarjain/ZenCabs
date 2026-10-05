/**
 * ZenCabs base parking facility (digital twin geometry; layout is illustrative until the real lot is surveyed).
 *
 * Replace this module's output with the real lot survey (same ParkingLotLayout
 * shape) and the 3D twin + simulation follow automatically.
 *
 * Local frame: meters, x → east, y → north, origin = south-west corner of the lot.
 *
 *   y=64 ┌───────────────────────────────────────────┐
 *        │ ║   A01 A02 … A10   (nose north)           │
 *   y=50 │ ║ ═══════ aisle 1 ═══════════════════      │
 *        │ ║   B01 … B10       (nose south)           │
 *        │ ║   C01 … C10       (nose north)           │
 *   y=30 │ ║ ═══════ aisle 2 ═══════════════════      │
 *        │ ║   D01 … D10       (nose south, EV D01-06)│
 *        │ ║   S01 S02 service      [ office ]        │
 *   y=0  └─╨─────────────────────────────────────────┘
 *          gate (x=6)
 */
import { fromScene } from '../../core/geo';
import type { ParkingBay, ParkingLotLayout } from '../../contracts/types';

export const LOT_W = 50;
export const LOT_D = 64;
export const SPINE_X = 6;
export const AISLE_Y = { 1: 50, 2: 29.5 } as const;
const BAY_W = 3;
const BAY_L = 5.4;
const BAY_X0 = 13;

const ROWS: { row: string; y: number; rotation: number; aisle: 1 | 2 }[] = [
  { row: 'A', y: 59, rotation: 0, aisle: 1 },
  { row: 'B', y: 43.5, rotation: 180, aisle: 1 },
  { row: 'C', y: 37.9, rotation: 0, aisle: 2 },
  { row: 'D', y: 23.6, rotation: 180, aisle: 2 },
];

const cache = new Map<string, ParkingLotLayout>();

/** @param lotSW south-west corner of the lot in scene metres (placed by jammuMap.buildWorld). */
export function buildParkingLot(lotSW: { x: number; z: number }): ParkingLotLayout {
  const key = `${lotSW.x.toFixed(2)},${lotSW.z.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const bays: ParkingBay[] = [];
  for (const r of ROWS) {
    for (let i = 0; i < 10; i++) {
      const id = `${r.row}${String(i + 1).padStart(2, '0')}`;
      bays.push({
        bayId: id,
        row: r.row,
        x: BAY_X0 + BAY_W * i + BAY_W / 2,
        y: r.y,
        rotation: r.rotation,
        width: BAY_W,
        length: BAY_L,
        kind: r.row === 'D' && i < 6 ? 'EV_CHARGING' : 'STANDARD',
      });
    }
  }
  bays.push({ bayId: 'S01', row: 'S', x: 17, y: 9, rotation: 180, width: 4.2, length: 7, kind: 'SERVICE' });
  bays.push({ bayId: 'S02', row: 'S', x: 22, y: 9, rotation: 180, width: 4.2, length: 7, kind: 'SERVICE' });

  const layout: ParkingLotLayout = {
    lotId: 'LOT-JMU-01',
    name: 'ZenCabs Base — Gandhi Nagar',
    origin: fromScene(lotSW.x, lotSW.z),
    bearing: 0,
    width: LOT_W,
    depth: LOT_D,
    bays,
    aisles: [
      { id: 'spine', points: [{ x: SPINE_X, y: -4 }, { x: SPINE_X, y: 58 }] },
      { id: 'aisle-1', points: [{ x: SPINE_X, y: AISLE_Y[1] }, { x: 46, y: AISLE_Y[1] }] },
      { id: 'aisle-2', points: [{ x: SPINE_X, y: AISLE_Y[2] }, { x: 46, y: AISLE_Y[2] }] },
      { id: 'service', points: [{ x: SPINE_X, y: 16 }, { x: 28, y: 16 }] },
    ],
    gate: { x: SPINE_X, y: -4, name: 'Main Gate' },
    buildings: [
      { id: 'office', name: 'Ops Office', x: 40, y: 8, w: 14, d: 10, h: 7 },
      { id: 'workshop', name: 'Service Bay', x: 19.5, y: 8, w: 11, d: 10, h: 5.5 },
    ],
  };
  cache.set(key, layout);
  return layout;
}

/** Aisle that serves a bay, and the y at which the vehicle turns into it. */
export function bayAccess(bay: ParkingBay): { aisleY: number } {
  if (bay.row === 'S') return { aisleY: 16 };
  const row = ROWS.find((r) => r.row === bay.row)!;
  return { aisleY: AISLE_Y[row.aisle] };
}
