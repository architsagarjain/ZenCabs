import { Emitter, type Unsubscribe } from '../core/emitter';
import type { RealtimeEnvelope, RealtimeEventName, RealtimeEvents } from '../contracts/events';

export type ConnectionState = 'connecting' | 'open' | 'closed';

/** Realtime channel abstraction (WebSocket in LIVE mode, in-memory in MOCK mode). */
export interface RealtimeClient {
  connect(): void;
  disconnect(): void;
  on<E extends RealtimeEventName>(event: E, handler: (data: RealtimeEvents[E], ts: number) => void): Unsubscribe;
  onState(handler: (s: ConnectionState) => void): Unsubscribe;
  readonly state: ConnectionState;
}

abstract class BaseRealtime implements RealtimeClient {
  protected bus = new Emitter<{ [K in RealtimeEventName]: { data: RealtimeEvents[K]; ts: number } }>();
  protected stateBus = new Emitter<{ state: ConnectionState }>();
  state: ConnectionState = 'closed';

  abstract connect(): void;
  abstract disconnect(): void;

  on<E extends RealtimeEventName>(event: E, handler: (data: RealtimeEvents[E], ts: number) => void): Unsubscribe {
    return this.bus.on(event, (p) => handler(p.data as RealtimeEvents[E], p.ts));
  }

  onState(handler: (s: ConnectionState) => void) {
    handler(this.state);
    return this.stateBus.on('state', handler);
  }

  protected setState(s: ConnectionState) {
    this.state = s;
    this.stateBus.emit('state', s);
  }

  protected dispatch(env: RealtimeEnvelope) {
    this.bus.emit(env.event, { data: env.data, ts: env.ts } as any);
  }
}

/** LIVE mode: JSON envelopes over WebSocket with exponential-backoff reconnect. */
export class WebSocketRealtimeClient extends BaseRealtime {
  private ws: WebSocket | null = null;
  private retry = 0;
  private closedByUser = false;

  constructor(private url: string) {
    super();
  }

  connect() {
    this.closedByUser = false;
    this.setState('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setState('open');
    };
    ws.onmessage = (msg) => {
      try {
        this.dispatch(JSON.parse(msg.data as string));
      } catch (e) {
        console.warn('[realtime] bad message', e);
      }
    };
    ws.onclose = () => {
      this.setState('closed');
      if (this.closedByUser) return;
      const delay = Math.min(30_000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }

  disconnect() {
    this.closedByUser = true;
    this.ws?.close();
  }
}

/** MOCK mode: subscribes to the simulation's event stream, same envelopes as the backend. */
export class MockRealtimeClient extends BaseRealtime {
  private unsubs: Unsubscribe[] = [];

  constructor(
    private source: { on: (event: any, h: (p: any) => void) => Unsubscribe },
    private events: RealtimeEventName[],
    private now: () => number,
  ) {
    super();
  }

  connect() {
    this.setState('connecting');
    for (const event of this.events) {
      this.unsubs.push(
        this.source.on(event, (data: unknown) => {
          // Simulate wire serialization so consumers never share engine objects.
          this.dispatch({ event, data: structuredClone(data), ts: this.now() } as RealtimeEnvelope);
        }),
      );
    }
    queueMicrotask(() => this.setState('open'));
  }

  disconnect() {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.setState('closed');
  }
}
