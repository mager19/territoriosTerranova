import { describe, expect, it } from 'vitest';
import type { Polygon } from '@territorios/geo';

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

describe('renderStatus', () => {
  it('shows the territory name and reveals the map on a resolved territory', () => {
    const root = document.createElement('div');
    const elements = mountPage(root);

    renderStatus(elements, {
      status: 'ok',
      view: { territoryName: 'Navarra Norte', boundary: BOUNDARY, remainingArea: null, remainingAreaStatus: 'unknown', route: null }
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
