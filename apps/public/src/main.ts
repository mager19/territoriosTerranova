import 'maplibre-gl/dist/maplibre-gl.css';

import { runApp } from './app.js';
import {
  BELLO_CENTER,
  BELLO_ZOOM,
  boundingBoxCenter,
  computeBoundingBox,
  createBelloMapStyle,
  directionsUrl,
  fitToBoundingBox,
  haversineMeters,
  installTerritoryLayers,
  renderTerritory
} from './map.js';
import { createPausePointMarkerElement } from './layers.js';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('root container #root not found');
}

void runApp(container, {
  locationHash: window.location.hash,
  onTerritoryResolved: async (elements, result) => {
    const box = computeBoundingBox(result.view.boundary);
    const territoryStart = boundingBoxCenter(box);

    // Independent of the map/WebGL below — a plain link that works even
    // if MapLibre fails to load (old device, no WebGL): the field worker
    // can still get directions from their phone's own maps app.
    elements.directionsLink.href = directionsUrl(territoryStart);

    // maplibre-gl is loaded only once a territory actually resolves — the
    // unavailable/error/loading states never pull in the map bundle or
    // touch WebGL at all.
    const { Map, Marker } = await import('maplibre-gl');
    const map = new Map({
      container: elements.mapContainer,
      style: createBelloMapStyle(),
      center: BELLO_CENTER,
      zoom: BELLO_ZOOM,
      attributionControl: false
    });
    map.on('load', () => {
      installTerritoryLayers(map);
      renderTerritory(map, result.view);
      fitToBoundingBox(map, box);
    });

    // Where the work stopped (2026-09-26 product decision): a labeled DOM
    // marker anchored at its dot, so the "Aquí quedamos" text always shows.
    const pausePoint = result.view.pausePoint;
    if (pausePoint !== null) {
      const [lon, lat] = pausePoint.coordinates;
      new Marker({ element: createPausePointMarkerElement(), anchor: 'left', offset: [-8, 0] })
        .setLngLat([lon, lat])
        .addTo(map);
    }

    // Geolocation needs an explicit tap, not an automatic prompt on load —
    // a permission dialog firing before the field worker has even read the
    // page is confusing, and there is no fallback UI for "unsupported"
    // beyond simply not showing the button.
    if (!('geolocation' in navigator)) {
      elements.locateButton.hidden = true;
      return;
    }

    let userMarker: InstanceType<typeof Marker> | null = null;

    elements.locateButton.addEventListener('click', () => {
      elements.locationStatus.hidden = false;
      elements.locationStatus.textContent = 'Buscando tu ubicación…';

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const here = { lat: position.coords.latitude, lon: position.coords.longitude };

          if (userMarker) {
            userMarker.setLngLat([here.lon, here.lat]);
          } else {
            userMarker = new Marker({ color: '#2b6fd1' }).setLngLat([here.lon, here.lat]).addTo(map);
          }

          const distanceMeters = Math.round(haversineMeters(here, territoryStart));
          elements.locationStatus.textContent = `Estás a unos ${distanceMeters} m del punto de partida del territorio.`;

          map.fitBounds(
            [
              [Math.min(box.west, here.lon), Math.min(box.south, here.lat)],
              [Math.max(box.east, here.lon), Math.max(box.north, here.lat)]
            ],
            { padding: 48, maxZoom: 18 }
          );
        },
        () => {
          elements.locationStatus.textContent = 'No pudimos acceder a tu ubicación. Revisá los permisos de ubicación del navegador.';
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }
});
