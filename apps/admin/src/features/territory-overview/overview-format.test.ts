import { describe, expect, it } from 'vitest';

import { describeLastWorked, formatHectares, intensityLevel, monthLabel } from './overview-format.js';

describe('intensityLevel', () => {
  it('maps a count to one of four levels', () => {
    expect(intensityLevel(0)).toBe(0);
    expect(intensityLevel(1)).toBe(1);
    expect(intensityLevel(2)).toBe(2);
    expect(intensityLevel(3)).toBe(2);
    expect(intensityLevel(4)).toBe(3);
    expect(intensityLevel(40)).toBe(3);
  });

  it('treats a negative count as empty rather than throwing', () => {
    expect(intensityLevel(-1)).toBe(0);
  });
});

describe('monthLabel', () => {
  it('renders a YYYY-MM key in Spanish', () => {
    expect(monthLabel('2026-07')).toBe('julio 2026');
    expect(monthLabel('2026-01')).toBe('enero 2026');
    expect(monthLabel('2026-12')).toBe('diciembre 2026');
  });

  it('returns the raw key unchanged when it is not a valid month', () => {
    expect(monthLabel('nonsense')).toBe('nonsense');
    expect(monthLabel('2026-13')).toBe('2026-13');
  });
});

describe('describeLastWorked', () => {
  const now = new Date('2026-09-09T12:00:00Z');

  it('says never when there is no record at all', () => {
    expect(describeLastWorked(null, now)).toBe('nunca');
  });

  it('says today for the same day', () => {
    expect(describeLastWorked('2026-09-09T08:00:00Z', now)).toBe('hoy');
  });

  it('counts days in the singular and the plural', () => {
    expect(describeLastWorked('2026-09-08T08:00:00Z', now)).toBe('hace 1 día');
    expect(describeLastWorked('2026-09-04T08:00:00Z', now)).toBe('hace 5 días');
  });

  it('switches to months past thirty days', () => {
    expect(describeLastWorked('2026-08-05T08:00:00Z', now)).toBe('hace 1 mes');
    expect(describeLastWorked('2026-06-05T08:00:00Z', now)).toBe('hace 3 meses');
  });
});

describe('formatHectares', () => {
  it('renders two decimals with a unit', () => {
    expect(formatHectares(0.196)).toBe('0.20 ha');
    expect(formatHectares(12)).toBe('12.00 ha');
  });

  it('renders an em dash when the area is unknown', () => {
    expect(formatHectares(null)).toBe('—');
  });
});
