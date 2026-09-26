// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { Map as MapLibreMap } from 'maplibre-gl';

import { selectBasemap } from './basemap.js';
import { BasemapAttribution, applyBasemap, createMapTilerLogoControl } from './basemap-ui.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function renderAttribution(kind: 'osm' | 'maptiler'): HTMLElement {
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(<BasemapAttribution kind={kind} />));
  return container;
}

function fakeMap() {
  const setStyle = vi.fn();
  const addControl = vi.fn();
  return { map: { setStyle, addControl } as unknown as MapLibreMap, setStyle, addControl };
}

describe('BasemapAttribution', () => {
  it('keeps the plain OSM attribution for the fallback basemap', () => {
    const container = renderAttribution('osm');

    expect(container.textContent).toBe('© OpenStreetMap contributors');
    expect(container.querySelector('a')).toBeNull();
  });

  it('credits MapTiler and OSM with links to both copyright pages', () => {
    const container = renderAttribution('maptiler');

    expect(container.textContent).toBe('© MapTiler © OpenStreetMap contributors');
    const links = Array.from(container.querySelectorAll('a')).map((a) => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([
      ['© MapTiler', 'https://www.maptiler.com/copyright/'],
      ['© OpenStreetMap contributors', 'https://www.openstreetmap.org/copyright']
    ]);
  });
});

describe('createMapTilerLogoControl', () => {
  it('renders the official MapTiler logo linking to maptiler.com', () => {
    const control = createMapTilerLogoControl();

    const element = control.onAdd({} as MapLibreMap);

    const link = element.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://www.maptiler.com');
    expect(link?.getAttribute('rel')).toBe('noopener');
    expect(link?.querySelector('img')?.getAttribute('src')).toBe('https://api.maptiler.com/resources/logo.svg');
  });
});

describe('applyBasemap', () => {
  it('sets the OSM style as-is and adds no MapTiler logo for the fallback', () => {
    const basemap = selectBasemap(undefined);
    const { map, setStyle, addControl } = fakeMap();

    applyBasemap(map, basemap);

    expect(setStyle).toHaveBeenCalledWith(basemap.style);
    expect(addControl).not.toHaveBeenCalled();
  });

  it('loads the MapTiler style through transformStyle and adds the logo control', () => {
    const basemap = selectBasemap('k');
    if (basemap.kind !== 'maptiler') throw new Error('expected maptiler');
    const { map, setStyle, addControl } = fakeMap();

    applyBasemap(map, basemap);

    expect(setStyle).toHaveBeenCalledWith(basemap.style, { transformStyle: basemap.transformStyle });
    expect(addControl).toHaveBeenCalledWith(expect.objectContaining({ onAdd: expect.any(Function) }), 'bottom-left');
  });
});
