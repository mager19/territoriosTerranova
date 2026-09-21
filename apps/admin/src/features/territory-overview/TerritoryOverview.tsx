import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';

import { ApiError, describeApiError, getTerritoryOverview, type TerritoryOverviewRow } from '../../api/client.js';
import { MonthStrip } from './MonthStrip.js';
import { TerritoryPreview } from './TerritoryPreview.js';
import { describeLastWorked, formatHectares, monthLabel } from './overview-format.js';

const MONTHS = 12;

type AttentionFilter = 'all' | 'none-in-month' | 'never';
type SortKey = 'number' | 'times' | 'lastWorked';

/**
 * The administrator's oversight view: one row per territory, with how often
 * it was worked each month for the last year.
 *
 * It deliberately reports counts and dates, never a percentage of coverage —
 * progress is a line along a perimeter, not a fraction, and inferring one
 * would be exactly what AGENTS.md forbids. It also names no volunteers: the
 * work belongs to the group, which is why individual assignment was removed
 * in the first place.
 *
 * The selected month is derived client-side from the monthly series rather
 * than refetched, so changing months is instant and one number never has two
 * definitions.
 */
export function TerritoryOverview(): JSX.Element {
  const [rows, setRows] = useState<readonly TerritoryOverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [attention, setAttention] = useState<AttentionFilter>('all');
  // The territory whose map preview is open — kept entirely separate from
  // the fetch/filter/sort state above so selecting a row never refetches
  // the table or resets any of it.
  const [previewId, setPreviewId] = useState<number | null>(null);
  // 'number' means "leave the server's ordering alone" — it already sorts by
  // (length(number), number) with un-numbered territories last, which no
  // client-side comparator would reproduce as well.
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({ key: 'number', ascending: true });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getTerritoryOverview({ months: MONTHS, includeArchived })
      .then((result) => {
        if (cancelled) return;
        setRows(result.territories);
        const latest = result.territories[0]?.monthly.at(-1)?.month ?? null;
        setSelectedMonth((current) => current ?? latest);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof ApiError ? describeApiError(caught) : 'No se pudo cargar el resumen.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [includeArchived]);

  const availableMonths = rows[0]?.monthly.map((month) => month.month) ?? [];

  // Memoized so it has a stable identity across renders unless selectedMonth
  // changes — that lets it be listed as a useMemo dependency below without
  // defeating the memoization (a plain inline function would be a new
  // reference every render, forcing visibleRows to recompute every time).
  const timesInSelectedMonth = useCallback(
    (row: TerritoryOverviewRow): number => {
      if (selectedMonth === null) return 0;
      return row.monthly.find((month) => month.month === selectedMonth)?.times ?? 0;
    },
    [selectedMonth]
  );

  const visibleRows = useMemo(() => {
    const filtered = rows.filter((row) => {
      if (attention === 'never') return row.lastWorkedAt === null;
      if (attention === 'none-in-month') return timesInSelectedMonth(row) === 0;
      return true;
    });

    if (sort.key === 'number') return filtered;

    const direction = sort.ascending ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sort.key === 'times') {
        return (timesInSelectedMonth(a) - timesInSelectedMonth(b)) * direction;
      }
      // A territory never worked is the most stale thing there is, so it sorts
      // as older than any real date rather than being pushed to the end.
      const aTime = a.lastWorkedAt === null ? -Infinity : new Date(a.lastWorkedAt).getTime();
      const bTime = b.lastWorkedAt === null ? -Infinity : new Date(b.lastWorkedAt).getTime();
      if (aTime === bTime) return 0;
      return (aTime < bTime ? -1 : 1) * direction;
    });
  }, [rows, attention, sort, timesInSelectedMonth]);

  function toggleSort(key: SortKey): void {
    setSort((current) => (current.key === key ? { key, ascending: !current.ascending } : { key, ascending: true }));
  }

  // The 'number' header never toggles: its key means "leave the server's
  // ordering alone", which has no direction to flip. It stays a button
  // because it is the only way back to server order once another column is
  // sorted — but clicking it always lands on the same state.
  function resetToServerOrder(): void {
    setSort({ key: 'number', ascending: true });
  }

  function sortIndicator(key: SortKey): string {
    if (sort.key !== key) return '';
    return sort.ascending ? ' ↑' : ' ↓';
  }

  const nothingRecordedAnywhere = rows.length > 0 && rows.every((row) => row.lastWorkedAt === null);

  return (
    <section aria-labelledby="overview-heading">
      <h2 id="overview-heading">Resumen de territorios</h2>

      <div role="group" aria-label="Filtros del resumen" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <label htmlFor="overview-month">
          Mes
          <select
            id="overview-month"
            value={selectedMonth ?? ''}
            onChange={(event) => setSelectedMonth(event.target.value)}
            disabled={availableMonths.length === 0}
          >
            {availableMonths.map((month) => (
              <option key={month} value={month}>
                {monthLabel(month)}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="overview-attention">
          Mostrar
          <select
            id="overview-attention"
            value={attention}
            onChange={(event) => setAttention(event.target.value as AttentionFilter)}
          >
            <option value="all">Todos</option>
            <option value="none-in-month">Sin registros en el mes</option>
            <option value="never">Nunca trabajados</option>
          </select>
        </label>

        <label htmlFor="overview-archived">
          <input
            id="overview-archived"
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
          />
          Incluir archivados
        </label>
      </div>

      {loading && <p role="status">Cargando resumen…</p>}
      {error && (
        <p role="alert" className="editor-error">
          {error}
        </p>
      )}

      {!loading && !error && rows.length === 0 && <p>Todavía no hay territorios.</p>}

      {!loading && !error && nothingRecordedAnywhere && (
        <p role="status">
          Ningún territorio tiene progreso registrado todavía. Por ahora el progreso solo lo puede registrar el
          administrador, desde cada territorio.
        </p>
      )}

      {!loading && !error && rows.length > 0 && (
        <table className="overview-table">
          <thead>
            <tr>
              <th scope="col" aria-sort={sort.key === 'number' ? 'ascending' : 'none'}>
                <button type="button" onClick={resetToServerOrder}>
                  Nº
                </button>
              </th>
              <th scope="col">Territorio</th>
              <th
                scope="col"
                aria-sort={sort.key === 'times' ? (sort.ascending ? 'ascending' : 'descending') : 'none'}
              >
                <button type="button" onClick={() => toggleSort('times')}>
                  Veces en {selectedMonth === null ? 'el mes' : monthLabel(selectedMonth)}
                  {sortIndicator('times')}
                </button>
              </th>
              <th scope="col">Últimos {MONTHS} meses</th>
              <th
                scope="col"
                aria-sort={sort.key === 'lastWorked' ? (sort.ascending ? 'ascending' : 'descending') : 'none'}
              >
                <button type="button" onClick={() => toggleSort('lastWorked')}>
                  Última vez{sortIndicator('lastWorked')}
                </button>
              </th>
              <th scope="col">Tamaño</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.id}>
                <td>{row.number ?? '—'}</td>
                <td>
                  <button type="button" className="territory-name-button" onClick={() => setPreviewId(row.id)}>
                    {row.name}
                  </button>
                  {row.status === 'archived' && ' (archivado)'}
                </td>
                <td>{timesInSelectedMonth(row)}</td>
                <td>
                  <MonthStrip monthly={row.monthly} />
                </td>
                <td>{describeLastWorked(row.lastWorkedAt, new Date())}</td>
                <td>{formatHectares(row.areaHectares)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!loading && !error && rows.length > 0 && visibleRows.length === 0 && (
        <p role="status">Ningún territorio coincide con ese filtro.</p>
      )}

      <TerritoryPreview territoryId={previewId} onClose={() => setPreviewId(null)} />
    </section>
  );
}
