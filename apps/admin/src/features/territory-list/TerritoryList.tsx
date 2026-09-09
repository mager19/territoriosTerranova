import { useEffect, useState, type JSX } from 'react';

import {
  ApiError,
  describeApiError,
  getTerritory,
  listTerritories,
  type Territory,
  type TerritoryWithRevisions
} from '../../api/client.js';

export interface TerritoryListProps {
  readonly selectedTerritoryId: number | null;
  readonly onSelect: (territory: TerritoryWithRevisions | null) => void;
  /** Bumped by the parent after a successful save, to force a refetch. */
  readonly refreshToken: number;
}

/**
 * The non-map, keyboard-operable fallback for reviewing and selecting
 * territories (A5 brief DoD). Every control here is a native <button>,
 * reachable by Tab, with the browser's default focus ring never
 * suppressed — this is what a keyboard or screen-reader user relies on
 * instead of clicking the map canvas.
 *
 * Per-revision history (who changed what, when) is deliberately NOT
 * duplicated here — AuditHistory (TerritoryDetail, once a territory is
 * selected) already logs every `revision_submitted` event with the same
 * author/timestamp, alongside sharing and progress events, as one
 * coherent log. Showing it again here was redundant (found live,
 * 2026-09-08: "no es necesario mostrarlo acá").
 */
export function TerritoryList({ selectedTerritoryId, onSelect, refreshToken }: TerritoryListProps): JSX.Element {
  const [territories, setTerritories] = useState<readonly Territory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listTerritories()
      .then((result) => {
        if (!cancelled) setTerritories(result.territories);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof ApiError ? describeApiError(caught) : 'No se pudieron cargar los territorios.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  async function handleSelect(id: number): Promise<void> {
    try {
      const territory = await getTerritory(id);
      onSelect(territory);
    } catch (caught) {
      setError(caught instanceof ApiError ? describeApiError(caught) : 'No se pudo cargar ese territorio.');
    }
  }

  return (
    <section aria-labelledby="territory-list-heading">
      <h2 id="territory-list-heading">Territorios</h2>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Cargando territorios…</p>}
      {!loading && territories.length === 0 && <p>Todavía no hay territorios. Dibujá uno abajo.</p>}

      <ul>
        {territories.map((territory) => (
          <li key={territory.id}>
            <button
              type="button"
              aria-current={territory.id === selectedTerritoryId ? 'true' : undefined}
              onClick={() => void handleSelect(territory.id)}
            >
              {territory.name} — revisión {territory.currentRevisionNumber}
            </button>
          </li>
        ))}
      </ul>

      <button type="button" onClick={() => onSelect(null)} disabled={selectedTerritoryId === null}>
        Dibujar un territorio nuevo
      </button>
    </section>
  );
}
