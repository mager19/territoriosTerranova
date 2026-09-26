import { useEffect, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Map as MapLibreMap, NavigationControl, type MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import {
  ApiError,
  createTerritory,
  DEFAULT_ACTOR,
  describeApiError,
  searchReferenceBarrios,
  submitRevision,
  type ReferenceBarrio,
  type TerritoryWithRevisions
} from '../../api/client.js';
import {
  addVertex,
  closeDraft,
  createDraft,
  draftFromPolygon,
  draftToPolygonGeoJSON,
  insertVertex,
  moveVertex,
  removeVertexAt,
  resetDraft,
  undoVertex,
  type DraftState
} from './draft.js';
import {
  BELLO_CENTER,
  BELLO_ZOOM,
  OSM_ATTRIBUTION,
  createBelloMapStyle,
  findEdgeIndexAtPoint,
  findVertexIndexAtPoint,
  fitToMultiPolygon,
  fitToPolygon,
  installEditorLayers,
  renderDraft,
  renderReferenceBarrios,
  renderRemainingArea,
  renderSavedTerritory,
  screenPointToCoordinate
} from './map-editor.js';
import type { MultiPolygon, Polygon } from '@territorios/geo';
import { formatKm2, nextActiveIndex } from './barrio.js';

export interface TerritoryEditorProps {
  /** The territory to draw a new revision for, or null to draw a brand-new territory. */
  readonly selectedTerritory: TerritoryWithRevisions | null;
  readonly onSaved: (territory: TerritoryWithRevisions) => void;
  /** The latest recorded progress entry's remaining-area geometry, or null when unknown (slice 2: TerritoryDetail owns fetching this). */
  readonly remainingAreaGeometry?: Polygon | MultiPolygon | null;
}

/**
 * The map DRAWING interaction (placing vertices by clicking) is inherently
 * pointer-based — a canvas-rendered map has no DOM nodes per vertex to tab
 * through, the same limitation every canvas map-drawing tool has. Every
 * CONTROL around it (undo, close, save, the territory-name input) is a real
 * HTML element with native keyboard operability and the browser's default
 * focus ring, deliberately never suppressed. The territory LIST (a sibling
 * component, TerritoryList) is the accessible, non-map way to select and
 * review territories the A5 brief's DoD asks for.
 */
export function TerritoryEditor({
  selectedTerritory,
  onSaved,
  remainingAreaGeometry = null
}: TerritoryEditorProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [draft, setDraft] = useState<DraftState>(createDraft());
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Point-by-point editing is a separate, explicit mode rather than always
  // active: it must never change what a plain click on a closed draft does
  // (addVertex's own rule — starting a new shape) unless the admin opted in.
  const [editingVertices, setEditingVertices] = useState(false);
  const draggingIndexRef = useRef<number | null>(null);
  // Mirrors `draft` for the mousemove cursor-hint handler below, which
  // needs the current vertex list on every pointer move without
  // recreating its event listeners (and re-disabling/re-enabling map
  // interactions) on every single vertex change.
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // AMVA barrio reference (2026-09-08: an admin expected one territory to
  // cover a whole barrio — Guasimalito — and found only a small fraction of
  // it, since a territory is one manzana/block by design). Purely a visual
  // guide drawn under the real layers; never saved, never sent anywhere.
  // The autocomplete keeps ONE selected barrio (not a result list): the
  // input is the search box, `barrioOptions` is the live dropdown, and
  // `selectedBarrio` is the single barrio rendered on the map.
  const [barrioQuery, setBarrioQuery] = useState('');
  const [barrioOptions, setBarrioOptions] = useState<readonly ReferenceBarrio[]>([]);
  const [selectedBarrio, setSelectedBarrio] = useState<ReferenceBarrio | null>(null);
  const [barrioOpen, setBarrioOpen] = useState(false);
  const [barrioActiveIndex, setBarrioActiveIndex] = useState(-1);
  const [searchingBarrio, setSearchingBarrio] = useState(false);
  const [barrioMessage, setBarrioMessage] = useState<string | null>(null);
  // Monotonic sequence id so a slow earlier search can never overwrite a
  // newer one: every effect run bumps it, and a stale response (whose id no
  // longer matches) is discarded.
  const barrioRequestSeqRef = useRef(0);
  // Wraps the combobox so a click elsewhere on the page closes the dropdown.
  const barrioComboboxRef = useRef<HTMLDivElement | null>(null);

  // Map lifecycle: created once. React's StrictMode (development only)
  // deliberately mounts every effect twice — mount, synthetic cleanup,
  // mount again — to surface unsafe side effects. MapLibre is not written
  // to tolerate being created and torn down twice in immediate succession
  // on the SAME container: the observed symptom was tiles rendering fine
  // (the double-mount completes visually) but click handling silently
  // dead, because the surviving map instance's own 'load' event had
  // already fired and been consumed by the FIRST (already-removed)
  // instance's closures. `initializedRef` makes creation idempotent across
  // StrictMode's extra pass; TerritoryEditor is never conditionally
  // unmounted in this app (App.tsx always renders it), so skipping
  // teardown on the synthetic first cleanup does not leak in practice.
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
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', () => {
      installEditorLayers(map);
      setMapReady(true);
    });
    mapRef.current = map;
  }, []);

  // Click-to-draw: only while there is no pending unsaved close, and never
  // sending raw pixel coordinates anywhere — screenPointToCoordinate
  // converts via MapLibre's real projection before the vertex ever reaches
  // state (A5 brief hard constraint). Suppressed entirely in "edit points"
  // mode — dragging (below) owns every pointer interaction there.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const handleClick = (event: MapMouseEvent) => {
      if (editingVertices) return;
      const coordinate = screenPointToCoordinate(map, event.point);
      setDraft((current) => addVertex(current, coordinate));
    };
    map.on('click', handleClick);
    return () => {
      map.off('click', handleClick);
    };
  }, [mapReady, editingVertices]);

  // Point editing: drag an existing vertex to move it, click on an edge to
  // insert a new one there, double-click a vertex to remove it — only
  // while "edit points" mode is on. Map panning is disabled for the
  // duration of a vertex drag so the two gestures never fight over the
  // same pointer movement; a window-level mouseup (not just the map's own)
  // ends the drag even if the pointer left the map first. Double-click-to-
  // zoom is disabled for the same reason double-click means "remove" here.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !editingVertices) return;

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
        } else if (findEdgeIndexAtPoint(map, draftRef.current.vertices, event.point) !== null) {
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

    // Inserting belongs on a click that landed neither on the drag just
    // finished nor directly on an existing vertex (that click is already
    // spent starting/continuing the drag above).
    const handleClick = (event: MapMouseEvent) => {
      if (findVertexIndexAtPoint(map, event.point) !== null) return;
      setDraft((current) => {
        const edgeIndex = findEdgeIndexAtPoint(map, current.vertices, event.point);
        if (edgeIndex === null) return current;
        return insertVertex(current, edgeIndex, screenPointToCoordinate(map, event.point));
      });
    };

    const handleDblClick = (event: MapMouseEvent) => {
      const index = findVertexIndexAtPoint(map, event.point);
      if (index === null) return;
      event.preventDefault();
      setDraft((current) => removeVertexAt(current, index));
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
  }, [mapReady, editingVertices]);

  // Re-render the draft layer whenever the draft state changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    renderDraft(map, draft);
  }, [draft, mapReady]);

  // Re-render the AMVA reference-barrio overlay: the single selected barrio
  // (or nothing once cleared). Fitting is done here too, so selection and
  // camera move together from one state source.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    renderReferenceBarrios(
      map,
      selectedBarrio === null ? [] : [{ name: selectedBarrio.name, geometry: selectedBarrio.geometry }]
    );
    if (selectedBarrio !== null) {
      fitToMultiPolygon(map, selectedBarrio.geometry);
    }
  }, [selectedBarrio, mapReady]);

  // Debounced barrio search: fires ~250ms after typing stops, never on
  // Enter/click. An empty query (or one that already equals the selected
  // barrio's name) clears the dropdown without a request. The monotonic
  // sequence id discards any slow earlier response so it can never overwrite
  // a newer query's results.
  useEffect(() => {
    const query = barrioQuery.trim();
    barrioRequestSeqRef.current += 1; // invalidate any in-flight search
    setSearchingBarrio(false);

    if (query === '' || (selectedBarrio !== null && query === selectedBarrio.name)) {
      setBarrioOptions([]);
      setBarrioOpen(false);
      setBarrioMessage(null);
      return;
    }

    const timer = setTimeout(() => {
      const seq = barrioRequestSeqRef.current;
      setSearchingBarrio(true);
      setBarrioMessage(null);
      void searchReferenceBarrios(query)
        .then(({ barrios }) => {
          if (seq !== barrioRequestSeqRef.current) return;
          setSearchingBarrio(false);
          setBarrioOptions(barrios);
          setBarrioActiveIndex(barrios.length > 0 ? 0 : -1);
          setBarrioOpen(barrios.length > 0);
          setBarrioMessage(barrios.length === 0 ? 'No se encontró ningún barrio.' : null);
        })
        .catch((caught: unknown) => {
          if (seq !== barrioRequestSeqRef.current) return;
          setSearchingBarrio(false);
          setBarrioOptions([]);
          setBarrioOpen(false);
          setBarrioMessage(caught instanceof ApiError ? describeApiError(caught) : 'No se pudo buscar el barrio.');
        });
    }, 250);

    return () => clearTimeout(timer);
  }, [barrioQuery, selectedBarrio]);

  // Close the dropdown when a click lands outside the combobox — the map is
  // a canvas that never emits clicks into this subtree, so without this the
  // options list would hang open after the admin starts drawing.
  useEffect(() => {
    function handleDocumentMouseDown(event: MouseEvent): void {
      if (barrioComboboxRef.current && !barrioComboboxRef.current.contains(event.target as Node)) {
        setBarrioOpen(false);
      }
    }
    document.addEventListener('mousedown', handleDocumentMouseDown);
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown);
  }, []);

  // The latest progress entry's remaining area — TerritoryDetail (slice 2)
  // owns fetching it. Absent means unknown; the layer is simply empty then,
  // never a guessed shape.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    renderRemainingArea(map, remainingAreaGeometry);
  }, [remainingAreaGeometry, mapReady]);

  // Show the selected territory's current revision as the "saved" layer,
  // distinct from the in-progress draft; fit the view to it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const currentRevision = selectedTerritory?.revisions.at(-1) ?? null;
    renderSavedTerritory(map, currentRevision?.geometry ?? null);
    if (currentRevision) {
      fitToPolygon(map, currentRevision.geometry);
    }
    setDraft(createDraft());
    setEditingVertices(false);
    setError(null);
  }, [selectedTerritory, mapReady]);

  const currentRevisionGeometry = selectedTerritory?.revisions.at(-1)?.geometry ?? null;
  const geometry = draftToPolygonGeoJSON(draft);
  const canClose = !draft.isClosed && draft.vertices.length >= 3;
  const canUndo = !draft.isClosed && draft.vertices.length > 0;
  const canSave = geometry !== null && (selectedTerritory !== null || name.trim() !== '');

  function handleEditCurrentShape(): void {
    if (!currentRevisionGeometry) return;
    setDraft(draftFromPolygon(currentRevisionGeometry.coordinates));
    setEditingVertices(true);
    setError(null);
  }

  function handleBarrioInputChange(value: string): void {
    setBarrioQuery(value);
    // Editing away from the selected name abandons the selection — the input
    // no longer reflects it, so keeping it would be visually ambiguous.
    if (selectedBarrio !== null && value !== selectedBarrio.name) {
      setSelectedBarrio(null);
    }
  }

  function handleBarrioSelect(barrio: ReferenceBarrio): void {
    setSelectedBarrio(barrio);
    setBarrioQuery(barrio.name);
    setBarrioOptions([]);
    setBarrioOpen(false);
    setBarrioActiveIndex(-1);
    setBarrioMessage(null);
  }

  function handleBarrioKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (barrioOptions.length > 0) {
        setBarrioActiveIndex((current) => nextActiveIndex(current, 'down', barrioOptions.length));
        setBarrioOpen(true);
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (barrioOptions.length > 0) {
        setBarrioActiveIndex((current) => nextActiveIndex(current, 'up', barrioOptions.length));
        setBarrioOpen(true);
      }
    } else if (event.key === 'Enter') {
      if (barrioOpen && barrioActiveIndex >= 0 && barrioOptions[barrioActiveIndex]) {
        event.preventDefault();
        handleBarrioSelect(barrioOptions[barrioActiveIndex]);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setBarrioOpen(false);
    }
  }

  function handleBarrioClear(): void {
    setSelectedBarrio(null);
    setBarrioQuery('');
    setBarrioOptions([]);
    setBarrioOpen(false);
    setBarrioActiveIndex(-1);
    setBarrioMessage(null);
  }

  async function handleSave(): Promise<void> {
    if (!geometry) return;
    setSaving(true);
    setError(null);
    try {
      const trimmedNumber = number.trim();
      const saved = selectedTerritory
        ? await (async () => {
            const revision = await submitRevision(selectedTerritory.id, { geometry, author: DEFAULT_ACTOR });
            return { ...selectedTerritory, revisions: [...selectedTerritory.revisions, revision] };
          })()
        : await createTerritory({
            name: name.trim(),
            geometry,
            author: DEFAULT_ACTOR,
            ...(trimmedNumber === '' ? {} : { number: trimmedNumber })
          });
      setDraft(resetDraft());
      setNumber('');
      onSaved(saved);
    } catch (caught) {
      setError(caught instanceof ApiError ? describeApiError(caught) : 'Ocurrió un error inesperado; no se guardó nada.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="editor-heading">
      <h2 id="editor-heading">
        {selectedTerritory ? `Nueva revisión para ${selectedTerritory.name}` : 'Dibujar un territorio nuevo'}
      </h2>

      <div
        ref={containerRef}
        role="img"
        aria-label={`Mapa centrado en Bello, para dibujar el contorno de un territorio. ${
          editingVertices
            ? 'Modo de edición de puntos: arrastrá un punto para moverlo, hacé clic en un borde para agregar uno, doble clic en un punto para borrarlo.'
            : draft.vertices.length > 0
              ? `${draft.vertices.length} punto(s) ubicado(s).`
              : 'Todavía no hay puntos ubicados.'
        }`}
        style={{ width: '100%', height: '420px', border: '1px solid var(--map-border, #ccc)' }}
      />
      <p className="map-attribution">{OSM_ATTRIBUTION}</p>

      <div className="barrio-combobox" ref={barrioComboboxRef}>
        <label htmlFor="barrio-search">Barrio de referencia</label>
        <input
          id="barrio-search"
          type="text"
          role="combobox"
          aria-expanded={barrioOpen}
          aria-controls="barrio-listbox"
          aria-autocomplete="list"
          aria-activedescendant={barrioOpen && barrioActiveIndex >= 0 ? `barrio-option-${barrioActiveIndex}` : undefined}
          autoComplete="off"
          value={barrioQuery}
          onChange={(event) => handleBarrioInputChange(event.target.value)}
          onKeyDown={handleBarrioKeyDown}
          placeholder="ej. Guasimalito"
        />
        {barrioOpen && (
          <div id="barrio-listbox" role="listbox" aria-label="Barrios que coinciden" className="barrio-options">
            {barrioOptions.map((barrio, index) => (
              <button
                key={barrio.id}
                type="button"
                id={`barrio-option-${index}`}
                role="option"
                aria-selected={index === barrioActiveIndex}
                tabIndex={-1}
                className="barrio-option"
                onClick={() => handleBarrioSelect(barrio)}
                onMouseMove={() => {
                  if (index !== barrioActiveIndex) setBarrioActiveIndex(index);
                }}
              >
                <span className="barrio-option-name">{barrio.name}</span>
                {barrio.extensionKm2 !== null && (
                  <span className="barrio-option-extension">{formatKm2(barrio.extensionKm2)}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      {searchingBarrio && <p role="status" className="barrio-status">Buscando…</p>}
      {!searchingBarrio && barrioMessage && (
        <p role="status" className="barrio-status">{barrioMessage}</p>
      )}
      {selectedBarrio !== null && (
        <div className="barrio-selected">
          <span>
            Referencia: <strong>{selectedBarrio.name}</strong>
          </span>
          <button type="button" className="barrio-clear" onClick={handleBarrioClear}>
            Quitar
          </button>
        </div>
      )}

      <div role="toolbar" aria-label="Herramientas de geometría" className="map-toolbar">
        {editingVertices && (
          <button type="button" onClick={() => setEditingVertices(false)} aria-pressed>
            Terminar edición de vértices
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setDraft(createDraft());
            setEditingVertices(false);
          }}
        >
          Reemplazar borrador
        </button>
        <button
          type="button"
          onClick={() => setEditingVertices(true)}
          disabled={!draft.isClosed || editingVertices}
          aria-pressed={editingVertices}
        >
          Editar vértices
        </button>
        <button
          type="button"
          onClick={() => setDraft((current) => undoVertex(current))}
          disabled={!canUndo || editingVertices}
        >
          Deshacer vértice
        </button>
        <button
          type="button"
          onClick={() => setDraft((current) => closeDraft(current))}
          disabled={!canClose || editingVertices}
        >
          Cerrar contorno
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(resetDraft());
            setEditingVertices(false);
          }}
          disabled={draft.vertices.length === 0}
        >
          Descartar borrador
        </button>
        {currentRevisionGeometry && (
          <button type="button" onClick={handleEditCurrentShape}>
            Editar forma actual
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
        {!selectedTerritory && (
          <div>
            <label htmlFor="territory-name">Nombre del territorio</label>
            <input id="territory-name" value={name} onChange={(event) => setName(event.target.value)} required />
          </div>
        )}

        {!selectedTerritory && (
          <div>
            <label htmlFor="territory-number">Número (opcional)</label>
            <input id="territory-number" value={number} onChange={(event) => setNumber(event.target.value)} />
          </div>
        )}

        {!draft.isClosed && (
          <p role="status">
            {draft.vertices.length === 0 && 'Hacé clic en el mapa para ubicar el primer punto.'}
            {draft.vertices.length > 0 &&
              draft.vertices.length < 3 &&
              `${draft.vertices.length} punto(s) ubicado(s) — se necesitan al menos 3 para cerrar el contorno.`}
            {draft.vertices.length >= 3 && `${draft.vertices.length} puntos ubicados. Cerrá el contorno para guardar.`}
          </p>
        )}
        {draft.isClosed && editingVertices && (
          <p role="status">
            Arrastrá un punto para moverlo, hacé clic en un borde para agregar uno, doble clic en un punto para
            borrarlo. Usá “Terminar edición de vértices” para conservar los cambios y guardar.
          </p>
        )}
        {draft.isClosed && !editingVertices && (
          <p role="status">
            {canSave
              ? `${draft.vertices.length} puntos. Listo para guardar, o Editar vértices para ajustar el contorno.`
              : `${draft.vertices.length} puntos. Editá vértices para ajustar el contorno, o completá los campos requeridos abajo para guardar.`}
          </p>
        )}

        {/* Visible, not just a disabled button — a disabled control with no
            explanation is exactly how a real edit silently failed to save
            (found live: an admin dragged a point but a since-removed
            required field stayed empty, and nothing on screen said why the
            save button did not respond). */}
        {geometry !== null && !canSave && !saving && !selectedTerritory && name.trim() === '' && (
          <p role="status" className="editor-hint">
            Escribí un nombre de territorio arriba para guardar.
          </p>
        )}

        {error && (
          <p role="alert" className="editor-error">
            {error}
          </p>
        )}

        <button type="submit" disabled={!canSave || saving}>
          {saving ? 'Guardando…' : selectedTerritory ? 'Guardar nueva revisión' : 'Guardar territorio'}
        </button>
      </form>
    </section>
  );
}
