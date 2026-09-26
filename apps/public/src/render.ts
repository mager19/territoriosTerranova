import {
  MAPTILER_COPYRIGHT_URL,
  MAPTILER_HOME_URL,
  MAPTILER_LOGO_URL,
  OSM_COPYRIGHT_URL,
  type BasemapKind
} from './basemap.js';
import { OSM_ATTRIBUTION } from './map.js';
import { describeState, type ViewState } from './status.js';

export interface PageElements {
  readonly heading: HTMLHeadingElement;
  readonly status: HTMLParagraphElement;
  /** Wraps directionsLink + locateButton — hidden/shown together with mapContainer, only meaningful once a territory resolves. */
  readonly actions: HTMLDivElement;
  /** Deep link to the phone's own maps app, pointed at the territory's starting point. href is set in main.ts once the boundary is known. */
  readonly directionsLink: HTMLAnchorElement;
  /** Requests browser geolocation and drops a marker — wired in main.ts (touches navigator.geolocation + the live map, so it stays out of this WebGL-less module). */
  readonly locateButton: HTMLButtonElement;
  /** Feedback for the locate button: searching / distance readout / permission-denied — separate from `status` so it never overwrites the territory's own coverage message. */
  readonly locationStatus: HTMLParagraphElement;
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
export function mountPage(root: HTMLElement, basemap: BasemapKind = 'osm'): PageElements {
  const heading = document.createElement('h1');

  const status = document.createElement('p');
  status.className = 'status';

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.hidden = true;

  const directionsLink = document.createElement('a');
  directionsLink.className = 'action-button';
  directionsLink.textContent = '🧭 Cómo llegar';
  directionsLink.target = '_blank';
  directionsLink.rel = 'noopener';

  const locateButton = document.createElement('button');
  locateButton.type = 'button';
  locateButton.className = 'action-button';
  locateButton.textContent = '📍 Mostrar mi ubicación';

  actions.append(directionsLink, locateButton);

  const locationStatus = document.createElement('p');
  locationStatus.className = 'location-status';
  locationStatus.hidden = true;

  const mapContainer = document.createElement('div');
  mapContainer.id = 'map';
  mapContainer.setAttribute('role', 'img');
  mapContainer.setAttribute('aria-label', 'Territory map');
  mapContainer.hidden = true;

  const attribution = createAttribution(basemap);

  root.replaceChildren(heading, status, actions, locationStatus, mapContainer, attribution);
  return { heading, status, actions, directionsLink, locateButton, locationStatus, mapContainer };
}

function externalLink(href: string, text: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = text;
  return link;
}

/**
 * The page's own attribution line (MapLibre's attribution control is
 * disabled in main.ts). OSM fallback: plain text, unchanged. MapTiler:
 * the free plan requires its logo plus "© MapTiler © OpenStreetMap
 * contributors", both linked to their copyright pages.
 */
function createAttribution(basemap: BasemapKind): HTMLParagraphElement {
  const attribution = document.createElement('p');
  attribution.className = 'attribution';
  if (basemap === 'osm') {
    attribution.textContent = OSM_ATTRIBUTION;
    return attribution;
  }

  const logoLink = externalLink(MAPTILER_HOME_URL, '');
  logoLink.className = 'maptiler-logo';
  const logo = document.createElement('img');
  logo.src = MAPTILER_LOGO_URL;
  logo.alt = 'MapTiler logo';
  logo.height = 18;
  logoLink.append(logo);

  attribution.append(
    logoLink,
    externalLink(MAPTILER_COPYRIGHT_URL, '© MapTiler'),
    ' ',
    externalLink(OSM_COPYRIGHT_URL, '© OpenStreetMap contributors')
  );
  return attribution;
}

export function renderStatus(elements: PageElements, state: ViewState): void {
  const described = describeState(state);
  elements.heading.textContent = described.heading;
  elements.status.textContent = described.body;
  elements.actions.hidden = state.status !== 'ok';
  elements.mapContainer.hidden = state.status !== 'ok';
}
