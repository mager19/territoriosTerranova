/**
 * Pure helpers for the explicit open/close workflow (2026-10-03 product
 * decision): a territory is opened, worked while open, then closed; each
 * opening starts a new cycle. No React — unit-tested in cycles.test.ts.
 */

import type { OperationalState, TerritoryCycle, TerritoryOperationalStatus } from '../../api/client.js';

/** es-CO short month names, without the trailing period ("3 oct 2026"). */
const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'] as const;

/** "3 oct 2026" for a local date. */
export function formatShortDate(date: Date): string {
  return `${date.getDate()} ${MONTHS_ES[date.getMonth()]} ${date.getFullYear()}`;
}

/** "3 oct 2026" for an ISO timestamp, in the viewer's local time zone. */
export function formatTimestamp(iso: string): string {
  return formatShortDate(new Date(iso));
}

/** "10 oct 2026" for a YYYY-MM-DD calendar date — read as-is, never shifted by a time zone. */
export function formatCalendarDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return formatShortDate(new Date(year ?? 0, (month ?? 1) - 1, day ?? 1));
}

/** The local calendar date as YYYY-MM-DD (the closing date sent when closing a territory). */
export function localCalendarDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Open for recording. A legacy paused cycle still counts as open. */
export function isOpenState(state: OperationalState): boolean {
  return state === 'in_progress' || state === 'reopened' || state === 'paused';
}

/** "Sin abrir" / "Abierto desde el <date>" / "Cerrado el <date>". */
export function describeTopBarStatus(status: TerritoryOperationalStatus, cycles: readonly TerritoryCycle[]): string {
  if (isOpenState(status.state)) {
    const current = cycles.find((cycle) => cycle.cycleNumber === status.cycleNumber);
    return current ? `Abierto desde el ${formatTimestamp(current.openedAt)}` : 'Abierto';
  }
  if (status.state === 'cycle_completed') {
    return status.effectiveCompletionDate ? `Cerrado el ${formatCalendarDate(status.effectiveCompletionDate)}` : 'Cerrado';
  }
  return 'Sin abrir';
}

function describeSessionCount(count: number): string {
  if (count === 0) return 'sin sesiones';
  return count === 1 ? '1 sesión' : `${count} sesiones`;
}

/** "Ciclo 2 · abierto 15 oct 2026 · en curso · 3 sesiones" / "Ciclo 1 · abierto 3 oct 2026 – cerrado 10 oct 2026 · 5 sesiones". */
export function describeCycle(cycle: TerritoryCycle): string {
  const opened = `abierto ${formatTimestamp(cycle.openedAt)}`;
  const closedDate = cycle.effectiveCompletionDate
    ? formatCalendarDate(cycle.effectiveCompletionDate)
    : cycle.closedAt
      ? formatTimestamp(cycle.closedAt)
      : null;
  const span = closedDate === null ? `${opened} · en curso` : `${opened} – cerrado ${closedDate}`;
  return `Ciclo ${cycle.cycleNumber} · ${span} · ${describeSessionCount(cycle.sessionCount)}`;
}
