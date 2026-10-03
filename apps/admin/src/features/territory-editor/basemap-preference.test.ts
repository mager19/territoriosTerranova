import { describe, expect, it } from 'vitest';

import { BASEMAP_PREFERENCE_KEY, readBasemapPreference, writeBasemapPreference } from './basemap-preference.js';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value)
  };
}

const throwingStorage: Storage = {
  length: 0,
  clear: () => undefined,
  key: () => null,
  getItem: () => {
    throw new Error('SecurityError');
  },
  removeItem: () => undefined,
  setItem: () => {
    throw new Error('QuotaExceededError');
  }
};

describe('readBasemapPreference', () => {
  it('defaults to OSM when nothing is stored', () => {
    expect(readBasemapPreference(memoryStorage())).toBe('osm');
  });

  it('restores a stored MapTiler choice', () => {
    expect(readBasemapPreference(memoryStorage({ [BASEMAP_PREFERENCE_KEY]: 'maptiler' }))).toBe('maptiler');
  });

  it('ignores an unknown stored value', () => {
    expect(readBasemapPreference(memoryStorage({ [BASEMAP_PREFERENCE_KEY]: 'satellite' }))).toBe('osm');
  });

  it('defaults to OSM without storage or when storage throws', () => {
    expect(readBasemapPreference(undefined)).toBe('osm');
    expect(readBasemapPreference(throwingStorage)).toBe('osm');
  });
});

describe('writeBasemapPreference', () => {
  it('stores the choice so a later read restores it', () => {
    const storage = memoryStorage();

    writeBasemapPreference('maptiler', storage);
    expect(readBasemapPreference(storage)).toBe('maptiler');

    writeBasemapPreference('osm', storage);
    expect(readBasemapPreference(storage)).toBe('osm');
  });

  it('never throws without storage or when storage throws', () => {
    expect(() => writeBasemapPreference('maptiler', undefined)).not.toThrow();
    expect(() => writeBasemapPreference('maptiler', throwingStorage)).not.toThrow();
  });
});
