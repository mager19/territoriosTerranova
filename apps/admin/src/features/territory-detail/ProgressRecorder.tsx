import { useEffect, useRef, useState, type JSX } from 'react';
import { Map as MapLibreMap, type MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { ApiError, DEFAULT_ACTOR, describeApiError, recordProgress, type CoverageBaseline } from '../../api/client.js';
import {
  addVertex,
  closeDraft,
  createDraft,
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
  renderRemainingArea,
  renderSavedTerritory,
  renderSessions,
  screenPointToCoordinate
} from '../territory-editor/map-editor.js';
import { buildSessionRequest, sessionFeatureCollection, type CoverageSession } from './sessions.js';
import type { MultiPolygon, Polygon } from '@territorios/geo';

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

const COVERED_MIN_VERTICES = 3;

const NOTE_HELP_ID = 'progress-note-help';

/** Progress-specific wording where the shared error text would mislead (it speaks of Bello's boundary). */
const RECORDER_ERRORS_ES: Record<string, string> = {
  out_of_bounds: 'Lo dibujado queda fuera del territorio. Ajusta los puntos para que queden dentro del borde.'
};

/**
 * "Draw what we covered today" (2026-09-26 product decision). Each session
 * the administrator draws, vertex by vertex, the area covered in that
 * session — it may end mid-block — and the server subtracts it from the
 * cycle's remaining area. The covered area is the only geometry; an
 * optional note tells the next group where to resume and is PUBLIC through
 * the share link (2026-10-03 product decision — the field's help text warns
 * against writing personal data). The pause point and the route were
 * removed from this recorder on 2026-10-03; the API still accepts them.
 *
 * Drawing is active as soon as the recorder mounts: every map click adds a
 * vertex to the covered-area draft (draft.ts, the same click-to-add model
 * TerritoryEditor uses) until it is closed. Once closed, clicks are ignored
 * unless "Ajustar puntos" is on — TerritoryEditor's own gestures: drag to
 * move, click an edge to insert, double-click to remove.
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
  const [adjusting, setAdjusting] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [baselinePrompt, setBaselinePrompt] = useState(false);
  const draggingIndexRef = useRef<number | null>(null);
  const coveredRef = useRef(covered);
  useEffect(() => {
    coveredRef.current = covered;
  }, [covered]);

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

  // Drawing mode: active while the area is open. Clicking a closed area is
  // ignored rather than silently starting a new one (draft.ts's addVertex
  // would do that) — "Borrar y volver a dibujar" is the explicit way back.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || adjusting) return;
    const handleClick = (event: MapMouseEvent) => {
      const coordinate = screenPointToCoordinate(map, event.point);
      setCovered((current) => (current.isClosed ? current : addVertex(current, coordinate)));
    };
    map.on('click', handleClick);
    return () => {
      map.off('click', handleClick);
    };
  }, [mapReady, adjusting]);

  // "Ajustar puntos": drag a vertex to move it, click an edge to insert
  // one, double-click a vertex to remove it (never below a 3-vertex ring).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !adjusting) return;

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
        } else if (findEdgeIndexAtPoint(map, coveredRef.current.vertices, event.point, true) !== null) {
          map.getCanvas().style.cursor = 'copy';
        } else {
          map.getCanvas().style.cursor = '';
        }
        return;
      }
      const coordinate = screenPointToCoordinate(map, event.point);
      const index = draggingIndexRef.current;
      setCovered((current) => moveVertex(current, index, coordinate));
    };

    const endDrag = () => {
      if (draggingIndexRef.current === null) return;
      draggingIndexRef.current = null;
      map.dragPan.enable();
      map.getCanvas().style.cursor = '';
    };

    const handleClick = (event: MapMouseEvent) => {
      if (findVertexIndexAtPoint(map, event.point) !== null) return;
      setCovered((current) => {
        const edgeIndex = findEdgeIndexAtPoint(map, current.vertices, event.point, true);
        if (edgeIndex === null) return current;
        return insertVertex(current, edgeIndex, screenPointToCoordinate(map, event.point));
      });
    };

    const handleDblClick = (event: MapMouseEvent) => {
      const index = findVertexIndexAtPoint(map, event.point);
      if (index === null) return;
      event.preventDefault();
      setCovered((current) => removeVertexAt(current, index, COVERED_MIN_VERTICES));
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
  }, [mapReady, adjusting]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    renderDraft(map, covered);
  }, [covered, mapReady]);

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

  const vertexCount = covered.vertices.length;
  const coveredReady = draftToPolygonGeoJSON(covered) !== null;
  const hasAnything = vertexCount > 0 || note.trim() !== '';

  function redraw(): void {
    setCovered(resetDraft());
    setAdjusting(false);
  }

  function cancel(): void {
    redraw();
    setNote('');
    setBaselinePrompt(false);
    setError(null);
  }

  async function save(baseline?: CoverageBaseline): Promise<void> {
    const request = buildSessionRequest({ recordedBy: DEFAULT_ACTOR, covered, note, baseline });
    if (request === null) return;
    setSaving(true);
    setError(null);
    try {
      await recordProgress(territoryId, request);
      cancel();
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

  function statusText(): string {
    if (adjusting) {
      return 'Arrastra un punto para moverlo, haz clic en un borde para agregar uno o doble clic en un punto para borrarlo. Pulsa “Listo” al terminar.';
    }
    if (covered.isClosed) return 'Área lista. Ya puedes guardar la sesión.';
    if (vertexCount === 0) return 'Haz clic en el mapa para marcar el primer punto del área cubierta.';
    if (vertexCount < COVERED_MIN_VERTICES) {
      const missing = COVERED_MIN_VERTICES - vertexCount;
      return `Sigue marcando puntos: ${missing === 1 ? 'falta 1' : `faltan ${missing}`} para poder cerrar el área.`;
    }
    return 'Cuando termines de marcar, pulsa “Cerrar área” para poder guardar la sesión.';
  }

  return (
    <section aria-labelledby="progress-recorder-heading">
      <h3 id="progress-recorder-heading">Registrar sesión</h3>
      <p>Marca en el mapa lo que cubrieron en esta sesión. Lo que falta se calcula solo.</p>

      <div
        ref={containerRef}
        className="session-map"
        role="img"
        aria-label={`Mapa de la sesión: territorio, área pendiente y sesiones anteriores. ${
          vertexCount > 0
            ? `Área cubierta: ${vertexCount} punto(s)${covered.isClosed ? ', cerrada' : ''}.`
            : 'Todavía no hay área cubierta dibujada.'
        }`}
      />
      <p className="map-attribution">{OSM_ATTRIBUTION}</p>

      <div role="toolbar" aria-label="Herramientas de la sesión" className="map-toolbar">
        {covered.isClosed ? (
          <>
            <button type="button" onClick={() => setAdjusting((current) => !current)} aria-pressed={adjusting}>
              {adjusting ? 'Listo' : 'Ajustar puntos'}
            </button>
            <button type="button" onClick={redraw}>
              Borrar y volver a dibujar
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setCovered((current) => undoVertex(current))} disabled={vertexCount === 0}>
              Deshacer punto
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => setCovered((current) => closeDraft(current))}
              disabled={vertexCount < COVERED_MIN_VERTICES}
            >
              Cerrar área
            </button>
          </>
        )}
      </div>

      <p role="status">{statusText()}</p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        style={{ marginTop: '0.75rem' }}
      >
        <div>
          <label htmlFor="progress-note">Nota para el próximo grupo (opcional)</label>
          <textarea
            id="progress-note"
            rows={2}
            value={note}
            aria-describedby={NOTE_HELP_ID}
            onChange={(event) => setNote(event.target.value)}
          />
          <p id={NOTE_HELP_ID} className="editor-hint">
            La verá quien tenga el enlace del territorio. Ej.: “Quedamos en la esquina de la Diagonal 57 con 19C”. No
            escribas nombres ni datos de personas.
          </p>
        </div>

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

        <div className="session-actions">
          <button type="submit" className="primary" disabled={!coveredReady || saving || baselinePrompt}>
            {saving ? 'Guardando…' : 'Guardar sesión'}
          </button>
          <button type="button" onClick={cancel} disabled={!hasAnything || saving}>
            Cancelar
          </button>
        </div>
      </form>
    </section>
  );
}
