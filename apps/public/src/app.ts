import type { BasemapKind } from './basemap.js';
import { fetchPublicTerritory, type PublicTerritoryResult } from './public-api.js';
import { mountPage, renderStatus, type PageElements } from './render.js';
import { parseShareLink } from './share-link.js';

export interface RunAppDeps {
  /** `window.location.pathname`: a fixed `/t/<slug>` link (2026-10-03). Defaults to the root. */
  readonly locationPathname?: string;
  /** `window.location.hash`: a legacy `#<token>` link. */
  readonly locationHash: string;
  readonly fetchImpl?: typeof fetch;
  /** Which basemap main.ts selected — drives the attribution line. Defaults to the OSM fallback. */
  readonly basemap?: BasemapKind;
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
  const elements = mountPage(root, deps.basemap);
  renderStatus(elements, { status: 'loading' });

  const link = parseShareLink(deps.locationPathname ?? '/', deps.locationHash);
  if (link === null) {
    // No slug or token in the URL (or a malformed slug) is not
    // distinguished from an unknown/revoked/expired one — same neutral
    // message, same as a genuinely invalid share link (A6 brief DoD).
    renderStatus(elements, { status: 'unavailable' });
    return;
  }

  const result = await fetchPublicTerritory(link, deps.fetchImpl);
  renderStatus(elements, result);

  if (result.status === 'ok') {
    deps.onTerritoryResolved?.(elements, result);
  }
}
