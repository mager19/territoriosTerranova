import { legendItems } from './layers.js';
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
  /** Map key listing ONLY the layers the resolved territory actually draws; hidden otherwise. */
  readonly legend: HTMLUListElement;
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
  mapContainer.setAttribute('aria-label', 'Mapa del territorio');
  mapContainer.hidden = true;

  const legend = document.createElement('ul');
  legend.className = 'legend';
  legend.setAttribute('aria-label', 'Leyenda del mapa');
  legend.hidden = true;

  const attribution = document.createElement('p');
  attribution.className = 'attribution';
  attribution.textContent = '© OpenStreetMap contributors';

  root.replaceChildren(heading, status, actions, locationStatus, mapContainer, legend, attribution);
  return { heading, status, actions, directionsLink, locateButton, locationStatus, mapContainer, legend };
}

export function renderStatus(elements: PageElements, state: ViewState): void {
  const described = describeState(state);
  elements.heading.textContent = described.heading;
  elements.status.textContent = described.body;
  elements.actions.hidden = state.status !== 'ok';
  elements.mapContainer.hidden = state.status !== 'ok';
  renderLegend(elements.legend, state);
}

function renderLegend(legend: HTMLUListElement, state: ViewState): void {
  const items = state.status === 'ok' ? legendItems(state.view) : [];
  legend.replaceChildren(
    ...items.map((item) => {
      const entry = document.createElement('li');
      entry.className = `legend-item legend-${item.shape}`;
      entry.dataset.layer = item.key;

      const swatch = document.createElement('span');
      swatch.className = 'legend-swatch';
      swatch.style.background = item.color;
      swatch.setAttribute('aria-hidden', 'true');

      const label = document.createElement('span');
      label.textContent = item.label;

      entry.append(swatch, label);
      return entry;
    })
  );
  legend.hidden = items.length === 0;
}
