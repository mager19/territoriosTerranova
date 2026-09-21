import { extractToken } from './token.js';
import { fetchPublicTerritory, type PublicTerritoryResult } from './public-api.js';
import { mountPage, renderStatus, type PageElements } from './render.js';

export interface RunAppDeps {
  readonly locationHash: string;
  readonly fetchImpl?: typeof fetch;
  /**
   * Invoked only for a resolved ('ok') territory — keeps every
   * MapLibre/WebGL touch out of the unit-tested path, the same separation
   * A5 kept between its pure drawing state and its map glue. main.ts wires
   * this to the real map; tests pass a spy.
   */
  readonly onTerritoryResolved?: (
    elements: PageElements,
    result: Extract<PublicTerritoryResult, { status: 'ok' }>
  ) => void;
}

export async function runApp(root: HTMLElement, deps: RunAppDeps): Promise<void> {
  const elements = mountPage(root);
  renderStatus(elements, { status: 'loading' });

  const token = extractToken(deps.locationHash);
  if (token === null) {
    // No token in the URL is not distinguished from a revoked/expired/
    // unknown one — same neutral message, same as a genuinely invalid
    // share link (A6 brief DoD).
    renderStatus(elements, { status: 'unavailable' });
    return;
  }

  const result = await fetchPublicTerritory(token, deps.fetchImpl);
  renderStatus(elements, result);

  if (result.status === 'ok') {
    deps.onTerritoryResolved?.(elements, result);
  }
}
