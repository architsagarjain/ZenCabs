/**
 * ZenCabs reference backend (placeholder).
 *
 * Serves the REST + WebSocket contracts from docs/API_CONTRACTS.md on top of the
 * same simulation engine the browser uses in MOCK mode. Purpose:
 *   1. prove the UI runs unchanged in DATA_MODE = "LIVE" (npm run server + npm run dev:live)
 *   2. give the backend team an executable spec of every endpoint and event.
 *
 * Replace the engine calls with database queries / GPS-vendor feeds to go to production.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { ApiError } from '../src/contracts/api';
import type { RealtimeEnvelope, RealtimeEventName } from '../src/contracts/events';
import { SimClock } from '../src/core/clock';
import { SimulationEngine } from '../src/mock/SimulationEngine';
import { createMockRouter } from '../src/mock/mockRouter';

const PORT = Number(process.env.PORT ?? 8787);
const clock = new SimClock(Date.now(), 1); // real time: LIVE clients use wall-clock time
const engine = new SimulationEngine({ clock });
engine.start();
const handle = createMockRouter(engine);

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, null);
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  if (url.pathname === '/health') return send(res, 200, { ok: true, serverTime: clock.now() });
  try {
    const body = req.method === 'POST' ? await readBody(req) : undefined;
    const result = handle({ method: req.method as 'GET' | 'POST', path: url.pathname, query: url.searchParams, body });
    send(res, 200, result);
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    send(res, status, { error: (e as Error).message });
  }
});

const ALL_EVENTS: RealtimeEventName[] = [
  'vehicle.location.updated',
  'vehicle.status.updated',
  'vehicle.entered.parking',
  'vehicle.left.parking',
  'trip.created',
  'trip.started',
  'trip.completed',
  'driver.assigned',
  'alert.created',
  'alert.resolved',
  'booking.created',
  'booking.updated',
  'vehicle.updated',
];

const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Set<WebSocket>();
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});
for (const event of ALL_EVENTS) {
  engine.events.on(event, (data) => {
    const msg = JSON.stringify({ event, data, ts: clock.now() } satisfies RealtimeEnvelope);
    for (const c of clients) if (c.readyState === c.OPEN) c.send(msg);
  });
}

server.listen(PORT, () => {
  console.log(`ZenCabs placeholder backend on http://localhost:${PORT}  (WebSocket ws://localhost:${PORT}/ws)`);
});
