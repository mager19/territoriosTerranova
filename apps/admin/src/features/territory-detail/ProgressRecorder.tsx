import { useEffect, useRef, useState, type JSX } from 'react';
import { Map as MapLibreMap, type MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { ADMIN_BASEMAP, BasemapAttribution, applyBasemap } from '../territory-editor/basemap-ui.js';
import { ApiError, DEFAULT_ACTOR, describeApiError, recordProgress } from '../../api/client.js';
import {
  addVertex,
  closeDraft,
  coordinateToPointGeoJSON,
  createDraft,
  draftToLineStringGeoJSON,
  draftToPolygonGeoJSON,
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
  findEdgeIndexAtPoint,
  findVertexIndexAtPoint,
  fitToPolygon,
  installEditorLayers,
  renderDraft,
  renderPausePoint,
  renderSavedTerritory,
  screenPointToCoordinate
} from '../territory-editor/map-editor.js';
import type { Point, Polygon } from '@territorios/geo';

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
 * one, the admin draws the route with the established default admin actor.
 * Reuses TerritoryEditor's exact click-to-add-vertex draft
 * (draft.ts) and its rendering layer (map-editor.ts): a route is simply a
 * draft that never closes — draftToLineStringGeoJSON, not
 * draftToPolygonGeoJSON, converts it. Point editing (drag to move, click
 * an edge to add, double-click to remove) mirrors TerritoryEditor's own
 * "edit points" mode, with `findEdgeIndexAtPoint`'s `closed` argument set
 * to false — a route has no wraparound edge back to its start. The same map
 * places one optional pause Point; remaining area stays optional and unknown
 * unless a future explicit recorder adds it.
 */
export function ProgressRecorder({ territoryId, boundary, onRecorded }: ProgressRecorderProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [draft, setDraft] = useState<DraftState>(createDraft());
  const [pausePoint, setPausePoint] = useState<Point | null>(null);
  const [activeTool, setActiveTool] = useState<'route' | 'remaining' | 'pause' | null>(null);
  const [draftKind, setDraftKind] = useState<'route' | 'remaining' | null>(null);
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
      center: BELLO_CENTER,
      zoom: BELLO_ZOOM
    });
    applyBasemap(map, ADMIN_BASEMAP);
    map.on('load', () => {
      installEditorLayers(map);
      setMapReady(true);
    });
    mapRef.current = map;
  }, []);

  // Click-to-draw is explicitly tool-gated: one active tool places route
  // vertices, the other replaces the single pause marker. This prevents a
  // click intended for one geometry from mutating the other.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const handleClick = (event: MapMouseEvent) => {
      if (editingPoints || activeTool === null) return;
      const coordinate = screenPointToCoordinate(map, event.point);
      if (activeTool === 'route' || activeTool === 'remaining') {
        setDraft((current) => addVertex(current, coordinate));
      } else {
        setPausePoint(coordinateToPointGeoJSON(coordinate));
        setActiveTool(null);
      }
    };
    map.on('click', handleClick);
    return () => {
      map.off('click', handleClick);
    };
  }, [mapReady, editingPoints, activeTool]);

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
    renderPausePoint(map, pausePoint);
  }, [pausePoint, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    renderSavedTerritory(map, boundary);
    if (boundary) {
      fitToPolygon(map, boundary);
    }
  }, [boundary, mapReady]);

  const route = draftKind === 'route' ? draftToLineStringGeoJSON(draft) : null;
  const remainingArea = draftKind === 'remaining' && draft.isClosed ? draftToPolygonGeoJSON(draft) : null;
  const canSave = route !== null || remainingArea !== null || pausePoint !== null;

  async function handleSave(): Promise<void> {
    if (!route && !remainingArea && !pausePoint) return;
    setSaving(true);
    setError(null);
    try {
      await recordProgress(territoryId, {
        recordedBy: DEFAULT_ACTOR,
        note: note.trim() === '' ? undefined : note.trim(),
        ...(pausePoint === null ? {} : { pausePoint }),
        ...(route === null ? {} : { route }),
        ...(remainingArea === null ? {} : { remainingArea })
      });
      setDraft(resetDraft());
      setPausePoint(null);
      setEditingPoints(false);
      setActiveTool(null);
      setDraftKind(null);
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
      <h3 id="progress-recorder-heading">Registrar área pendiente o evidencia</h3>
      <p>El área pendiente es el registro principal. La ruta y el punto de pausa son evidencia opcional.</p>

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
      <BasemapAttribution kind={ADMIN_BASEMAP.kind} />

      <div role="toolbar" aria-label="Herramientas de progreso" className="map-toolbar">
        <button
          type="button"
          onClick={() => {
            setDraft(resetDraft());
            setDraftKind('remaining');
            setActiveTool('remaining');
            setEditingPoints(false);
          }}
          aria-pressed={activeTool === 'remaining'}
        >
          Dibujar área pendiente
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(resetDraft());
            setDraftKind('route');
            setActiveTool('route');
            setEditingPoints(false);
          }}
          aria-pressed={activeTool === 'route'}
        >
          Dibujar ruta
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft((current) => closeDraft(current));
            setActiveTool(null);
          }}
          disabled={draftKind !== 'remaining' || draft.vertices.length < 3 || draft.isClosed}
        >
          Cerrar área pendiente
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTool('pause');
            setEditingPoints(false);
          }}
          aria-pressed={activeTool === 'pause'}
        >
          Colocar pausa
        </button>
        <button type="button" onClick={() => setPausePoint(null)} disabled={pausePoint === null}>
          Quitar pausa
        </button>
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
            setDraftKind(null);
            setActiveTool(null);
          }}
          disabled={draft.vertices.length === 0}
        >
          Quitar dibujo
        </button>
        <button
          type="button"
          onClick={() => {
              setDraft(resetDraft());
              setDraftKind(null);
            setPausePoint(null);
            setEditingPoints(false);
            setActiveTool(null);
          }}
          disabled={draft.vertices.length === 0 && pausePoint === null}
        >
          Cancelar registro
        </button>
        <button
          type="button"
          onClick={() => {
            setEditingPoints((current) => !current);
            setActiveTool(null);
          }}
          disabled={draftKind !== 'route' || draft.vertices.length < ROUTE_MIN_VERTICES}
          aria-pressed={editingPoints}
        >
          Editar vértices
        </button>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleSave();
        }}
        style={{ marginTop: '0.75rem' }}
      >
        <div>
          <label htmlFor="progress-note">Nota (opcional)</label>
          <input id="progress-note" value={note} onChange={(event) => setNote(event.target.value)} />
        </div>

        <p role="status">
          {editingPoints
            ? 'Arrastrá un punto para moverlo, hacé clic en un borde para agregar uno, doble clic en un punto para borrarlo.'
              : activeTool === 'route'
                ? 'Hacé clic en el mapa para agregar puntos a la ruta.'
                : activeTool === 'remaining'
                  ? 'Hacé clic en el mapa para delimitar el área pendiente y después usá “Cerrar área pendiente”.'
                : activeTool === 'pause'
                ? 'Hacé clic en el mapa para colocar el punto de pausa.'
                : draft.vertices.length === 0 && pausePoint === null
                  ? 'Elegí “Dibujar ruta” o “Colocar pausa” para comenzar.'
                  : draft.vertices.length === 1
                    ? '1 punto ubicado — se necesitan al menos 2 para guardar una ruta.'
                    : remainingArea !== null
                      ? 'Área pendiente delimitada. Guardá para registrar esta cobertura.'
                      : `${draft.vertices.length} puntos de ruta${pausePoint === null ? '' : ' y un punto de pausa'} registrados. Editá vértices para ajustar la ruta, o guardá.`}
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
