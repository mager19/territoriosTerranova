import { describe, expect, it } from 'vitest';
import type { LineString, Point, Polygon } from '@territorios/geo';

import { mountPage, renderStatus } from './render.js';
import { UNAVAILABLE_MESSAGE } from './status.js';
import type { PublicTerritoryView } from './public-api.js';

const BOUNDARY: Polygon = {
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

describe('mountPage', () => {
  it('replaces prior container content instead of appending to it', () => {
    const root = document.createElement('div');
    root.appendChild(document.createElement('span'));

    mountPage(root);

    expect(root.querySelector('span')).toBeNull();
  });

  it('starts with the map hidden until a territory actually resolves', () => {
    const root = document.createElement('div');

    const { mapContainer } = mountPage(root);

    expect(mapContainer.hidden).toBe(true);
  });

  it('starts with the actions row (directions/locate) and location status hidden', () => {
    const root = document.createElement('div');

    const { actions, locationStatus } = mountPage(root);

    expect(actions.hidden).toBe(true);
    expect(locationStatus.hidden).toBe(true);
  });
});

const WEST_HALF: Polygon = {
  type: 'Polygon',
  coordinates: [[[-75.574, 6.357], [-75.573, 6.357], [-75.573, 6.359], [-75.574, 6.359], [-75.574, 6.357]]]
};
const ROUTE: LineString = { type: 'LineString', coordinates: [[-75.5738, 6.3575], [-75.5732, 6.3585]] };
const PAUSE: Point = { type: 'Point', coordinates: [-75.5735, 6.358] };

function baseView(overrides: Partial<PublicTerritoryView> = {}): PublicTerritoryView {
  return {
    territoryName: 'Navarra Norte',
    boundary: BOUNDARY,
    remainingArea: null,
    remainingAreaStatus: 'unknown',
    route: null,
    pausePoint: null,
    coveredArea: null,
    ...overrides
  };
}

function legendLabels(legend: HTMLUListElement): string[] {
  return Array.from(legend.querySelectorAll('li')).map((item) => item.textContent ?? '');
}

describe('renderStatus — legend', () => {
  it('lists every layer, in stacking order, when all of them are present', () => {
    const elements = mountPage(document.createElement('div'));

    renderStatus(elements, {
      status: 'ok',
      view: baseView({ coveredArea: WEST_HALF, remainingArea: WEST_HALF, remainingAreaStatus: 'recorded', route: ROUTE, pausePoint: PAUSE })
    });

    expect(elements.legend.hidden).toBe(false);
    expect(legendLabels(elements.legend)).toEqual(['Hecho', 'Pendiente', 'Recorrido', 'Aquí quedamos']);
  });

  it('lists only the layers present — no "Pendiente" once nothing is left', () => {
    const elements = mountPage(document.createElement('div'));

    renderStatus(elements, {
      status: 'ok',
      view: baseView({ coveredArea: BOUNDARY, remainingArea: { type: 'Polygon', coordinates: [] }, remainingAreaStatus: 'recorded' })
    });

    expect(legendLabels(elements.legend)).toEqual(['Hecho']);
  });

  it('hides the legend when the territory has no recorded layer at all', () => {
    const elements = mountPage(document.createElement('div'));

    renderStatus(elements, { status: 'ok', view: baseView() });

    expect(elements.legend.hidden).toBe(true);
    expect(elements.legend.children).toHaveLength(0);
  });

  it('clears and hides the legend for a non-ok state', () => {
    const elements = mountPage(document.createElement('div'));
    renderStatus(elements, { status: 'ok', view: baseView({ pausePoint: PAUSE }) });

    renderStatus(elements, { status: 'unavailable' });

    expect(elements.legend.hidden).toBe(true);
    expect(elements.legend.children).toHaveLength(0);
  });
});

describe('renderStatus', () => {
  it('shows the territory name and reveals the map on a resolved territory', () => {
    const root = document.createElement('div');
    const elements = mountPage(root);

    renderStatus(elements, {
      status: 'ok',
      view: { territoryName: 'Navarra Norte', boundary: BOUNDARY, remainingArea: null, remainingAreaStatus: 'unknown', route: null, pausePoint: null, coveredArea: null }
    });

    expect(elements.heading.textContent).toBe('Navarra Norte');
    expect(elements.mapContainer.hidden).toBe(false);
    expect(elements.actions.hidden).toBe(false);
  });

  it('shows the same neutral message and keeps the map hidden for an unavailable token', () => {
    const root = document.createElement('div');
    const elements = mountPage(root);

    renderStatus(elements, { status: 'unavailable' });

    expect(elements.status.textContent).toBe(UNAVAILABLE_MESSAGE);
    expect(elements.mapContainer.hidden).toBe(true);
  });

  it('never renders a field outside the four-key public contract, even if one is smuggled onto the view object', () => {
    const root = document.createElement('div');
    const elements = mountPage(root);

    // A defense-in-depth check: even if public-api.ts's allowlist parsing
    // were ever bypassed and an extra field reached this function, render.ts
    // itself must not read or display it — it only ever reads
    // territoryName/remainingAreaStatus off the view (status.ts), never
    // spreads the object into the DOM.
    const contaminatedView = {
      territoryName: 'Navarra Norte',
      boundary: BOUNDARY,
      remainingArea: null,
      remainingAreaStatus: 'unknown',
      assignedTo: 'SECRET-FIELD-WORKER-NAME'
    } as unknown as PublicTerritoryView;

    renderStatus(elements, { status: 'ok', view: contaminatedView });

    const rendered = root.textContent ?? '';
    expect(rendered).not.toContain('SECRET-FIELD-WORKER-NAME');
  });
});
