import { describe, expect, it } from 'vitest';

import type { TerritoryCycle, TerritoryOperationalStatus } from '../../api/client.js';
import {
  describeCycle,
  describeTopBarStatus,
  formatCalendarDate,
  formatShortDate,
  isOpenState,
  localCalendarDate
} from './cycles.js';

function status(overrides: Partial<TerritoryOperationalStatus>): TerritoryOperationalStatus {
  return {
    state: 'in_progress',
    cycleNumber: 1,
    effectiveCompletionDate: null,
    remainingArea: null,
    remainingAreaStatus: 'unknown',
    progressPercent: null,
    ...overrides
  };
}

function cycle(overrides: Partial<TerritoryCycle>): TerritoryCycle {
  return {
    cycleNumber: 1,
    openedAt: '2026-10-03T15:00:00.000Z',
    closedAt: null,
    effectiveCompletionDate: null,
    sessionCount: 0,
    ...overrides
  };
}

describe('formatShortDate', () => {
  it('formats a local date as "<day> <short month> <year>" in Spanish', () => {
    expect(formatShortDate(new Date(2026, 9, 3))).toBe('3 oct 2026');
    expect(formatShortDate(new Date(2026, 0, 15))).toBe('15 ene 2026');
    expect(formatShortDate(new Date(2026, 8, 30))).toBe('30 sept 2026');
  });
});

describe('formatCalendarDate', () => {
  it('formats a YYYY-MM-DD date without any time-zone shift', () => {
    expect(formatCalendarDate('2026-10-10')).toBe('10 oct 2026');
    expect(formatCalendarDate('2026-01-01')).toBe('1 ene 2026');
  });
});

describe('localCalendarDate', () => {
  it('returns the local calendar date as YYYY-MM-DD', () => {
    expect(localCalendarDate(new Date(2026, 9, 3, 23, 30))).toBe('2026-10-03');
    expect(localCalendarDate(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05');
  });
});

describe('isOpenState', () => {
  it('treats in progress, reopened, and legacy paused as open', () => {
    expect(isOpenState('in_progress')).toBe(true);
    expect(isOpenState('reopened')).toBe(true);
    expect(isOpenState('paused')).toBe(true);
    expect(isOpenState('no_record')).toBe(false);
    expect(isOpenState('cycle_completed')).toBe(false);
  });
});

describe('describeTopBarStatus', () => {
  it('says "Sin abrir" for a territory that was never opened', () => {
    expect(describeTopBarStatus(status({ state: 'no_record', cycleNumber: null }), [])).toBe('Sin abrir');
  });

  it('says since when the current cycle is open', () => {
    const cycles = [cycle({ cycleNumber: 2, openedAt: '2026-10-15T15:00:00.000Z' }), cycle({ cycleNumber: 1 })];
    expect(describeTopBarStatus(status({ state: 'reopened', cycleNumber: 2 }), cycles)).toBe('Abierto desde el 15 oct 2026');
  });

  it('treats a legacy paused cycle as open', () => {
    expect(describeTopBarStatus(status({ state: 'paused' }), [cycle({})])).toBe('Abierto desde el 3 oct 2026');
  });

  it('says only "Abierto" while the cycle dates are not loaded yet', () => {
    expect(describeTopBarStatus(status({ state: 'in_progress' }), [])).toBe('Abierto');
  });

  it('says when it was closed, using the effective completion date', () => {
    expect(
      describeTopBarStatus(status({ state: 'cycle_completed', effectiveCompletionDate: '2026-10-10' }), [cycle({})])
    ).toBe('Cerrado el 10 oct 2026');
  });
});

describe('describeCycle', () => {
  it('describes an open cycle as "en curso"', () => {
    expect(describeCycle(cycle({ cycleNumber: 2, openedAt: '2026-10-15T15:00:00.000Z', sessionCount: 3 }))).toBe(
      'Ciclo 2 · abierto 15 oct 2026 · en curso · 3 sesiones'
    );
  });

  it('describes a closed cycle with both dates', () => {
    expect(
      describeCycle(
        cycle({ closedAt: '2026-10-10T20:00:00.000Z', effectiveCompletionDate: '2026-10-10', sessionCount: 5 })
      )
    ).toBe('Ciclo 1 · abierto 3 oct 2026 – cerrado 10 oct 2026 · 5 sesiones');
  });

  it('uses the singular for one session and says so when there are none', () => {
    expect(describeCycle(cycle({ sessionCount: 1 }))).toBe('Ciclo 1 · abierto 3 oct 2026 · en curso · 1 sesión');
    expect(describeCycle(cycle({ sessionCount: 0 }))).toBe('Ciclo 1 · abierto 3 oct 2026 · en curso · sin sesiones');
  });
});
