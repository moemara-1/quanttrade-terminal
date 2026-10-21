import express, { type ErrorRequestHandler } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { NanoGptJobs, NanoGptJobError } from './nanogpt-jobs.ts';

export interface NanoGptJobService {
  start(owner: string, input: unknown): string | Promise<string>;
  read(owner: string, id: string, offset: number): Response | null | Promise<Response | null>;
  cancel(owner: string, id: string): void | Promise<void>;
  close(): void;
}
const ownerSchema = z.string().regex(/^[a-f0-9]{64}$/);
const idSchema = z.string().uuid();
const safeHeaders = ['Content-Type', 'X-QuantTrade-AI-Upstream', 'X-QuantTrade-AI-Failure','X-QuantTrade-AI-Rejection', 'X-Request-ID', 'Retry-After'];

/** App restarts close only this client, never the separately-owned provider jobs. */
export class NanoGptWorkerClient implements NanoGptJobService {
  constructor(private url: string, private token: string, private request: typeof fetch = fetch) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/')
      throw new Error('Inference worker must use a local HTTP origin');
    if (!token) throw new Error('Inference worker authorization is required');
  }
  private async send(owner: string, path: string, method: string, input?: unknown) {
    ownerSchema.parse(owner);
    try {
      return await this.request(new URL(path, this.url), {
        method, redirect: 'error',
        headers: { Authorization: `Bearer ${this.token}`, 'X-QuantTrade-AI-Owner': owner, 'Content-Type': 'application/json' },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
        signal: AbortSignal.timeout(method === 'GET' ? 650000 : 15000),
      });
    } catch {
      throw new NanoGptJobError(503, 'Inference service is temporarily unreachable; existing jobs were not restarted');
    }
  }
  async start(owner: string, input: unknown) {
    const response = await this.send(owner, '/jobs', 'POST', input);
    if (!response.ok) { await response.body?.cancel(); throw new NanoGptJobError(response.status >= 500 ? 503 : response.status, 'Inference request could not be accepted'); }
    return z.object({ id: idSchema }).parse(await response.json()).id;
  }
  async read(owner: string, id: string, offset: number) {
    idSchema.parse(id);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new NanoGptJobError(400, 'Invalid inference response offset');
    const response = await this.send(owner, `/jobs/${id}?offset=${offset}`, 'GET');
    if (response.status === 202) { await response.body?.cancel(); return null; }
    return response;
  }
  async cancel(owner: string, id: string) {
    idSchema.parse(id);
    const response = await this.send(owner, `/jobs/${id}`, 'DELETE');
    await response.body?.cancel();
    if (!response.ok) throw new NanoGptJobError(response.status, 'Inference cancellation could not be verified');
  }
  close() { /* Provider jobs belong to the independent worker, not this bridge. */ }
}

export function createNanoGptWorker(token: string, jobs = new NanoGptJobs()) {
  if (!token) throw new Error('Inference worker authorization is required');
  const app = express();
  let draining = false;
  app.disable('x-powered-by');
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use((req, res, next) => {
    const authorization = req.get('Authorization') ?? '';
    const expected = `Bearer ${token}`;
    if (Buffer.byteLength(authorization) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(authorization), Buffer.from(expected))) {
      res.status(401).json({ error: 'Inference worker authorization required' }); return;
    }
    if (req.path === '/status') { next(); return; }
    const owner = ownerSchema.safeParse(req.get('X-QuantTrade-AI-Owner'));
    if (!owner.success) { res.status(400).json({ error: 'Invalid inference scope' }); return; }
    res.locals.owner = owner.data; next();
  });
  app.get('/status', (_req, res) => res.json({ active: jobs.activeCount, retained: jobs.retainedCount, draining }));
  app.post('/jobs', express.json({ limit: '2mb' }), (req, res) => {
    if (draining) res.set('Retry-After', '2');
    res.status(201).json({ id: jobs.start(String(res.locals.owner), req.body, !draining) });
  });
  app.get('/jobs/:id', async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const raw = req.query.offset ?? '0';
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) throw new NanoGptJobError(400, 'Invalid inference response offset');
    const response = jobs.read(String(res.locals.owner), id, Number(raw));
    if (!response) { res.set('Retry-After', '1').status(202).end(); return; }
    res.status(response.status);
    for (const name of safeHeaders) { const value = response.headers.get(name); if (value) res.set(name, value); }
    if (!response.body) { res.end(); return; }
    const reader = response.body.getReader();
    const disconnect = () => { void reader.cancel().catch(() => undefined); };
    res.once('close', disconnect);
    try {
      while (!res.destroyed) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (!res.write(chunk.value)) await new Promise<void>(resolve => {
          const done = () => { res.off('drain', done); res.off('close', done); resolve(); };
          res.once('drain', done); res.once('close', done);
          if (res.destroyed) done();
        });
      }
      if (!res.destroyed) res.end();
    } catch { res.destroy(); }
    finally { res.off('close', disconnect); reader.releaseLock(); }
  });
  app.delete('/jobs/:id', (req, res) => { jobs.cancel(String(res.locals.owner), idSchema.parse(req.params.id)); res.status(204).end(); });
  app.use(((error: unknown, _req, res, _next) => {
    if (res.headersSent) { res.destroy(); return; }
    const tooLarge = typeof error === 'object' && error !== null && 'status' in error && error.status === 413;
    res.status(error instanceof NanoGptJobError ? error.status : tooLarge ? 413 : 400).json({ error: error instanceof NanoGptJobError ? error.message : 'Invalid inference request' });
  }) satisfies ErrorRequestHandler);
  return { app, jobs, drain: () => { draining = true; }, close: () => jobs.close() };
}
