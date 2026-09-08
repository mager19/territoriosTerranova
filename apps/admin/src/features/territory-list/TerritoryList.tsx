import { useEffect, useState, type JSX } from 'react';

import {
  ApiError,
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
 * The non-map, keyboard-operable fallback for reviewing territories and
 * their revision history (A5 brief DoD). Every control here is a native
 * <button>, reachable by Tab, with the browser's default focus ring never
 * suppressed — this is what a keyboard or screen-reader user relies on
 * instead of clicking the map canvas.
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
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : 'could not load territories');
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
      setError(caught instanceof ApiError ? caught.message : 'could not load that territory');
    }
  }

  return (
    <section aria-labelledby="territory-list-heading">
      <h2 id="territory-list-heading">Territories</h2>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Loading territories…</p>}
      {!loading && territories.length === 0 && <p>No territories yet. Draw one below.</p>}

      <ul>
        {territories.map((territory) => (
          <li key={territory.id}>
            <button
              type="button"
              aria-current={territory.id === selectedTerritoryId ? 'true' : undefined}
              onClick={() => void handleSelect(territory.id)}
            >
              {territory.name} — revision {territory.currentRevisionNumber}
            </button>
          </li>
        ))}
      </ul>

      <button type="button" onClick={() => onSelect(null)} disabled={selectedTerritoryId === null}>
        Draw a new territory instead
      </button>

      {selectedTerritoryId !== null && (
        <SelectedTerritoryHistory territoryId={selectedTerritoryId} refreshToken={refreshToken} />
      )}
    </section>
  );
}

function SelectedTerritoryHistory({
  territoryId,
  refreshToken
}: {
  territoryId: number;
  refreshToken: number;
}): JSX.Element {
  const [territory, setTerritory] = useState<TerritoryWithRevisions | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTerritory(territoryId)
      .then((result) => {
        if (!cancelled) setTerritory(result);
      })
      .catch(() => {
        /* the parent's error banner already covers load failures */
      });
    return () => {
      cancelled = true;
    };
  }, [territoryId, refreshToken]);

  if (!territory) {
    return <p role="status">Loading revision history…</p>;
  }

  return (
    <div aria-labelledby="revision-history-heading">
      <h3 id="revision-history-heading">Revision history — {territory.name}</h3>
      {/* Oldest first: a history reads chronologically, and nothing here is
          ever an editable row — every revision is a permanent, numbered
          fact, never replaced (AGENTS.md: revisions are immutable). */}
      <ol>
        {territory.revisions.map((revision) => (
          <li key={revision.id}>
            Revision {revision.revisionNumber} by {revision.author}, {new Date(revision.createdAt).toLocaleString()}
          </li>
        ))}
      </ol>
    </div>
  );
}
