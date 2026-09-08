import 'maplibre-gl/dist/maplibre-gl.css';

import { runApp } from './app.js';
import {
  BELLO_CENTER,
  BELLO_ZOOM,
  computeBoundingBox,
  createBelloMapStyle,
  fitToBoundingBox,
  installTerritoryLayers,
  renderTerritory
} from './map.js';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('root container #root not found');
}

void runApp(container, {
  locationHash: window.location.hash,
  onTerritoryResolved: async (elements, result) => {
    // maplibre-gl is loaded only once a territory actually resolves — the
    // unavailable/error/loading states never pull in the map bundle or
    // touch WebGL at all.
    const { Map } = await import('maplibre-gl');
    const map = new Map({
      container: elements.mapContainer,
      style: createBelloMapStyle(),
      center: BELLO_CENTER,
      zoom: BELLO_ZOOM,
      attributionControl: false
    });
    map.on('load', () => {
      installTerritoryLayers(map);
      renderTerritory(map, result.view.boundary, result.view.remainingArea);
      fitToBoundingBox(map, computeBoundingBox(result.view.boundary));
    });
  }
});
