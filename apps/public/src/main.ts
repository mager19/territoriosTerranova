import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';

import { runApp } from './app.js';
import { selectBasemap } from './basemap.js';
import { MAPLIBRE_WORKER_URL } from './maplibre-worker.js';
import {
  BELLO_CENTER,
  BELLO_ZOOM,
  boundingBoxCenter,
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

// MapTiler Streets v2 when VITE_MAPTILER_KEY is set, otherwise the OSM
// raster fallback (docs/map-references.md "Basemap"). Only the style is
// fetched from MapTiler — no geocoding/search.
const basemap = selectBasemap(import.meta.env.VITE_MAPTILER_KEY);

void runApp(container, {
  locationHash: window.location.hash,
  basemap: basemap.kind,
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
    const { Map, Marker, setWorkerUrl } = await import('maplibre-gl');
    setWorkerUrl(MAPLIBRE_WORKER_URL); // see maplibre-worker.ts
    const map = new Map({
      container: elements.mapContainer,
      center: BELLO_CENTER,
      zoom: BELLO_ZOOM,
      attributionControl: false
    });
    // Style set right after construction (what the constructor's `style`
    // option does internally) so the MapTiler style can go through
    // transformStyle; 'load' still fires once for either basemap.
    if (basemap.kind === 'maptiler') {
      map.setStyle(basemap.style, { transformStyle: basemap.transformStyle });
    } else {
      map.setStyle(basemap.style);
    }
    map.on('load', () => {
      installTerritoryLayers(map);
      renderTerritory(map, result.view);
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
