import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';

import { runApp } from './app.js';
import { createOsmBasemap } from './basemap.js';
import { createTerritoryLabelElement, territoryLabelPoint, territoryStartPoint } from './layers.js';
import { MAPLIBRE_WORKER_URL } from './maplibre-worker.js';
import {
  BELLO_CENTER,
  BELLO_ZOOM,
  computeBoundingBox,
  directionsUrl,
  fitToBoundingBox,
  haversineMeters,
  installTerritoryLayers,
  renderTerritory
} from './map.js';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('root container #root not found');
}

// Always the OSM raster basemap: the MapTiler "Construcciones" basemap is an
// admin-only drafting aid, and this app never reads a MapTiler key
// (docs/map-references.md "Basemap"; guarded by basemap-policy.test.ts).
const basemap = createOsmBasemap();

void runApp(container, {
  locationPathname: window.location.pathname,
  locationHash: window.location.hash,
  basemap: basemap.kind,
  onTerritoryResolved: async (elements, result) => {
    const box = computeBoundingBox(result.view.boundary);
    // Inside the territory (its largest part, for a multi-part one) — never
    // a bounding-box center that could fall between parts.
    const territoryStart = territoryStartPoint(result.view.boundary);

    // Independent of the map/WebGL below — a plain link that works even
    // if MapLibre fails to load (old device, no WebGL): the field worker
    // can still get directions from their phone's own maps app.
    elements.directionsLink.href = directionsUrl(territoryStart);

    // maplibre-gl is loaded only once a territory actually resolves — the
    // unavailable/error/loading states never pull in the map bundle or
    // touch WebGL at all.
    const { Map, Marker, setWorkerUrl } = await import('maplibre-gl');
    setWorkerUrl(MAPLIBRE_WORKER_URL); // see maplibre-worker.ts
    const map = new Map({
      container: elements.mapContainer,
      center: BELLO_CENTER,
      zoom: BELLO_ZOOM,
      attributionControl: false
    });
    map.setStyle(basemap.style);
    map.on('load', () => {
      installTerritoryLayers(map);
      renderTerritory(map, result.view);
      new Marker({ element: createTerritoryLabelElement(result.view.territoryName), anchor: 'center' })
        .setLngLat(territoryLabelPoint(result.view.boundary))
        .addTo(map);
      fitToBoundingBox(map, box);
    });

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
          elements.locationStatus.textContent = 'No pudimos acceder a tu ubicación. Revisa los permisos de ubicación del navegador.';
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }
});
