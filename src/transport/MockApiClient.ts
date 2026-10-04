import type { ApiClient } from './ApiClient';
import type { RouteRequest } from '../mock/mockRouter';

/**
 * MOCK mode: routes the same REST paths to the in-browser mock router.
 * Responses are deep-copied (as if serialized over the network) and delayed
 * slightly so the UI is exercised with realistic async behaviour.
 */
export class MockApiClient implements ApiClient {
  constructor(
    private handle: (req: RouteRequest) => unknown,
    private latencyMs = 25,
  ) {}

  private async call<T>(req: RouteRequest): Promise<T> {
    await new Promise((r) => setTimeout(r, this.latencyMs * (0.5 + Math.random())));
    const result = this.handle(req);
    return JSON.parse(JSON.stringify(result)) as T;
  }

  get<T>(path: string, query?: Record<string, string | undefined>) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) if (v != null) q.set(k, v);
    return this.call<T>({ method: 'GET', path, query: q });
  }

  post<T>(path: string, body: unknown) {
    return this.call<T>({ method: 'POST', path, query: new URLSearchParams(), body: JSON.parse(JSON.stringify(body)) });
  }
}
