import { describe, expect, it } from 'vitest';

import { formatKm2, nextActiveIndex } from './barrio.js';

describe('formatKm2', () => {
  it('formats a fractional area to two decimals', () => {
    expect(formatKm2(0.42)).toBe('0.42 km²');
  });

  it('keeps two decimals for a whole-number area', () => {
    expect(formatKm2(3)).toBe('3.00 km²');
  });

  it('rounds to two decimals', () => {
    // 0.426 avoids the 0.425 floating-point boundary (which rounds down in
    // IEEE 754, not up) so the assertion is about the formatting, not the
    // representation.
    expect(formatKm2(0.426)).toBe('0.43 km²');
  });

  it('returns an empty string for an unknown (null) area', () => {
    expect(formatKm2(null)).toBe('');
  });
});

describe('nextActiveIndex', () => {
  it('returns -1 for an empty list, no matter the current index', () => {
    expect(nextActiveIndex(-1, 'down', 0)).toBe(-1);
    expect(nextActiveIndex(2, 'down', 0)).toBe(-1);
  });

  it('moving down from "nothing highlighted" selects the first option', () => {
    expect(nextActiveIndex(-1, 'down', 3)).toBe(0);
  });

  it('moving down clamps at the last option (never wraps)', () => {
    expect(nextActiveIndex(2, 'down', 3)).toBe(2);
  });

  it('moving up clamps at the first option (never wraps)', () => {
    expect(nextActiveIndex(0, 'up', 3)).toBe(0);
    expect(nextActiveIndex(-1, 'up', 3)).toBe(0);
  });

  it('moves within bounds normally', () => {
    expect(nextActiveIndex(1, 'down', 3)).toBe(2);
    expect(nextActiveIndex(1, 'up', 3)).toBe(0);
  });
});
