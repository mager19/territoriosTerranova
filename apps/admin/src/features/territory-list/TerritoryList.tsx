import { useEffect, useState, type JSX } from 'react';

import {
  ApiError,
  describeApiError,
  listTerritories,
  type TerritoryListItem
} from '../../api/client.js';
import { geometryToThumbnail } from './thumbnail.js';

export interface TerritoryListProps {
  /** Bumped by the parent after a successful save, to force a refetch. */
  readonly refreshToken: number;
}

const OPERATIONAL_STATE_LABELS: Record<TerritoryListItem['operationalState'], string> = {
  no_record: 'Sin registro',
  in_progress: 'En progreso',
  paused: 'Pausado',
  cycle_completed: 'Ciclo completado',
  reopened: 'Reabierto — en progreso'
};

/**
 * The territory grid (A5 brief's non-map review surface). Every card is a
 * real `<a href="/territorios/:id">` anchor — the whole card is clickable,
 * keyboard-operable (Tab + the browser's default focus ring, never
 * suppressed), and middle-click/copy-link friendly because the href is a
 * real URL. This component only lists: selecting a territory is now the
 * deep-link's job (App fetches on arrival), so there is no `onSelect` and
 * no `getTerritory` here.
 */
export function TerritoryList({ refreshToken }: TerritoryListProps): JSX.Element {
  const [territories, setTerritories] = useState<readonly TerritoryListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stateFilter, setStateFilter] = useState<'all' | TerritoryListItem['operationalState']>('all');

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

  return (
    <section aria-labelledby="territory-list-heading">
      <h2 id="territory-list-heading">Territorios</h2>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Cargando territorios…</p>}
      {!loading && territories.length === 0 && <p>Todavía no hay territorios. Crea el primero desde «Nuevo Territorio».</p>}

      <label htmlFor="operational-state-filter">Filtrar por estado operativo</label>
      <select id="operational-state-filter" value={stateFilter} onChange={(event) => setStateFilter(event.target.value as typeof stateFilter)}>
        <option value="all">Todos los estados</option>
        <option value="no_record">Sin registro</option>
        <option value="in_progress">En progreso</option>
        <option value="paused">Pausado</option>
        <option value="cycle_completed">Ciclo completado</option>
        <option value="reopened">Reabierto — en progreso</option>
      </select>
      <ul className="territory-grid">
        {territories.filter((territory) => stateFilter === 'all' || territory.operationalState === stateFilter).map((territory) => {
          const thumbnail = territory.geometry === null ? null : geometryToThumbnail(territory.geometry);
          return (
            <li key={territory.id}>
              <a className="territory-card" href={`/territorios/${territory.id}`}>
                {thumbnail ? (
                  <svg
                    className="territory-thumbnail"
                    viewBox={thumbnail.viewBox}
                    role="img"
                    aria-label={`Contorno de ${territory.name}`}
                    focusable="false"
                  >
                    {thumbnail.parts.map((points, index) => (
                      <polygon key={index} points={points} />
                    ))}
                  </svg>
                ) : (
                  <div className="territory-thumbnail territory-thumbnail--empty">Sin contorno</div>
                )}
                <span className="territory-card-name">{territory.name}</span>
                <span className="territory-card-number">{territory.number ?? '—'}</span>
                <span className="territory-card-revision">revisión {territory.currentRevisionNumber}</span>
                <span className="territory-card-status">{OPERATIONAL_STATE_LABELS[territory.operationalState]}</span>
                {territory.status === 'archived' && <span className="territory-card-status">(archivado)</span>}
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
