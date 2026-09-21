import { useEffect, useRef, useState, type JSX } from 'react';
import { Map as MapLibreMap, type MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { ApiError, describeApiError, recordProgress } from '../../api/client.js';
import {
  addVertex,
  createDraft,
  draftToLineStringGeoJSON,
  insertVertex,
  moveVertex,
  removeVertexAt,
  resetDraft,
  undoVertex,
  type DraftState
} from '../territory-editor/draft.js';
import {
  BELLO_CENTER,
  BELLO_ZOOM,
  OSM_ATTRIBUTION,
  createBelloMapStyle,
  findEdgeIndexAtPoint,
  findVertexIndexAtPoint,
  fitToPolygon,
  installEditorLayers,
  renderDraft,
  renderSavedTerritory,
  screenPointToCoordinate
} from '../territory-editor/map-editor.js';
import type { Polygon } from '@territorios/geo';

export interface ProgressRecorderProps {
  readonly territoryId: number;
  readonly boundary: Polygon | null;
  readonly onRecorded: () => void;
}

/** A route only ever needs RFC 7946's own LineString minimum — never the 3-vertex polygon-ring minimum. */
const ROUTE_MIN_VERTICES = 2;

/**
 * Stands in for a real volunteer-facing recording tool, which doesn't
 * exist yet — "por ahora lo hace el admin" (2026-09-08): until there is
 * one, the admin draws the route themselves and records who actually
 * walked it. Reuses TerritoryEditor's exact click-to-add-vertex draft
 * (draft.ts) and its rendering layer (map-editor.ts): a route is simply a
 * draft that never closes — draftToLineStringGeoJSON, not
 * draftToPolygonGeoJSON, converts it. Point editing (drag to move, click
 * an edge to add, double-click to remove) mirrors TerritoryEditor's own
 * "edit points" mode, with `findEdgeIndexAtPoint`'s `closed` argument set
 * to false — a route has no wraparound edge back to its start. Only
 * records `route`; pause point and remaining-area geometry stay unbuilt
 * here on purpose, same "distinct, larger feature" scoping note
 * ProgressList already carries.
 */
export function ProgressRecorder({ territoryId, boundary, onRecorded }: ProgressRecorderProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [draft, setDraft] = useState<DraftState>(createDraft());
  const [recordedBy, setRecordedBy] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingPoints, setEditingPoints] = useState(false);
  const draggingIndexRef = useRef<number | null>(null);
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // Same StrictMode-double-mount guard as TerritoryEditor — see that
  // component's comment for the full explanation.
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

  // Click-to-extend: appends a point to the end of the route. Suppressed
  // in edit-points mode — the effect below owns every pointer interaction
  // there (drag/insert/remove), same split as TerritoryEditor.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const handleClick = (event: MapMouseEvent) => {
      if (editingPoints) return;
      const coordinate = screenPointToCoordinate(map, event.point);
      setDraft((current) => addVertex(current, coordinate));
    };
    map.on('click', handleClick);
    return () => {
      map.off('click', handleClick);
    };
  }, [mapReady, editingPoints]);

  // Point editing: drag to move, click an edge to insert, double-click a
  // point to remove. `closed: false` throughout — a route never wraps
  // back to its start. See TerritoryEditor's equivalent effect for the
  // full rationale of each piece; identical here except the open-path
  // distinction.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !editingPoints) return;

    map.doubleClickZoom.disable();

    const handleMouseDown = (event: MapMouseEvent) => {
      const index = findVertexIndexAtPoint(map, event.point);
      if (index === null) return;
      event.preventDefault();
      draggingIndexRef.current = index;
      map.dragPan.disable();
      map.getCanvas().style.cursor = 'grabbing';
    };

    const handleMouseMove = (event: MapMouseEvent) => {
      if (draggingIndexRef.current === null) {
        if (findVertexIndexAtPoint(map, event.point) !== null) {
          map.getCanvas().style.cursor = 'grab';
        } else if (findEdgeIndexAtPoint(map, draftRef.current.vertices, event.point, false) !== null) {
          map.getCanvas().style.cursor = 'copy';
        } else {
          map.getCanvas().style.cursor = '';
        }
        return;
      }
      const coordinate = screenPointToCoordinate(map, event.point);
      const index = draggingIndexRef.current;
      setDraft((current) => moveVertex(current, index, coordinate));
    };

    const endDrag = () => {
      if (draggingIndexRef.current === null) return;
      draggingIndexRef.current = null;
      map.dragPan.enable();
      map.getCanvas().style.cursor = '';
    };

    const handleClick = (event: MapMouseEvent) => {
      if (findVertexIndexAtPoint(map, event.point) !== null) return;
      setDraft((current) => {
        const edgeIndex = findEdgeIndexAtPoint(map, current.vertices, event.point, false);
        if (edgeIndex === null) return current;
        return insertVertex(current, edgeIndex, screenPointToCoordinate(map, event.point));
      });
    };

    const handleDblClick = (event: MapMouseEvent) => {
      const index = findVertexIndexAtPoint(map, event.point);
      if (index === null) return;
      event.preventDefault();
      setDraft((current) => removeVertexAt(current, index, ROUTE_MIN_VERTICES));
    };

    map.on('mousedown', handleMouseDown);
    map.on('mousemove', handleMouseMove);
    map.on('mouseup', endDrag);
    map.on('click', handleClick);
    map.on('dblclick', handleDblClick);
    window.addEventListener('mouseup', endDrag);

    return () => {
      map.doubleClickZoom.enable();
      map.off('mousedown', handleMouseDown);
      map.off('mousemove', handleMouseMove);
      map.off('mouseup', endDrag);
      map.off('click', handleClick);
      map.off('dblclick', handleDblClick);
      window.removeEventListener('mouseup', endDrag);
      endDrag();
    };
  }, [mapReady, editingPoints]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    renderDraft(map, draft);
  }, [draft, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    renderSavedTerritory(map, boundary);
    if (boundary) {
      fitToPolygon(map, boundary);
    }
  }, [boundary, mapReady]);

  const route = draftToLineStringGeoJSON(draft);
  const canSave = route !== null && recordedBy.trim() !== '';

  async function handleSave(): Promise<void> {
    if (!route) return;
    setSaving(true);
    setError(null);
    try {
      await recordProgress(territoryId, {
        recordedBy: recordedBy.trim(),
        note: note.trim() === '' ? undefined : note.trim(),
        route
      });
      setDraft(resetDraft());
      setEditingPoints(false);
      setNote('');
      onRecorded();
    } catch (caught) {
      setError(caught instanceof ApiError ? describeApiError(caught) : 'No se pudo registrar el progreso.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="progress-recorder-heading">
      <h3 id="progress-recorder-heading">Registrar progreso</h3>
      <p>Marcá el tramo recorrido en el mapa, un clic por punto.</p>

      <div
        ref={containerRef}
        role="img"
        aria-label={`Mapa para registrar una ruta de progreso. ${
          editingPoints
            ? 'Modo de edición de puntos: arrastrá un punto para moverlo, hacé clic en un borde para agregar uno, doble clic en un punto para borrarlo.'
            : draft.vertices.length > 0
              ? `${draft.vertices.length} punto(s) ubicado(s).`
              : 'Todavía no hay puntos ubicados.'
        }`}
        style={{ width: '100%', height: '280px', border: '1px solid var(--map-border, #ccc)' }}
      />
      <p className="map-attribution">{OSM_ATTRIBUTION}</p>

      <div role="group" aria-label="Controles de dibujo de ruta" style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        <button
          type="button"
          onClick={() => setDraft((current) => undoVertex(current))}
          disabled={draft.vertices.length === 0 || editingPoints}
        >
          Deshacer punto
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(resetDraft());
            setEditingPoints(false);
          }}
          disabled={draft.vertices.length === 0}
        >
          Borrar todo
        </button>
        {draft.vertices.length >= ROUTE_MIN_VERTICES && (
          <button type="button" onClick={() => setEditingPoints((current) => !current)} aria-pressed={editingPoints}>
            {editingPoints ? 'Dejar de editar puntos' : 'Editar puntos'}
          </button>
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleSave();
        }}
        style={{ marginTop: '0.75rem' }}
      >
        <div>
          <label htmlFor="progress-recorded-by">Registrado por (qué voluntario)</label>
          <input
            id="progress-recorded-by"
            value={recordedBy}
            onChange={(event) => setRecordedBy(event.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="progress-note">Nota (opcional)</label>
          <input id="progress-note" value={note} onChange={(event) => setNote(event.target.value)} />
        </div>

        <p role="status">
          {editingPoints
            ? 'Arrastrá un punto para moverlo, hacé clic en un borde para agregar uno, doble clic en un punto para borrarlo.'
            : draft.vertices.length === 0
              ? 'Hacé clic en el mapa para ubicar el primer punto.'
              : draft.vertices.length === 1
                ? '1 punto ubicado — se necesitan al menos 2 para guardar una ruta.'
                : `${draft.vertices.length} puntos ubicados. Editá puntos para ajustar uno, o guardá.`}
        </p>

        {error && (
          <p role="alert" className="editor-error">
            {error}
          </p>
        )}

        <button type="submit" disabled={!canSave || saving}>
          {saving ? 'Guardando…' : 'Guardar progreso'}
        </button>
      </form>
    </section>
  );
}
