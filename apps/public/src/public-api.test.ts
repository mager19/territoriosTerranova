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

const ROUTE = {
  type: 'LineString',
  coordinates: [
    [-75.5738, 6.3575],
    [-75.5735, 6.358],
    [-75.5732, 6.3585]
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
        remainingAreaStatus: 'unknown',
        route: null
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
        remainingAreaStatus: 'recorded',
        route: null
      })
    );

    const result = await fetchPublicTerritory('tok-abc', fetchImpl, 'https://api.example.test');

    expect(result).toEqual({
      status: 'ok',
      view: {
        territoryName: 'Navarra Norte',
        boundary: BOUNDARY,
        remainingArea: BOUNDARY,
        remainingAreaStatus: 'recorded',
        route: null,
        note: null,
        coveredArea: null
      }
    });
  });

  it('returns the route line when one was recorded — the one deliberate exception to the exclusion list', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        territoryName: 'Navarra Norte',
        boundary: BOUNDARY,
        remainingArea: null,
        remainingAreaStatus: 'unknown',
        route: ROUTE
      })
    );

    const result = await fetchPublicTerritory('tok-abc', fetchImpl, 'https://api.example.test');

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.view.route).toEqual(ROUTE);
    }
  });

  it('accepts a MultiPolygon remaining area — subtracting a session can split what is left', async () => {
    const multi = { type: 'MultiPolygon', coordinates: [BOUNDARY.coordinates] };
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { territoryName: 'T-01', boundary: BOUNDARY, remainingArea: multi, remainingAreaStatus: 'recorded', route: null })
    );

    const result = await fetchPublicTerritory('tok-abc', fetchImpl, 'https://api.example.test');

    expect(result).toMatchObject({ status: 'ok', view: { remainingArea: multi, remainingAreaStatus: 'recorded' } });
  });

  it('keeps an explicit empty remaining area ("nothing left") distinct from unknown', async () => {
    const empty = { type: 'Polygon', coordinates: [] };
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { territoryName: 'T-01', boundary: BOUNDARY, remainingArea: empty, remainingAreaStatus: 'recorded', route: null })
    );

    const result = await fetchPublicTerritory('tok-abc', fetchImpl, 'https://api.example.test');

    expect(result).toMatchObject({ status: 'ok', view: { remainingArea: empty, remainingAreaStatus: 'recorded' } });
  });

  it('carries the latest session note (2026-10-03) and the merged covered area (2026-09-26)', async () => {
    const note = 'Quedamos en la esquina de la Diagonal 57 con 19C';
    const coveredArea = { type: 'MultiPolygon', coordinates: [BOUNDARY.coordinates, BOUNDARY.coordinates] };
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        territoryName: 'T-01',
        boundary: BOUNDARY,
        remainingArea: null,
        remainingAreaStatus: 'unknown',
        route: null,
        note,
        coveredArea
      })
    );

    const result = await fetchPublicTerritory('tok-abc', fetchImpl, 'https://api.example.test');

    expect(result).toMatchObject({ status: 'ok', view: { note, coveredArea } });
  });

  it('accepts a Polygon or an explicit empty polygon as the covered area', async () => {
    for (const coveredArea of [BOUNDARY, { type: 'Polygon', coordinates: [] }]) {
      const fetchImpl = vi.fn().mockResolvedValue(
        jsonResponse(200, { territoryName: 'T-01', boundary: BOUNDARY, remainingArea: null, remainingAreaStatus: 'unknown', route: null, note: null, coveredArea })
      );

      const result = await fetchPublicTerritory('tok-abc', fetchImpl, 'https://api.example.test');

      expect(result).toMatchObject({ status: 'ok', view: { coveredArea } });
    }
  });

  it('reads a missing note / covered area (an older API) as null, not as an error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { territoryName: 'T-01', boundary: BOUNDARY, remainingArea: null, remainingAreaStatus: 'unknown', route: null })
    );

    const result = await fetchPublicTerritory('tok-abc', fetchImpl, 'https://api.example.test');

    expect(result).toMatchObject({ status: 'ok', view: { note: null, coveredArea: null } });
  });

  it('reads a blank note as null — nothing to show', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { territoryName: 'T-01', boundary: BOUNDARY, remainingArea: null, remainingAreaStatus: 'unknown', route: null, note: '   ' })
    );

    const result = await fetchPublicTerritory('tok-abc', fetchImpl, 'https://api.example.test');

    expect(result).toMatchObject({ status: 'ok', view: { note: null } });
  });

  it('treats an invalid note or covered area shape as "error", never a fabricated view', async () => {
    const invalid = [
      { note: 42, coveredArea: null },
      { note: { text: 'nope' }, coveredArea: null },
      { note: null, coveredArea: ROUTE },
      { note: null, coveredArea: { type: 'Point', coordinates: [0, 0] } }
    ];
    for (const fields of invalid) {
      const fetchImpl = vi.fn().mockResolvedValue(
        jsonResponse(200, { territoryName: 'T-01', boundary: BOUNDARY, remainingArea: null, remainingAreaStatus: 'unknown', route: null, ...fields })
      );

      expect(await fetchPublicTerritory('tok-abc', fetchImpl, 'https://api.example.test')).toEqual({ status: 'error' });
    }
  });

  it('treats an invalid route shape as "error", never a fabricated view', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        territoryName: 'Navarra Norte',
        boundary: BOUNDARY,
        remainingArea: null,
        remainingAreaStatus: 'unknown',
        route: { type: 'Point', coordinates: [0, 0] }
      })
    );

    const result = await fetchPublicTerritory('tok-abc', fetchImpl, 'https://api.example.test');

    expect(result).toEqual({ status: 'error' });
  });

  it('drops any field beyond the seven-key allowlist — an unexpected field never reaches the returned view', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        territoryName: 'Navarra Norte',
        boundary: BOUNDARY,
        remainingArea: null,
        remainingAreaStatus: 'unknown',
        route: null,
        note: null,
        coveredArea: null,
        pausePoint: { type: 'Point', coordinates: [-75.5735, 6.358] },
        assignedTo: 'field-worker-1',
        recordedBy: 'worker-1',
        recordedAt: '2026-09-26T10:00:00Z',
        sessions: [BOUNDARY],
        notes: 'private admin note',
        id: 42
      })
    );

    const result = await fetchPublicTerritory('tok-abc', fetchImpl, 'https://api.example.test');

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(Object.keys(result.view).sort()).toEqual(
        ['boundary', 'coveredArea', 'note', 'remainingArea', 'remainingAreaStatus', 'route', 'territoryName'].sort()
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
