import { useEffect, useState } from 'react';

export async function request<T>(token: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(path === '/agent' ? 75_000 : 20_000),
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string'
      ? payload.error : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

export function useResource<T>(token: string, path: string | null, period: number, revision = 0) {
  const [state, setState] = useState<{ key: string; data?: T; error?: string; updatedAt?: number }>({ key: '' });
  const key = `${token}:${path}`;
  useEffect(() => {
    if (!path) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    async function poll() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);
      try {
        const data = await request<T>(token, path!, undefined, controller.signal);
        if (!disposed) setState({ key, data, updatedAt: Date.now() });
      } catch (error) {
        if (!disposed) setState(previous => ({
          ...(previous.key === key ? previous : { key }),
          error: error instanceof Error ? error.message : 'Service unavailable',
        }));
      } finally {
        clearTimeout(timeout);
        if (!disposed) timer = setTimeout(poll, period);
      }
    }
    void poll();
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); };
  }, [token, path, key, period, revision]);
  return state.key === key ? state : { key, data: undefined, error: undefined, updatedAt: undefined };
}
