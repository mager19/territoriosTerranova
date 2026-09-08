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

  it('resolves a valid token and invokes the map callback exactly once', async () => {
    const root = document.createElement('div');
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        territoryName: 'Navarra Norte',
        boundary: BOUNDARY,
        remainingArea: null,
        remainingAreaStatus: 'unknown'
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
