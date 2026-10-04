/**
 * Placeholder implementation of the ZenCabs REST contract on top of the
 * simulation engine. Used by:
 *   - MockApiClient (in-browser, DATA_MODE = MOCK)
 *   - server/index.ts (reference HTTP server, lets the UI run in LIVE mode)
 */
import { ApiError } from '../contracts/api';
import type { DispatchRequest, VehicleStatusUpdate } from '../contracts/types';
import type { SimulationEngine } from './SimulationEngine';

export interface RouteRequest {
  method: 'GET' | 'POST';
  path: string;
  query: URLSearchParams;
  body?: unknown;
}

type Handler = (params: Record<string, string>, req: RouteRequest) => unknown;

export function createMockRouter(engine: SimulationEngine) {
  const routes: { method: string; pattern: RegExp; keys: string[]; handler: Handler }[] = [];
  const add = (method: string, path: string, handler: Handler) => {
    const keys: string[] = [];
    const pattern = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
    routes.push({ method, pattern, keys, handler });
  };
  const notFound = (what: string) => {
    throw new ApiError(404, `${what} not found`);
  };

  add('GET', '/api/vehicles', () => engine.getVehicles());
  add('GET', '/api/vehicles/:id', (p) => engine.getVehicle(p.id) ?? notFound('Vehicle'));
  add('GET', '/api/vehicles/:id/trips', (p) => engine.getTrips({ vehicleId: p.id }));
  add('GET', '/api/vehicles/:id/locations', (p) => engine.getLocationHistory(p.id));
  add('GET', '/api/drivers', () => engine.getDrivers());
  add('GET', '/api/drivers/:id', (p) => engine.getDriver(p.id) ?? notFound('Driver'));
  add('GET', '/api/trips', (_, r) => engine.getTrips({ vehicleId: r.query.get('vehicleId') ?? undefined, status: r.query.get('status') ?? undefined }));
  add('GET', '/api/trips/:id', (p) => engine.getTrip(p.id) ?? notFound('Trip'));
  add('GET', '/api/bookings', () => engine.getBookings());
  add('GET', '/api/parking', () => engine.getParking());
  add('GET', '/api/parking/layout', () => engine.layout);
  add('GET', '/api/fleet/status', () => engine.getFleetStatus());
  add('GET', '/api/fleet/analytics', () => engine.getAnalytics());
  add('GET', '/api/zones', () => engine.zones);
  add('GET', '/api/zones/demand', () => engine.getZoneDemand());
  add('GET', '/api/alerts', () => engine.getAlerts());
  add('POST', '/api/alerts/:id/ack', (p) => engine.ackAlert(p.id) ?? notFound('Alert'));
  add('GET', '/api/gps/latest', () => engine.getLatestFixes());
  add('GET', '/api/map/network', () => engine.network);
  add('POST', '/api/dispatch', (_, r) => {
    const body = r.body as DispatchRequest;
    if (!body?.pickup || !body?.destination) throw new ApiError(400, 'pickup and destination are required');
    return engine.dispatch(body);
  });
  add('POST', '/api/vehicle/status', (_, r) => {
    const body = r.body as VehicleStatusUpdate;
    if (!body?.vehicleId || !body?.status) throw new ApiError(400, 'vehicleId and status are required');
    try {
      return engine.setVehicleStatus(body);
    } catch (e: any) {
      throw new ApiError(e.status ?? 500, e.message);
    }
  });

  return function handle(req: RouteRequest): unknown {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = req.path.match(r.pattern);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return r.handler(params, req);
    }
    throw new ApiError(404, `No route for ${req.method} ${req.path}`);
  };
}
