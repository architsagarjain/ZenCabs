/**
 * Realistic static data for the 40-vehicle ZenCabs mock fleet.
 * Only the simulation (mock backend) imports this — never the UI.
 */
import type { Driver, FuelKind, Vehicle, VehicleType } from '../contracts/types';

export { rng } from '../core/random';
import { rng } from '../core/random';

const DRIVER_NAMES = [
  'Rahul Sharma', 'Amit Gupta', 'Vikram Singh Jamwal', 'Sandeep Kumar', 'Ravi Verma', 'Mohammad Iqbal',
  'Ajay Raina', 'Sunil Koul', 'Manoj Bhat', 'Arjun Jamwal', 'Deepak Manhas', 'Rajesh Slathia',
  'Harpreet Singh', 'Gurpreet Singh', 'Imran Khan', 'Farooq Ahmed', 'Naveen Dogra', 'Sanjay Thakur',
  'Pankaj Choudhary', 'Ankit Mahajan', 'Rohit Gupta', 'Kuldeep Singh', 'Ashok Kumar', 'Vinod Sharma',
  'Tariq Hussain', 'Bilal Ahmed', 'Rakesh Langeh', 'Suresh Bhagat', 'Anil Kotwal', 'Priya Sharma',
  'Jatinder Singh', 'Ramesh Chander', 'Vivek Bali', 'Kamal Kishore', 'Pawan Kumar', 'Sahil Gupta',
  'Nitin Abrol', 'Neha Kour', 'Gagan Deep Singh', 'Prem Nath',
];

const MODELS: { model: string; type: VehicleType; fuel: FuelKind; count: number }[] = [
  { model: 'Maruti Suzuki Dzire', type: 'SEDAN', fuel: 'CNG', count: 9 },
  { model: 'Toyota Etios', type: 'SEDAN', fuel: 'DIESEL', count: 4 },
  { model: 'Honda Amaze', type: 'SEDAN', fuel: 'PETROL', count: 3 },
  { model: 'Toyota Innova Crysta', type: 'SUV', fuel: 'DIESEL', count: 5 },
  { model: 'Maruti Suzuki Ertiga', type: 'SUV', fuel: 'CNG', count: 3 },
  { model: 'Tata Tigor EV', type: 'EV_SEDAN', fuel: 'ELECTRIC', count: 6 },
  { model: 'Tata Nexon EV', type: 'EV_SEDAN', fuel: 'ELECTRIC', count: 4 },
  { model: 'Maruti Suzuki WagonR', type: 'HATCHBACK', fuel: 'CNG', count: 6 },
];

const AVATAR_BG = ['#0ea5e9', '#14b8a6', '#8b5cf6', '#f97316', '#ec4899', '#22c55e', '#eab308', '#6366f1'];

export function avatarDataUri(name: string, i: number): string {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
  const bg = AVATAR_BG[i % AVATAR_BG.length];
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${bg}'/><stop offset='1' stop-color='#0f172a'/></linearGradient></defs><rect width='96' height='96' rx='48' fill='url(#g)'/><text x='48' y='60' font-family='Inter,Arial' font-size='36' font-weight='700' fill='white' text-anchor='middle'>${initials}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export interface SeedResult {
  vehicles: Vehicle[];
  drivers: Driver[];
}

export function seedFleet(now: number): SeedResult {
  const r = rng(20240611);
  const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  const modelList: { model: string; type: VehicleType; fuel: FuelKind }[] = [];
  for (const m of MODELS) for (let i = 0; i < m.count; i++) modelList.push(m);
  // deterministic shuffle
  for (let i = modelList.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [modelList[i], modelList[j]] = [modelList[j], modelList[i]];
  }

  const vehicles: Vehicle[] = [];
  const drivers: Driver[] = [];
  const usedRegs = new Set<string>();

  for (let i = 0; i < 40; i++) {
    const vehicleId = `ZEN-${String(i + 1).padStart(3, '0')}`;
    let reg = '';
    do {
      reg = `JK02${letters[Math.floor(r() * letters.length)]}${letters[Math.floor(r() * letters.length)]}${String(1000 + Math.floor(r() * 9000))}`;
    } while (usedRegs.has(reg));
    usedRegs.add(reg);

    const name = DRIVER_NAMES[i];
    const driverId = `DRV-${String(101 + i)}`;
    const phone = `+91 ${['94191', '70060', '96220', '78894', '88990'][i % 5]} ${String(10000 + Math.floor(r() * 89999))}`;
    const photo = avatarDataUri(name, i);
    const m = modelList[i];
    const isEV = m.fuel === 'ELECTRIC';

    const tripsToday = 2 + Math.floor(r() * 9);
    const avgFare = 280 + r() * 380;
    const revenueToday = Math.round(tripsToday * avgFare);
    const distanceToday = Math.round(tripsToday * (8 + r() * 12));

    drivers.push({
      driverId,
      name,
      phone,
      photo,
      licenseNumber: `JK02 2${String(10 + Math.floor(r() * 12))}000${String(Math.floor(r() * 99999)).padStart(5, '0')}`,
      rating: Math.round((4.2 + r() * 0.78) * 100) / 100,
      joinedOn: new Date(now - (90 + Math.floor(r() * 1400)) * 86_400_000).toISOString().slice(0, 10),
      shiftState: 'ON_SHIFT',
      shiftStart: now - (2 + r() * 6) * 3_600_000,
      shiftEnd: null,
      assignedVehicleId: vehicleId,
      tripsToday,
      earningsToday: Math.round(revenueToday * 0.78),
      hoursOnlineToday: Math.round((2 + r() * 7) * 10) / 10,
      languages: r() > 0.5 ? ['Hindi', 'Dogri', 'English'] : r() > 0.5 ? ['Hindi', 'Urdu', 'Kashmiri'] : ['Hindi', 'Punjabi', 'English'],
    });

    vehicles.push({
      vehicleId,
      registrationNumber: reg,
      vehicleType: m.type,
      vehicleModel: m.model,
      fuelKind: m.fuel,
      driverId,
      driverName: name,
      driverPhone: phone,
      driverPhoto: photo,
      status: 'AVAILABLE',
      latitude: 0,
      longitude: 0,
      speed: 0,
      heading: 0,
      parkingBay: null,
      parkingEntryTime: null,
      parkingDuration: null,
      currentTripId: null,
      pickupLocation: null,
      destination: null,
      tripStartTime: null,
      estimatedTripEnd: null,
      tripsToday,
      revenueToday,
      distanceToday,
      idleTimeToday: Math.round((0.3 + r() * 2.6) * 3_600_000),
      batteryPercentage: isEV ? Math.round(35 + r() * 60) : null,
      fuelPercentage: isEV ? null : Math.round(25 + r() * 70),
      lastGpsUpdate: now,
      maintenanceStatus: r() > 0.85 ? 'DUE_SOON' : 'OK',
      odometerKm: Math.round(18_000 + r() * 140_000),
      zoneId: null,
    });
  }
  return { vehicles, drivers };
}

export const CUSTOMER_NAMES = [
  'Ananya Gupta', 'Rohan Mehta', 'Simran Kaur', 'Aditya Raina', 'Kavya Sharma', 'Zoya Mir', 'Karan Malhotra',
  'Ishita Bhat', 'Aman Verma', 'Sana Shah', 'Nikhil Jain', 'Pooja Dogra', 'Rajat Kapoor', 'Meera Pandit',
  'Faisal Lone', 'Tanvi Arora', 'Varun Khanna', 'Riya Bakshi', 'Yusuf Wani', 'Divya Saini',
];
