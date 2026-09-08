import { useEffect, useRef, useState, type JSX } from 'react';
import { Map as MapLibreMap, NavigationControl, type MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { ApiError, createTerritory, submitRevision, type TerritoryWithRevisions } from '../../api/client.js';
import {
  addVertex,
  closeDraft,
  createDraft,
  draftToPolygonGeoJSON,
  resetDraft,
  undoVertex,
  type DraftState
} from './draft.js';
import {
  BELLO_CENTER,
  BELLO_ZOOM,
  OSM_ATTRIBUTION,
  createBelloMapStyle,
  fitToPolygon,
  installEditorLayers,
  renderDraft,
  renderRemainingArea,
  renderSavedTerritory,
  screenPointToCoordinate
} from './map-editor.js';
import type { Polygon } from '@territorios/geo';

export interface TerritoryEditorProps {
  /** The territory to draw a new revision for, or null to draw a brand-new territory. */
  readonly selectedTerritory: TerritoryWithRevisions | null;
  readonly onSaved: (territory: TerritoryWithRevisions) => void;
  /** The latest recorded progress entry's remaining-area geometry, or null when unknown (slice 2: TerritoryDetail owns fetching this). */
  readonly remainingAreaGeometry?: Polygon | null;
}

/**
 * The map DRAWING interaction (placing vertices by clicking) is inherently
 * pointer-based — a canvas-rendered map has no DOM nodes per vertex to tab
 * through, the same limitation every canvas map-drawing tool has. Every
 * CONTROL around it (undo, close, save, the name/author inputs) is a real
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
  const [author, setAuthor] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

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
  // state (A5 brief hard constraint).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const handleClick = (event: MapMouseEvent) => {
      const coordinate = screenPointToCoordinate(map, event.point);
      setDraft((current) => addVertex(current, coordinate));
    };
    map.on('click', handleClick);
    return () => {
      map.off('click', handleClick);
    };
  }, [mapReady]);

  // Re-render the draft layer whenever the draft state changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    renderDraft(map, draft);
  }, [draft, mapReady]);

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
    setError(null);
  }, [selectedTerritory, mapReady]);

  const geometry = draftToPolygonGeoJSON(draft);
  const canClose = !draft.isClosed && draft.vertices.length >= 3;
  const canUndo = !draft.isClosed && draft.vertices.length > 0;
  const canSave = geometry !== null && author.trim() !== '' && (selectedTerritory !== null || name.trim() !== '');

  async function handleSave(): Promise<void> {
    if (!geometry) return;
    setSaving(true);
    setError(null);
    try {
      const saved = selectedTerritory
        ? await (async () => {
            const revision = await submitRevision(selectedTerritory.id, { geometry, author: author.trim() });
            return { ...selectedTerritory, revisions: [...selectedTerritory.revisions, revision] };
          })()
        : await createTerritory({ name: name.trim(), geometry, author: author.trim() });
      setDraft(resetDraft());
      onSaved(saved);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError({ code: caught.code, message: caught.message });
      } else {
        setError({ code: 'unexpected_error', message: 'an unexpected error occurred; nothing was saved' });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="editor-heading">
      <h2 id="editor-heading">
        {selectedTerritory ? `New revision for ${selectedTerritory.name}` : 'Draw a new territory'}
      </h2>

      <div
        ref={containerRef}
        role="img"
        aria-label={`Map centered on Bello, used to draw a territory boundary. ${
          draft.vertices.length > 0 ? `${draft.vertices.length} point(s) placed.` : 'No points placed yet.'
        }`}
        style={{ width: '100%', height: '420px', border: '1px solid var(--map-border, #ccc)' }}
      />
      <p className="map-attribution">{OSM_ATTRIBUTION}</p>

      <div role="group" aria-label="Drawing controls" style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        <button type="button" onClick={() => setDraft((current) => undoVertex(current))} disabled={!canUndo}>
          Undo point
        </button>
        <button type="button" onClick={() => setDraft((current) => closeDraft(current))} disabled={!canClose}>
          Close boundary
        </button>
        <button type="button" onClick={() => setDraft(resetDraft())} disabled={draft.vertices.length === 0}>
          Reset
        </button>
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
            <label htmlFor="territory-name">Territory name</label>
            <input id="territory-name" value={name} onChange={(event) => setName(event.target.value)} required />
          </div>
        )}
        <div>
          <label htmlFor="territory-author">Your name (revision author)</label>
          <input id="territory-author" value={author} onChange={(event) => setAuthor(event.target.value)} required />
        </div>

        {!draft.isClosed && (
          <p role="status">
            {draft.vertices.length === 0 && 'Click the map to place the first point.'}
            {draft.vertices.length > 0 &&
              draft.vertices.length < 3 &&
              `${draft.vertices.length} point(s) placed — at least 3 are needed to close the boundary.`}
            {draft.vertices.length >= 3 && `${draft.vertices.length} points placed. Close the boundary to save.`}
          </p>
        )}

        {error && (
          <p role="alert" className="editor-error">
            <strong>{error.code}:</strong> {error.message}
          </p>
        )}

        <button type="submit" disabled={!canSave || saving}>
          {saving ? 'Saving…' : selectedTerritory ? 'Save new revision' : 'Save territory'}
        </button>
      </form>
    </section>
  );
}
