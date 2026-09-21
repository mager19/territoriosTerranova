import { useEffect, useRef, useState, type JSX } from 'react';
import { Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { ApiError, describeApiError, getTerritory, type TerritoryWithRevisions } from '../../api/client.js';
import {
  BELLO_CENTER,
  BELLO_ZOOM,
  OSM_ATTRIBUTION,
  createBelloMapStyle,
  fitToPolygon,
  installEditorLayers,
  renderSavedTerritory
} from '../territory-editor/map-editor.js';

export interface TerritoryPreviewProps {
  readonly territoryId: number | null;
  readonly onClose: () => void;
}

/**
 * A small map preview so clicking a row in the overview table shows WHICH
 * block a territory actually is, without leaving the table's filters, month
 * and sort behind (that state lives in TerritoryOverview and never resets
 * from a selection here).
 *
 * Deliberately display-only: it draws the current revision's boundary and
 * nothing else — no drawing, no editing, no draft/reference-barrio layers.
 * Kept out of TerritoryOverview.tsx (already carrying fetch, filters, sort
 * and empty states) and reuses TerritoryEditor's map glue rather than
 * duplicating it.
 */
export function TerritoryPreview({ territoryId, onClose }: TerritoryPreviewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [territory, setTerritory] = useState<TerritoryWithRevisions | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = territoryId !== null;

  // Map lifecycle: created once and reused across every selection, never
  // torn down and recreated per click. Same StrictMode-double-mount guard as
  // TerritoryEditor (see that component's initializedRef comment for the
  // full explanation) — MapLibre does not tolerate being created and torn
  // down twice on the same container.
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current || !containerRef.current) return;
    initializedRef.current = true;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: createBelloMapStyle(),
      center: BELLO_CENTER,
      zoom: BELLO_ZOOM
    });
    map.on('load', () => {
      installEditorLayers(map);
      setMapReady(true);
    });
    mapRef.current = map;
  }, []);

  // Fetch the selected territory whenever the id changes to a non-null
  // value; clears back to nothing selected when it becomes null again.
  useEffect(() => {
    if (territoryId === null) {
      setTerritory(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTerritory(null);
    getTerritory(territoryId)
      .then((result) => {
        if (!cancelled) setTerritory(result);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof ApiError ? describeApiError(caught) : 'No se pudo cargar el territorio.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [territoryId]);

  // This codebase's "current geometry" rule everywhere else: the last
  // revision, never the first or an assumed one. Absent revisions is a
  // should-not-happen case the type still permits — null here, handled
  // below with a message rather than a silently blank map.
  const currentGeometry = territory?.revisions.at(-1)?.geometry ?? null;
  const hasNoRevisions = territory !== null && territory.revisions.length === 0;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    renderSavedTerritory(map, currentGeometry);
    if (currentGeometry) {
      fitToPolygon(map, currentGeometry);
    }
  }, [currentGeometry, mapReady]);

  // A hidden panel's container has zero size, so the map draws wrong when
  // revealed — resize once the container has real dimensions again.
  useEffect(() => {
    if (!visible) return;
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.resize();
  }, [visible, mapReady]);

  return (
    <section aria-labelledby="territory-preview-heading" hidden={!visible}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.75rem' }}>
        <h3 id="territory-preview-heading">
          {territory ? `${territory.number ?? '—'} · ${territory.name}` : 'Vista previa del territorio'}
        </h3>
        <button type="button" onClick={onClose}>
          Cerrar
        </button>
      </div>

      {loading && <p role="status">Cargando territorio…</p>}
      {error && (
        <p role="alert" className="editor-error">
          {error}
        </p>
      )}
      {!loading && !error && hasNoRevisions && (
        <p role="status">Este territorio todavía no tiene un contorno guardado.</p>
      )}

      <div
        ref={containerRef}
        role="img"
        aria-label="Mapa de vista previa del territorio seleccionado."
        className="territory-preview-map"
      />
      <p className="map-attribution">{OSM_ATTRIBUTION}</p>
    </section>
  );
}
