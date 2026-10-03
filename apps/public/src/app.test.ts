import { describe, expect, it, vi } from 'vitest';

import { runApp } from './app.js';
import { UNAVAILABLE_MESSAGE } from './status.js';

const BOUNDARY = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [-75.574, 6.357],
      [-75.572, 6.357],
      [-75.572, 6.359],
      [-75.574, 6.359],
      [-75.574, 6.357]
    ]
  ]
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('runApp', () => {
  it('shows the unavailable message and never calls the map when the URL carries no token', async () => {
    const root = document.createElement('div');
    const onTerritoryResolved = vi.fn();

    await runApp(root, { locationHash: '', onTerritoryResolved });

    expect(root.textContent).toContain(UNAVAILABLE_MESSAGE);
    expect(onTerritoryResolved).not.toHaveBeenCalled();
  });

  it('resolves a fixed /t/<slug> URL through the slug endpoint', async () => {
    const root = document.createElement('div');
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        territoryName: 'Nv-01',
        boundary: BOUNDARY,
        remainingArea: null,
        remainingAreaStatus: 'unknown',
        route: null
      })
    );
    const onTerritoryResolved = vi.fn();

    await runApp(root, { locationPathname: '/t/nv-01', locationHash: '', fetchImpl, onTerritoryResolved });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toMatch(/\/public\/t\/nv-01$/);
    expect(root.querySelector('h1')?.textContent).toBe('Nv-01');
    expect(onTerritoryResolved).toHaveBeenCalledTimes(1);
  });

  it('shows the neutral unavailable message for a malformed slug and never fetches', async () => {
    const root = document.createElement('div');
    const fetchImpl = vi.fn();

    await runApp(root, { locationPathname: '/t/NV%2001', locationHash: '', fetchImpl });

    expect(root.textContent).toContain(UNAVAILABLE_MESSAGE);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('shows the neutral unavailable message for an unknown slug (404)', async () => {
    const root = document.createElement('div');
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, { error: 'not_found' }));

    await runApp(root, { locationPathname: '/t/no-such-territory', locationHash: '', fetchImpl });

    expect(root.textContent).toContain(UNAVAILABLE_MESSAGE);
  });

  it('renders the attribution line for the basemap main.ts selected', async () => {
    const root = document.createElement('div');

    await runApp(root, { locationHash: '', basemap: 'maptiler' });

    expect(root.querySelector('p.attribution')?.textContent).toBe('© MapTiler © OpenStreetMap contributors');
  });

  it('resolves a valid token and invokes the map callback exactly once', async () => {
    const root = document.createElement('div');
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        territoryName: 'Navarra Norte',
        boundary: BOUNDARY,
        remainingArea: null,
        remainingAreaStatus: 'unknown',
        route: null
      })
    );
    const onTerritoryResolved = vi.fn();

    await runApp(root, { locationHash: '#tok-abc', fetchImpl, onTerritoryResolved });

    expect(root.querySelector('h1')?.textContent).toBe('Navarra Norte');
    expect(onTerritoryResolved).toHaveBeenCalledTimes(1);
  });

  it('never invokes the map callback for a revoked/expired/unknown token', async () => {
    const root = document.createElement('div');
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, { error: 'not_found' }));
    const onTerritoryResolved = vi.fn();

    await runApp(root, { locationHash: '#tok-abc', fetchImpl, onTerritoryResolved });

    expect(root.textContent).toContain(UNAVAILABLE_MESSAGE);
    expect(onTerritoryResolved).not.toHaveBeenCalled();
  });
});
