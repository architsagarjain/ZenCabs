import { ApiError } from '../contracts/api';

/** Transport-agnostic REST client. Services only ever depend on this interface. */
export interface ApiClient {
  get<T>(path: string, query?: Record<string, string | undefined>): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
}

/** LIVE mode: real HTTP against the ZenCabs backend. */
export class HttpApiClient implements ApiClient {
  constructor(
    private baseUrl: string,
    private getToken: () => string | null = () => null,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown, query?: Record<string, string | undefined>): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(query ?? {})) if (v != null) url.searchParams.set(k, v);
    const token = this.getToken();
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      let msg = res.statusText;
      try {
        msg = (await res.json()).error ?? msg;
      } catch {
        /* non-JSON error */
      }
      throw new ApiError(res.status, msg);
    }
    return (await res.json()) as T;
  }

  get<T>(path: string, query?: Record<string, string | undefined>) {
    return this.request<T>('GET', path, undefined, query);
  }

  post<T>(path: string, body: unknown) {
    return this.request<T>('POST', path, body);
  }
}
