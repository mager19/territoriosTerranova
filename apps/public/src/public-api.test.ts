import { describe, expect, it, vi } from 'vitest';

import { fetchPublicTerritory } from './public-api.js';

const BOUNDARY = {
  type: 'Polygon',
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

describe('fetchPublicTerritory', () => {
  it('calls exactly the A4 public endpoint, never an admin URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        territoryName: 'T-01',
        boundary: BOUNDARY,
        remainingArea: null,
        remainingAreaStatus: 'unknown'
      })
    );

    await fetchPublicTerritory('tok-abc', fetchImpl, 'https://api.example.test');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('https://api.example.test/public/territories/tok-abc');
  });

  it('returns the allowlisted view on a valid, recorded response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        territoryName: 'Navarra Norte',
        boundary: BOUNDARY,
        remainingArea: BOUNDARY,
        remainingAreaStatus: 'recorded'
      })
    );

    const result = await fetchPublicTerritory('tok-abc', fetchImpl, 'https://api.example.test');

    expect(result).toEqual({
      status: 'ok',
      view: {
        territoryName: 'Navarra Norte',
        boundary: BOUNDARY,
        remainingArea: BOUNDARY,
        remainingAreaStatus: 'recorded'
      }
    });
  });

  it('drops any field beyond the four-key allowlist — an unexpected field never reaches the returned view', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        territoryName: 'Navarra Norte',
        boundary: BOUNDARY,
        remainingArea: null,
        remainingAreaStatus: 'unknown',
        assignedTo: 'field-worker-1',
        notes: 'private admin note',
        id: 42
      })
    );

    const result = await fetchPublicTerritory('tok-abc', fetchImpl, 'https://api.example.test');

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(Object.keys(result.view).sort()).toEqual(
        ['boundary', 'remainingArea', 'remainingAreaStatus', 'territoryName'].sort()
      );
    }
  });

  it('treats revoked/expired/nonexistent tokens (A4 404) as "unavailable" — a single collapsed outcome', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, { error: 'not_found' }));

    const result = await fetchPublicTerritory('tok-abc', fetchImpl, 'https://api.example.test');

    expect(result).toEqual({ status: 'unavailable' });
  });

  it('treats a network failure as "error", distinct from an unavailable token', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('network down'));

    const result = await fetchPublicTerritory('tok-abc', fetchImpl, 'https://api.example.test');

    expect(result).toEqual({ status: 'error' });
  });

  it('treats a malformed response body as "error", never a fabricated view', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { territoryName: 'T-01' }));

    const result = await fetchPublicTerritory('tok-abc', fetchImpl, 'https://api.example.test');

    expect(result).toEqual({ status: 'error' });
  });

  it('treats a server error (5xx) as "error"', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 500 }));

    const result = await fetchPublicTerritory('tok-abc', fetchImpl, 'https://api.example.test');

    expect(result).toEqual({ status: 'error' });
  });
});
