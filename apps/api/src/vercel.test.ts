import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.js';
import { createVercelHandler, toApiUrl, type NodeRequestHandler } from './vercel.js';

describe('toApiUrl', () => {
  it.each([
    ['/api/admin/me', '/admin/me'],
    ['/api/public/territories/tok-abc', '/public/territories/tok-abc'],
    ['/api/admin/territories?status=active&page=2', '/admin/territories?status=active&page=2'],
    ['/api', '/'],
    ['/api/', '/'],
    ['/health', '/health']
  ])('strips the /api prefix: %s → %s', (raw, expected) => {
    expect(toApiUrl(raw)).toBe(expected);
  });

  it('does not strip a prefix that only looks like /api', () => {
    expect(toApiUrl('/apiary')).toBe('/apiary');
  });

  it('restores the path from the rewrite parameter when Vercel hands over the rewritten URL', () => {
    expect(toApiUrl('/api?__path=admin/me')).toBe('/admin/me');
    expect(toApiUrl('/api?__path=admin/territories&status=active')).toBe('/admin/territories?status=active');
  });

  it('prefers the original path and always drops the rewrite parameter', () => {
    expect(toApiUrl('/api/admin/me?__path=admin/me')).toBe('/admin/me');
    expect(toApiUrl('/api/admin/me?__path=public/x&a=1')).toBe('/admin/me?a=1');
  });

  it('treats a missing URL as the root', () => {
    expect(toApiUrl(undefined)).toBe('/');
  });
});

describe('createVercelHandler', () => {
  let server: Server | undefined;
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await app?.close();
    server = undefined;
    app = undefined;
  });

  /** Serves the handler on a real Node HTTP server: real IncomingMessage/ServerResponse, as on Vercel. */
  async function serve(handler: NodeRequestHandler): Promise<string> {
    server = createServer((request, response) => {
      void handler(request, response);
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  async function healthApp(): Promise<FastifyInstance> {
    app = await buildApp({ queryPostgisVersion: async () => '3.4.3' }, { logger: false });
    app.post('/test-only/echo', async (request) => ({ body: request.body, url: request.url }));
    return app;
  }

  it('routes /api/* to the API with the prefix stripped', async () => {
    const base = await serve(createVercelHandler(healthApp));

    const response = await fetch(`${base}/api/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', database: { up: true, postgisVersion: '3.4.3' } });
  });

  it('passes request bodies and query strings through untouched', async () => {
    const base = await serve(createVercelHandler(healthApp));

    const response = await fetch(`${base}/api/test-only/echo?x=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.org' })
    });

    expect(await response.json()).toEqual({ body: { email: 'a@example.org' }, url: '/test-only/echo?x=1' });
  });

  it('builds the app once per instance, not once per request', async () => {
    const load = vi.fn(healthApp);
    const base = await serve(createVercelHandler(load));

    await Promise.all([fetch(`${base}/api/health`), fetch(`${base}/api/health`)]);
    await fetch(`${base}/api/health`);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('answers a bare 500 when the app cannot start, and tries again on the next request', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const load = vi
      .fn<() => Promise<FastifyInstance>>()
      .mockRejectedValueOnce(new Error('ADMIN_1_EMAIL and ADMIN_1_PASSWORD are required'))
      .mockImplementation(healthApp);
    const base = await serve(createVercelHandler(load));

    const failed = await fetch(`${base}/api/health`);
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: 'internal_error' });
    expect(failed.headers.get('cache-control')).toBe('no-store');

    const recovered = await fetch(`${base}/api/health`);
    expect(recovered.status).toBe(200);
    expect(load).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });
});
