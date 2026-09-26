import { useEffect, useRef, useState, type JSX } from 'react';
import { Map as MapLibreMap, type MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { ApiError, DEFAULT_ACTOR, describeApiError, recordProgress, type CoverageBaseline } from '../../api/client.js';
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
  OSM_ATTRIBUTION,
  createBelloMapStyle,
  findEdgeIndexAtPoint,
  findVertexIndexAtPoint,
  fitToPolygon,
  installEditorLayers,
  installSessionLayers,
  renderDraft,
  renderPausePoint,
  renderRemainingArea,
  renderSavedTerritory,
  renderSecondaryDraft,
  renderSessions,
  screenPointToCoordinate
} from '../territory-editor/map-editor.js';
import { buildSessionRequest, sessionFeatureCollection, type CoverageSession } from './sessions.js';
import type { MultiPolygon, Point, Polygon } from '@territorios/geo';

export interface ProgressRecorderProps {
  readonly territoryId: number;
  readonly boundary: Polygon | null;
  /** Latest remaining area of the current cycle (empty polygon = nothing left, null = unknown). */
  readonly remainingArea?: Polygon | MultiPolygon | null;
  /** Earlier sessions of the current cycle, drawn in their own colors. */
  readonly sessions?: readonly CoverageSession[];
  readonly highlightedSessionId?: number | null;
  readonly onRecorded: () => void;
}

type DraftKind = 'covered' | 'route';
type Tool = DraftKind | 'pause';

/** A route only ever needs RFC 7946's own LineString minimum — never the 3-vertex polygon-ring minimum. */
const ROUTE_MIN_VERTICES = 2;
const COVERED_MIN_VERTICES = 3;

/** Progress-specific wording where the shared error text would mislead (it speaks of Bello's boundary). */
const RECORDER_ERRORS_ES: Record<string, string> = {
  out_of_bounds: 'Lo dibujado queda fuera del territorio. Ajustá los vértices para que queden dentro del borde.'
};

/**
 * "Draw what we covered today" (2026-09-26 product decision). Each session
 * the administrator draws, vertex by vertex, the area covered in that
 * session — it may end mid-block — and the server subtracts it from the
 * cycle's remaining area. The covered area is required; the pause point
 * ("where we stopped") and the route are optional evidence on the same map.
 *
 * The covered area and the route are two independent drafts (draft.ts, the
 * same click-to-add model TerritoryEditor uses). Only one is "focused" at a
 * time: it is rendered in the editable draft layer, receives clicks, and is
 * the one "Editar vértices" (drag to move, click an edge to insert,
 * double-click to remove — TerritoryEditor's own gestures) operates on; the
 * other is shown read-only, so a click never mutates the wrong geometry.
 *
 * Baseline: when the cycle has no remaining area yet, the server answers
 * `baseline_required`. That turns into an in-page confirmation (never a
 * browser dialog); only an explicit "yes" resends the session with
 * `baseline: 'whole_territory'`.
 */
export function ProgressRecorder({
  territoryId,
  boundary,
  remainingArea = null,
  sessions = [],
  highlightedSessionId = null,
  onRecorded
}: ProgressRecorderProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [covered, setCovered] = useState<DraftState>(createDraft());
  const [route, setRoute] = useState<DraftState>(createDraft());
  const [pausePoint, setPausePoint] = useState<Point | null>(null);
  const [activeTool, setActiveTool] = useState<Tool | null>(null);
  const [editing, setEditing] = useState<DraftKind | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [baselinePrompt, setBaselinePrompt] = useState(false);
  const draggingIndexRef = useRef<number | null>(null);

  // The draft that clicks and vertex edits apply to.
  const focused: DraftKind = editing ?? (activeTool === 'route' ? 'route' : 'covered');
  const focusedDraft = focused === 'route' ? route : covered;
  const setFocusedDraft = focused === 'route' ? setRoute : setCovered;
  const focusedDraftRef = useRef(focusedDraft);
  useEffect(() => {
    focusedDraftRef.current = focusedDraft;
  }, [focusedDraft]);

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
      installSessionLayers(map);
      setMapReady(true);
    });
    mapRef.current = map;
  }, []);

  // Click-to-draw is explicitly tool-gated: the covered-area and route tools
  // add vertices to their own draft, the pause tool replaces the single
  // pause marker. Clicking a closed covered area is ignored rather than
  // silently starting a new one (draft.ts's addVertex would do that).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const handleClick = (event: MapMouseEvent) => {
      if (editing !== null || activeTool === null) return;
      const coordinate = screenPointToCoordinate(map, event.point);
      if (activeTool === 'covered') {
        setCovered((current) => (current.isClosed ? current : addVertex(current, coordinate)));
      } else if (activeTool === 'route') {
        setRoute((current) => addVertex(current, coordinate));
      } else {
        setPausePoint(coordinateToPointGeoJSON(coordinate));
        setActiveTool(null);
      }
    };
    map.on('click', handleClick);
    return () => {
      map.off('click', handleClick);
    };
  }, [mapReady, editing, activeTool]);

  // Vertex editing of the focused draft: drag to move, click an edge to
  // insert, double-click a vertex to remove. The covered area is a closed
  // ring (wraparound edge, >= 3 vertices); the route is an open path.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || editing === null) return;
    const closed = editing === 'covered';
    const minVertices = closed ? COVERED_MIN_VERTICES : ROUTE_MIN_VERTICES;
    const setDraft = editing === 'covered' ? setCovered : setRoute;

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
        } else if (findEdgeIndexAtPoint(map, focusedDraftRef.current.vertices, event.point, closed) !== null) {
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
        const edgeIndex = findEdgeIndexAtPoint(map, current.vertices, event.point, closed);
        if (edgeIndex === null) return current;
        return insertVertex(current, edgeIndex, screenPointToCoordinate(map, event.point));
      });
    };

    const handleDblClick = (event: MapMouseEvent) => {
      const index = findVertexIndexAtPoint(map, event.point);
      if (index === null) return;
      event.preventDefault();
      setDraft((current) => removeVertexAt(current, index, minVertices));
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
  }, [mapReady, editing]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    renderDraft(map, focusedDraft);
    const other = focused === 'route' ? draftToPolygonGeoJSON(covered) : draftToLineStringGeoJSON(route);
    renderSecondaryDraft(map, other);
  }, [focused, focusedDraft, covered, route, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    renderPausePoint(map, pausePoint);
  }, [pausePoint, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    renderRemainingArea(map, remainingArea);
  }, [remainingArea, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    renderSessions(map, sessionFeatureCollection(sessions, highlightedSessionId));
  }, [sessions, highlightedSessionId, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    renderSavedTerritory(map, boundary);
    if (boundary) {
      fitToPolygon(map, boundary);
    }
  }, [boundary, mapReady]);

  const coveredReady = draftToPolygonGeoJSON(covered) !== null;
  const hasAnything = covered.vertices.length > 0 || route.vertices.length > 0 || pausePoint !== null;

  function resetSession(): void {
    setCovered(resetDraft());
    setRoute(resetDraft());
    setPausePoint(null);
    setEditing(null);
    setActiveTool(null);
    setBaselinePrompt(false);
  }

  async function save(baseline?: CoverageBaseline): Promise<void> {
    const request = buildSessionRequest({ recordedBy: DEFAULT_ACTOR, covered, route, pausePoint, note, baseline });
    if (request === null) return;
    setSaving(true);
    setError(null);
    try {
      await recordProgress(territoryId, request);
      resetSession();
      setNote('');
      onRecorded();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'baseline_required') {
        setBaselinePrompt(true);
      } else if (caught instanceof ApiError) {
        setBaselinePrompt(false);
        setError(RECORDER_ERRORS_ES[caught.code] ?? describeApiError(caught));
      } else {
        setError('No se pudo registrar la sesión.');
      }
    } finally {
      setSaving(false);
    }
  }

  function startTool(tool: Tool): void {
    setEditing(null);
    setActiveTool(tool);
  }

  function statusText(): string {
    if (editing !== null) {
      return 'Arrastrá un punto para moverlo, hacé clic en un borde para agregar uno, doble clic en un punto para borrarlo.';
    }
    if (activeTool === 'covered') {
      return covered.isClosed
        ? 'Área cubierta cerrada. Editá sus vértices, agregá ruta o pausa, o guardá la sesión.'
        : 'Hacé clic en el mapa para marcar el borde de lo que cubrieron hoy y después usá “Cerrar área cubierta”.';
    }
    if (activeTool === 'route') return 'Hacé clic en el mapa para agregar puntos a la ruta.';
    if (activeTool === 'pause') return 'Hacé clic en el mapa para marcar dónde se detuvieron.';
    if (!hasAnything) return 'Elegí “Dibujar área cubierta” para comenzar la sesión.';
    if (!coveredReady) return 'Falta cerrar el área cubierta: es obligatoria para guardar la sesión.';
    return 'Sesión lista para guardar.';
  }

  return (
    <section aria-labelledby="progress-recorder-heading">
      <h3 id="progress-recorder-heading">Registrar sesión</h3>
      <p>
        Dibujá el área que cubrieron en esta sesión (puede terminar a mitad de cuadra). El área pendiente se calcula sola.
        El punto de pausa y la ruta son opcionales.
      </p>

      <div
        ref={containerRef}
        className="session-map"
        role="img"
        aria-label={`Mapa de la sesión: territorio, área pendiente y sesiones anteriores. ${
          covered.vertices.length > 0
            ? `Área cubierta: ${covered.vertices.length} punto(s)${covered.isClosed ? ', cerrada' : ''}.`
            : 'Todavía no hay área cubierta dibujada.'
        }${route.vertices.length > 0 ? ` Ruta: ${route.vertices.length} punto(s).` : ''}`}
      />
      <p className="map-attribution">{OSM_ATTRIBUTION}</p>

      <div role="toolbar" aria-label="Herramientas de la sesión" className="map-toolbar">
        <button
          type="button"
          className="primary"
          onClick={() => {
            if (covered.isClosed) setCovered(resetDraft());
            startTool('covered');
          }}
          aria-pressed={activeTool === 'covered' && editing === null}
        >
          {covered.isClosed ? 'Redibujar área cubierta' : 'Dibujar área cubierta'}
        </button>
        <button
          type="button"
          onClick={() => {
            setCovered((current) => closeDraft(current));
            setActiveTool(null);
          }}
          disabled={covered.vertices.length < COVERED_MIN_VERTICES || covered.isClosed}
        >
          Cerrar área cubierta
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing((current) => (current === 'covered' ? null : 'covered'));
            setActiveTool(null);
          }}
          disabled={covered.vertices.length < COVERED_MIN_VERTICES}
          aria-pressed={editing === 'covered'}
        >
          {editing === 'covered' ? 'Terminar edición del área' : 'Editar vértices del área'}
        </button>
        <button type="button" onClick={() => startTool('route')} aria-pressed={activeTool === 'route' && editing === null}>
          Dibujar ruta
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing((current) => (current === 'route' ? null : 'route'));
            setActiveTool(null);
          }}
          disabled={route.vertices.length < ROUTE_MIN_VERTICES}
          aria-pressed={editing === 'route'}
        >
          {editing === 'route' ? 'Terminar edición de la ruta' : 'Editar vértices de la ruta'}
        </button>
        <button type="button" onClick={() => startTool('pause')} aria-pressed={activeTool === 'pause'}>
          Colocar pausa
        </button>
        <button type="button" onClick={() => setPausePoint(null)} disabled={pausePoint === null}>
          Quitar pausa
        </button>
        <button
          type="button"
          onClick={() => setFocusedDraft((current) => undoVertex(current))}
          disabled={focusedDraft.vertices.length === 0 || focusedDraft.isClosed || editing !== null}
        >
          Deshacer punto
        </button>
        <button
          type="button"
          onClick={() => {
            setRoute(resetDraft());
            if (focused === 'route') setEditing(null);
          }}
          disabled={route.vertices.length === 0}
        >
          Quitar ruta
        </button>
        <button type="button" onClick={resetSession} disabled={!hasAnything}>
          Cancelar sesión
        </button>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        style={{ marginTop: '0.75rem' }}
      >
        <div>
          <label htmlFor="progress-note">Nota (opcional)</label>
          <input id="progress-note" value={note} onChange={(event) => setNote(event.target.value)} />
        </div>

        <p role="status">{statusText()}</p>

        {baselinePrompt && (
          <div role="alertdialog" aria-labelledby="baseline-prompt-heading" className="baseline-prompt">
            <p id="baseline-prompt-heading">
              <strong>Este ciclo todavía no tiene un área pendiente registrada.</strong>
            </p>
            <p>
              Para calcular el avance hay que confirmar desde dónde parte: ¿esta es la primera sesión del ciclo y
              empieza desde todo el territorio?
            </p>
            <div className="baseline-prompt-actions">
              <button type="button" className="primary" disabled={saving} onClick={() => void save('whole_territory')}>
                Sí, partir de todo el territorio
              </button>
              <button type="button" disabled={saving} onClick={() => setBaselinePrompt(false)}>
                No, cancelar
              </button>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="editor-error">
            {error}
          </p>
        )}

        <button type="submit" disabled={!coveredReady || saving || baselinePrompt}>
          {saving ? 'Guardando…' : 'Guardar sesión'}
        </button>
      </form>
    </section>
  );
}
