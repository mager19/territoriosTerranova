import { describeState, type ViewState } from './status.js';

export interface PageElements {
  readonly heading: HTMLHeadingElement;
  readonly status: HTMLParagraphElement;
  readonly mapContainer: HTMLDivElement;
}

/**
 * Builds the page's static DOM skeleton once. The map is mounted into
 * `mapContainer` separately, in main.ts — this module never imports
 * maplibre-gl, so it stays testable in a WebGL-less environment
 * (happy-dom), the same separation A5 kept between draft.ts and
 * map-editor.ts.
 *
 * The heading/status text is the non-map textual fallback (A6 brief DoD:
 * "Keyboard operable with a non-map textual fallback") — it carries the
 * essential information (territory name, coverage status) independent of
 * whether the map ever renders, e.g. no WebGL on an old outdoor device.
 */
export function mountPage(root: HTMLElement): PageElements {
  const heading = document.createElement('h1');

  const status = document.createElement('p');
  status.className = 'status';

  const mapContainer = document.createElement('div');
  mapContainer.id = 'map';
  mapContainer.setAttribute('role', 'img');
  mapContainer.setAttribute('aria-label', 'Territory map');
  mapContainer.hidden = true;

  const attribution = document.createElement('p');
  attribution.className = 'attribution';
  attribution.textContent = '© OpenStreetMap contributors';

  root.replaceChildren(heading, status, mapContainer, attribution);
  return { heading, status, mapContainer };
}

export function renderStatus(elements: PageElements, state: ViewState): void {
  const described = describeState(state);
  elements.heading.textContent = described.heading;
  elements.status.textContent = described.body;
  elements.mapContainer.hidden = state.status !== 'ok';
}
